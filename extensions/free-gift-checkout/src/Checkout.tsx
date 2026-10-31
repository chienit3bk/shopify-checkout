import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';
import type {CartLine} from '@shopify/ui-extensions/checkout';
import {
  type CartChange,
  type CartLike,
  type GiftConfig,
  type GiftRule,
  GIFT_ATTRIBUTE_KEY,
  chooseGift,
  eligibleRules,
  giftVariants,
  isPickerRule,
  nextUnlock,
  parseConfig,
  planGiftChanges,
  supportsCurrency,
} from '../../../shared/free-gift/rules';
import {type GiftEventData, type GiftEventName, GIFT_EVENT_PREFIX} from '../../../shared/analytics/gift-funnel';

export default async () => {
  render(<Extension />, document.body);
};

const CONFIG_KEY = 'free_gift_config';
/** Rules whose gift the buyer removed on purpose — never re-added in this checkout. */
const DECLINED_STORAGE_KEY = 'free-gift:declined';
/** Stop retrying a gift after this many failed adds (e.g. out of stock). */
const MAX_ADD_ATTEMPTS = 2;
/** Analytics events already published in this checkout (one per event + rule, across reloads). */
const SENT_STORAGE_KEY = 'free-gift:analytics-sent';

function Extension() {
  const config = readConfig();
  const lines = shopify.lines.value;
  const currencyCode = shopify.cost.subtotalAmount.value.currencyCode;
  const canChangeLines = shopify.instructions.value.lines.canAddCartLine && shopify.instructions.value.lines.canRemoveCartLine;

  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  /** Bumped after each sync so changes made by the buyer mid-sync get re-planned. */
  const [syncRound, setSyncRound] = useState(0);
  const syncing = useRef(false);
  /** Picker rule whose choice is being applied (button spinner). */
  const [choosing, setChoosing] = useState<string | null>(null);
  /** Rules whose gift line has been seen in the cart (so a later absence means it was removed). */
  const seenInCart = useRef(new Set<string>());
  const addAttempts = useRef(new Map<string, number>());

  // Restore gifts the buyer declined earlier in this checkout (survives reloads).
  useEffect(() => {
    shopify.storage.read(DECLINED_STORAGE_KEY).then((stored) => {
      if (!Array.isArray(stored)) return;
      const ids = stored.filter((id): id is string => typeof id === 'string');
      if (ids.length) setDeclined(new Set(ids));
    });
  }, []);

  // Checkout has no exchange rate, so act only where every threshold is known in the
  // buyer's currency: the config currency, or markets with explicit amounts.
  // The Function (which does know the rate) still guards pricing everywhere.
  const active = config !== null && supportsCurrency(config, currencyCode);
  const cart = toCart(lines, currencyCode, config);
  const gifts = useGiftProducts(active ? config : null);

  useEffect(() => {
    if (!config || !active || !canChangeLines || syncing.current) return;

    const eligibleIds = new Set(eligibleRules(config, cart).map((rule) => rule.id));
    const giftIdsInCart = new Set(cart.lines.map((line) => line.giftRuleId).filter((id): id is string => id !== null));
    giftIdsInCart.forEach((id) => seenInCart.current.add(id));

    // A gift that was in the cart is gone while the cart still qualifies → the buyer removed it.
    // Picker gifts are never auto-added, so their removal needs no memory (the picker stays open).
    const pickerIds = new Set(config.rules.filter(isPickerRule).map((rule) => rule.id));
    const newlyDeclined: string[] = [];
    for (const id of [...seenInCart.current]) {
      if (giftIdsInCart.has(id)) continue;
      seenInCart.current.delete(id);
      if (eligibleIds.has(id) && !pickerIds.has(id)) newlyDeclined.push(id);
    }
    if (newlyDeclined.length) {
      const next = new Set([...declined, ...newlyDeclined]);
      setDeclined(next);
      shopify.storage.write(DECLINED_STORAGE_KEY, [...next]);
      return; // re-plan on the next render with the updated declined set
    }

    const skip = new Set([...declined, ...unavailable]);
    const changes = planGiftChanges(config, cart, skip);
    if (changes.length === 0) return;

    syncing.current = true;
    applySequentially(changes)
      .catch((error) => console.error('[free-gift] sync failed', error))
      .finally(() => {
        syncing.current = false;
        setSyncRound((round) => round + 1);
      });
  }, [lines, active, canChangeLines, declined, unavailable, syncRound]);

  /**
   * One change at a time: parallel cart changes trip checkout's change throttle.
   * A `{type: 'error'}` result does not prove the change was not applied, so we
   * never retry blindly — the next `lines` update re-plans from the real cart.
   */
  async function applySequentially(changes: CartChange[]) {
    for (const change of changes) {
      if (change.type === 'add') {
        const attempts = (addAttempts.current.get(change.ruleId) ?? 0) + 1;
        addAttempts.current.set(change.ruleId, attempts);
        const result = await shopify.applyCartLinesChange({
          type: 'addCartLine',
          merchandiseId: change.variantId,
          quantity: change.quantity,
          attributes: [{key: GIFT_ATTRIBUTE_KEY, value: change.ruleId}],
        });
        if (result.type === 'error' && attempts >= MAX_ADD_ATTEMPTS) {
          setUnavailable((prev) => new Set([...prev, change.ruleId]));
        }
      } else if (change.type === 'remove') {
        await shopify.applyCartLinesChange({type: 'removeCartLine', id: change.lineId, quantity: change.quantity});
      } else {
        await shopify.applyCartLinesChange({type: 'updateCartLine', id: change.lineId, quantity: change.quantity});
      }
    }
  }

  /** The buyer picked a gift: swap the rule's gift line, one change at a time. */
  function choose(ruleId: string, variantId: string) {
    if (!config || syncing.current) return;
    const changes = chooseGift(config, cart, ruleId, variantId);
    if (changes.length === 0) return;
    syncing.current = true;
    setChoosing(ruleId);
    applySequentially(changes)
      .catch((error) => console.error('[free-gift] choice failed', error))
      .finally(() => {
        syncing.current = false;
        setChoosing(null);
        setSyncRound((round) => round + 1);
      });
  }

  function addBack(ruleId: string) {
    addAttempts.current.delete(ruleId);
    const next = new Set([...declined].filter((id) => id !== ruleId));
    setDeclined(next);
    shopify.storage.write(DECLINED_STORAGE_KEY, [...next]);
  }

  useGiftAnalytics(config && active && canChangeLines ? giftEvents(config, cart, declined, currencyCode) : []);

  if (!config || !active) return null;

  const eligible = eligibleRules(config, cart);
  const pickers = eligible.filter(isPickerRule);
  const inCart = eligible.filter(
    (rule) => !isPickerRule(rule) && cart.lines.some((line) => line.giftRuleId === rule.id),
  );
  const removedByBuyer = eligible.filter((rule) => declined.has(rule.id));
  const progress = nextUnlock(config, cart);
  const nextRule = progress ? config.rules.find((rule) => rule.id === progress.ruleId) : undefined;
  const t = shopify.i18n.translate;

  if (!canChangeLines) {
    return eligible.length ? <s-banner tone="info">{t('giftsNotAvailableHere')}</s-banner> : null;
  }

  return (
    <s-stack gap="base">
      {inCart.length > 0 && (
        <s-banner tone="success" heading={t('unlockedHeading', {count: inCart.length})}>
          <s-stack gap="base">
            {inCart.map((rule) => (
              <GiftCard key={rule.id} rule={rule} gift={gifts[rule.giftVariantId]} />
            ))}
          </s-stack>
        </s-banner>
      )}
      {pickers.map((rule) => {
        const chosen = cart.lines.find((line) => line.giftRuleId === rule.id)?.variantId ?? null;
        return (
          <s-box key={rule.id} padding="base" border="base" borderRadius="base">
            <s-stack gap="base">
              <s-stack gap="small-300">
                <s-text type="strong">{chosen ? t('pickedHeading') : t('pickHeading')}</s-text>
                <s-text color="subdued">{rule.title}</s-text>
              </s-stack>
              {giftVariants(rule).map((variantId) => (
                <s-grid key={variantId} gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                  <GiftCard rule={rule} gift={gifts[variantId]} compact />
                  {chosen === variantId ? (
                    <s-badge icon="check-circle">{t('picked')}</s-badge>
                  ) : (
                    <s-button
                      variant="secondary"
                      loading={choosing === rule.id}
                      disabled={choosing !== null}
                      onClick={() => choose(rule.id, variantId)}
                    >
                      {chosen ? t('switchTo') : t('pick')}
                    </s-button>
                  )}
                </s-grid>
              ))}
            </s-stack>
          </s-box>
        );
      })}
      {removedByBuyer.map((rule) => (
        <s-banner key={rule.id} tone="info">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>{t('removedGift', {gift: rule.title})}</s-text>
            <s-button variant="secondary" onClick={() => addBack(rule.id)}>
              {t('addBack')}
            </s-button>
          </s-stack>
        </s-banner>
      ))}
      {progress && nextRule && (
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack gap="base">
            <s-stack gap="small-200">
              <s-text>
                {t('spendMore', {
                  amount: shopify.i18n.formatCurrency(progress.remaining, {currency: currencyCode}),
                })}
              </s-text>
              <s-progress value={progress.ratio} max={1} accessibilityLabel={t('progressLabel')} />
            </s-stack>
            <GiftCard rule={nextRule} gift={gifts[nextRule.giftVariantId]} />
          </s-stack>
        </s-box>
      )}
    </s-stack>
  );
}

/** What the buyer sees right now, as funnel events for the app's web pixel. */
function giftEvents(config: GiftConfig, cart: CartLike, declined: Set<string>, currencyCode: string): Array<[GiftEventName, GiftEventData]> {
  const events: Array<[GiftEventName, GiftEventData]> = [];
  const progress = nextUnlock(config, cart);
  if (progress) events.push(['progress_viewed', {ruleId: progress.ruleId, remaining: progress.remaining, currencyCode}]);
  for (const rule of eligibleRules(config, cart)) {
    if (cart.lines.some((line) => line.giftRuleId === rule.id)) events.push(['unlocked', {ruleId: rule.id}]);
    if (declined.has(rule.id)) events.push(['declined', {ruleId: rule.id}]);
  }
  return events;
}

/**
 * Publishes each event once per checkout (`shopify.storage` survives reloads), so the
 * pixel counts buyers, not re-renders. `analytics.publish` reaches every web pixel on the page.
 */
function useGiftAnalytics(events: Array<[GiftEventName, GiftEventData]>) {
  const sent = useRef<Set<string> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const key = events.map(([name, data]) => `${name}:${data.ruleId}`).join('|');

  useEffect(() => {
    shopify.storage
      .read(SENT_STORAGE_KEY)
      .then((stored) => {
        sent.current = new Set(Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string') : []);
      })
      .catch(() => {
        sent.current = new Set();
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const done = sent.current;
    if (!loaded || !done) return;
    const fresh = events.filter(([name, data]) => !done.has(`${name}:${data.ruleId}`));
    if (fresh.length === 0) return;
    for (const [name, data] of fresh) {
      done.add(`${name}:${data.ruleId}`);
      shopify.analytics
        .publish(`${GIFT_EVENT_PREFIX}${name}`, {...data})
        .catch((error) => console.error('[free-gift] analytics publish failed', error));
    }
    shopify.storage.write(SENT_STORAGE_KEY, [...done]);
  }, [loaded, key]);
}

interface GiftProduct {
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  imageAlt: string;
  price: number;
  currencyCode: string;
  url: string | null;
}

/** The gift as a product: image, name, crossed-out price, FREE, and a link to its page (not in compact rows). */
function GiftCard({rule, gift, compact = false}: {rule: GiftRule; gift?: GiftProduct; compact?: boolean}) {
  const t = shopify.i18n.translate;
  const showVariant = gift && gift.variantTitle && gift.variantTitle !== 'Default Title';

  // A grid, not an inline stack: a long product name must wrap beside the image, not push it onto its own row.
  return (
    <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
      <s-product-thumbnail src={gift?.imageUrl ?? undefined} alt={gift?.imageAlt ?? rule.title} size="base" />
      <s-stack gap="small-300">
        {gift && !compact && (
          <s-text type="small" color="subdued">
            {rule.title}
          </s-text>
        )}
        <s-text type="strong">{gift?.productTitle ?? rule.title}</s-text>
        {showVariant && <s-text color="subdued">{gift.variantTitle}</s-text>}
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {gift && (
            <s-text type="redundant">{shopify.i18n.formatCurrency(gift.price, {currency: gift.currencyCode})}</s-text>
          )}
          <s-badge>{t('free')}</s-badge>
        </s-stack>
        {gift?.url && !compact && (
          <s-link href={gift.url} target="_blank">
            {t('viewProduct')}
          </s-link>
        )}
      </s-stack>
    </s-grid>
  );
}

const GIFT_PRODUCTS_QUERY = `query GiftProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      title
      image { url altText }
      price { amount currencyCode }
      product { title handle onlineStoreUrl featuredImage { url altText } }
    }
  }
}`;

interface GiftProductsData {
  nodes: Array<{
    id: string;
    title: string;
    image: {url: string; altText: string | null} | null;
    price: {amount: string; currencyCode: string};
    product: {
      title: string;
      handle: string;
      onlineStoreUrl: string | null;
      featuredImage: {url: string; altText: string | null} | null;
    };
  } | null>;
}

/** Product details for every gift in the config, keyed by variant id (Storefront API, once per config). */
function useGiftProducts(config: GiftConfig | null): Record<string, GiftProduct> {
  const [products, setProducts] = useState<Record<string, GiftProduct>>({});
  const ids = config ? [...new Set(config.rules.flatMap(giftVariants))].sort() : [];
  const key = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) return;
    shopify
      .query<GiftProductsData>(GIFT_PRODUCTS_QUERY, {variables: {ids}})
      .then(({data}) => {
        const next: Record<string, GiftProduct> = {};
        for (const node of data?.nodes ?? []) {
          if (!node) continue;
          const image = node.image ?? node.product.featuredImage;
          next[node.id] = {
            productTitle: node.product.title,
            variantTitle: node.title,
            imageUrl: image?.url ?? null,
            imageAlt: image?.altText ?? node.product.title,
            price: Number(node.price.amount),
            currencyCode: node.price.currencyCode,
            url: node.product.onlineStoreUrl ?? productUrl(node.product.handle),
          };
        }
        setProducts(next);
      })
      .catch((error) => console.error('[free-gift] gift products query failed', error));
  }, [key]);

  return products;
}

/** `onlineStoreUrl` is null while a store is password-protected; fall back to the storefront domain + handle. */
function productUrl(handle: string): string | null {
  const base = shopify.shop.storefrontUrl ?? `https://${shopify.shop.myshopifyDomain}`;
  return handle ? `${base.replace(/\/$/, '')}/products/${handle}` : null;
}

function readConfig(): GiftConfig | null {
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  return entry ? parseConfig(entry.metafield.value) : null;
}

/**
 * Line totals here are after line discounts, so they can only be lower than
 * the Function's pre-discount subtotal: the extension never adds a gift the
 * Function would refuse to make free.
 */
function toCart(lines: CartLine[], currencyCode: string, config: GiftConfig | null): CartLike {
  return {
    currencyCode,
    rate: currencyCode === config?.currencyCode ? 1 : undefined,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.merchandise.product.id,
      variantId: line.merchandise.id,
      quantity: line.quantity,
      subtotal: line.cost.totalAmount.amount,
      giftRuleId: line.attributes.find((attribute) => attribute.key === GIFT_ATTRIBUTE_KEY)?.value ?? null,
    })),
  };
}

import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';
import type {CartLine} from '@shopify/ui-extensions/checkout';
import {
  type CartChange,
  type CartLike,
  type GiftConfig,
  GIFT_ATTRIBUTE_KEY,
  eligibleRules,
  nextUnlock,
  parseConfig,
  planGiftChanges,
} from '../../../shared/free-gift/rules';

export default async () => {
  render(<Extension />, document.body);
};

const CONFIG_KEY = 'free_gift_config';
/** Rules whose gift the buyer removed on purpose — never re-added in this checkout. */
const DECLINED_STORAGE_KEY = 'free-gift:declined';
/** Stop retrying a gift after this many failed adds (e.g. out of stock). */
const MAX_ADD_ATTEMPTS = 2;

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

  // Amounts in the config are in the shop currency; without a rate in checkout
  // we only act when the buyer pays in that currency. The Function still guards pricing.
  const active = config !== null && config.currencyCode === currencyCode;
  const cart = toCart(lines);

  useEffect(() => {
    if (!config || !active || !canChangeLines || syncing.current) return;

    const eligibleIds = new Set(eligibleRules(config, cart).map((rule) => rule.id));
    const giftIdsInCart = new Set(cart.lines.map((line) => line.giftRuleId).filter((id): id is string => id !== null));
    giftIdsInCart.forEach((id) => seenInCart.current.add(id));

    // A gift that was in the cart is gone while the cart still qualifies → the buyer removed it.
    const newlyDeclined: string[] = [];
    for (const id of [...seenInCart.current]) {
      if (giftIdsInCart.has(id)) continue;
      seenInCart.current.delete(id);
      if (eligibleIds.has(id)) newlyDeclined.push(id);
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

  function addBack(ruleId: string) {
    addAttempts.current.delete(ruleId);
    const next = new Set([...declined].filter((id) => id !== ruleId));
    setDeclined(next);
    shopify.storage.write(DECLINED_STORAGE_KEY, [...next]);
  }

  if (!config || !active) return null;

  const eligible = eligibleRules(config, cart);
  const inCart = eligible.filter((rule) => cart.lines.some((line) => line.giftRuleId === rule.id));
  const removedByBuyer = eligible.filter((rule) => declined.has(rule.id));
  const progress = nextUnlock(config, cart);
  const t = shopify.i18n.translate;

  if (!canChangeLines) {
    return eligible.length ? <s-banner tone="info">{t('giftsNotAvailableHere')}</s-banner> : null;
  }

  return (
    <s-stack gap="base">
      {inCart.length > 0 && (
        <s-banner tone="success" heading={t('unlockedHeading')}>
          <s-text>{inCart.map((rule) => rule.title).join(', ')}</s-text>
        </s-banner>
      )}
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
      {progress && (
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-stack gap="small-200">
            <s-text>
              {t('spendMore', {
                amount: shopify.i18n.formatCurrency(progress.remaining, {currency: currencyCode}),
                gift: progress.title,
              })}
            </s-text>
            <s-progress value={progress.ratio} max={1} accessibilityLabel={t('progressLabel')} />
          </s-stack>
        </s-box>
      )}
    </s-stack>
  );
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
function toCart(lines: CartLine[]): CartLike {
  return {
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

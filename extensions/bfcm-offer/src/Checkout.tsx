import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {
  type Offer,
  type OfferConfig,
  OFFER_ATTRIBUTE_KEY,
  availableOffers,
  countdown,
  parseOfferConfig,
} from '../../../shared/bfcm/offer';

export default async () => {
  render(<Extension />, document.body);
};

const CONFIG_KEY = 'bfcm_offer_config';

function Extension() {
  const config = readConfig();
  const lines = shopify.lines.value;
  const now = useNow();
  const products = useOfferProducts(config);
  const [adding, setAdding] = useState<string | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  // The buyer's clock only drives the countdown; the Function checks the window on the server.
  const timer = config ? countdown(config, now) : null;
  if (!config || !timer || timer.ended || Date.parse(config.endsAt) - now > 45 * 86400000) return null;

  const t = shopify.i18n.translate;
  const offerLines = lines.map((line) => ({
    id: line.id,
    variantId: line.merchandise.id,
    quantity: line.quantity,
    offerId: line.attributes.find((attribute) => attribute.key === OFFER_ATTRIBUTE_KEY)?.value ?? null,
  }));
  const open = availableOffers(config, offerLines).filter((offer) => !failed.has(offer.id));
  const accepted = config.offers.filter((offer) => offerLines.some((line) => line.offerId === offer.id));
  const canAdd = shopify.instructions.value.lines.canAddCartLine;

  async function add(offer: Offer) {
    setAdding(offer.id);
    const result = await shopify.applyCartLinesChange({
      type: 'addCartLine',
      merchandiseId: offer.variantId,
      quantity: 1,
      attributes: [{key: OFFER_ATTRIBUTE_KEY, value: offer.id}],
    });
    // An error doesn't prove the line wasn't added; the next `lines` update tells the truth.
    if (result.type === 'error') setFailed((prev) => new Set([...prev, offer.id]));
    setAdding(null);
  }

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-text type="strong">{t('heading', {campaign: config.campaign})}</s-text>
          <s-badge tone="critical">
            {t('endsIn', {
              time: `${timer.days}d ${pad(timer.hours)}:${pad(timer.minutes)}:${pad(timer.seconds)}`,
            })}
          </s-badge>
        </s-stack>
        {accepted.map((offer) => (
          <s-text key={offer.id} color="subdued">
            {t('added', {product: products[offer.variantId]?.productTitle ?? offer.title, percent: offer.percentOff})}
          </s-text>
        ))}
        {canAdd &&
          open.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              product={products[offer.variantId]}
              loading={adding === offer.id}
              onAdd={() => add(offer)}
            />
          ))}
      </s-stack>
    </s-box>
  );
}

interface OfferProduct {
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  price: number;
  currencyCode: string;
}

function OfferCard({
  offer,
  product,
  loading,
  onAdd,
}: {
  offer: Offer;
  product?: OfferProduct;
  loading: boolean;
  onAdd: () => void;
}) {
  const t = shopify.i18n.translate;
  const format = (amount: number) =>
    shopify.i18n.formatCurrency(amount, {currency: product?.currencyCode ?? 'USD'});
  const showVariant = product && product.variantTitle && product.variantTitle !== 'Default Title';

  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-product-thumbnail src={product?.imageUrl ?? undefined} alt={product?.productTitle ?? offer.title} size="base" />
      <s-stack gap="small-300">
        <s-text type="strong">{product?.productTitle ?? offer.title}</s-text>
        {showVariant && <s-text color="subdued">{product.variantTitle}</s-text>}
        {product && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="redundant">{format(product.price)}</s-text>
            <s-text type="strong">{format(product.price * (1 - offer.percentOff / 100))}</s-text>
            <s-badge>{t('percentOff', {percent: offer.percentOff})}</s-badge>
          </s-stack>
        )}
        <s-button variant="secondary" loading={loading} onClick={onAdd}>
          {t('addToOrder')}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

/** Re-renders every second for the countdown. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const OFFER_PRODUCTS_QUERY = `query OfferProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      title
      image { url }
      price { amount currencyCode }
      product { title featuredImage { url } }
    }
  }
}`;

interface OfferProductsData {
  nodes: Array<{
    id: string;
    title: string;
    image: {url: string} | null;
    price: {amount: string; currencyCode: string};
    product: {title: string; featuredImage: {url: string} | null};
  } | null>;
}

/** Image and price of each offer product (Storefront API, once per config). */
function useOfferProducts(config: OfferConfig | null): Record<string, OfferProduct> {
  const [products, setProducts] = useState<Record<string, OfferProduct>>({});
  const ids = config ? [...new Set(config.offers.map((offer) => offer.variantId))].sort() : [];
  const key = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) return;
    shopify
      .query<OfferProductsData>(OFFER_PRODUCTS_QUERY, {variables: {ids}})
      .then(({data}) => {
        const next: Record<string, OfferProduct> = {};
        for (const node of data?.nodes ?? []) {
          if (!node) continue;
          next[node.id] = {
            productTitle: node.product.title,
            variantTitle: node.title,
            imageUrl: (node.image ?? node.product.featuredImage)?.url ?? null,
            price: Number(node.price.amount),
            currencyCode: node.price.currencyCode,
          };
        }
        setProducts(next);
      })
      .catch((error) => console.error('[bfcm-offer] product query failed', error));
  }, [key]);

  return products;
}

function readConfig(): OfferConfig | null {
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  return entry ? parseOfferConfig(entry.metafield.value) : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

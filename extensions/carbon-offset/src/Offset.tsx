import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {parseOffsetConfig, shouldOfferOffset, toggleOffset} from '../../../shared/delivery/offset';

export default async () => {
  render(<Offset />, document.body);
};

const PRICE_QUERY = `query OffsetPrice($id: ID!) { node(id: $id) { ... on ProductVariant { price { amount currencyCode } } } }`;

/**
 * "Make my delivery carbon-neutral (+$1.50)": a checkbox that adds or removes a
 * service line (its own product, no shipping) — so it's priced, taxed and reported
 * like any product, and the merchant can see who opted in on the order.
 */
function Offset() {
  const t = shopify.i18n.translate;
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<{amount: string; currencyCode: string} | null>(null);
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === 'carbon_offset_config',
  );
  const config = entry ? parseOffsetConfig(entry.metafield.value) : null;

  useEffect(() => {
    if (!config) return;
    shopify
      .query<{node: {price: {amount: string; currencyCode: string}} | null}>(PRICE_QUERY, {variables: {id: config.variantId}})
      .then(({data}) => setPrice(data?.node?.price ?? null))
      .catch((error) => console.error('[carbon-offset] price query failed', error));
  }, [config?.variantId]);

  const lines = shopify.lines.value.map((line) => ({
    id: line.id,
    quantity: line.quantity,
    merchandiseId: line.merchandise.id,
    attributes: line.attributes,
  }));
  const canChange = shopify.instructions.value.lines.canAddCartLine && shopify.instructions.value.lines.canRemoveCartLine;
  if (!config || !price || !canChange || !shouldOfferOffset(config, lines)) return null;
  const on = lines.some((line) => line.merchandiseId === config.variantId);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      for (const change of toggleOffset(config!, lines, next)) await shopify.applyCartLinesChange(change);
    } finally {
      setBusy(false);
    }
  }

  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-checkbox
          checked={on}
          disabled={busy}
          label={t('label', {price: shopify.i18n.formatCurrency(Number(price.amount), {currency: price.currencyCode})})}
          onChange={(event) => toggle((event.currentTarget as HTMLElementTagNameMap['s-checkbox']).checked ?? false)}
        />
        <s-text type="small" color="subdued">
          {t('help')}
        </s-text>
      </s-stack>
    </s-box>
  );
}

import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';
import type {CartLine} from '@shopify/ui-extensions/checkout';
import {appliesTo, freeUnits, parseBogoConfig, unitsToNextFree} from '../../../shared/bogo/bogo';

export default async () => {
  render(<Nudge />, document.body);
};

const CONFIG_KEY = 'bogo_config';
/** Gift lines (free-gift block) are already free and never take part. */
const GIFT_ATTRIBUTE_KEY = '_free_gift';

/**
 * Under an eligible line: the offer ("Buy 2, get 1 free") while the buyer has fewer
 * than 2, then "Add 1 more — it's free" (one tap raises the quantity). Once a unit is
 * free, Shopify's own discount line says so. The bogo-discount Function prices it.
 *
 * A partially discounted line reaches UI extensions split in two (2 paid + 1 free),
 * while the Function sees one line of 3 — so count the SKU across lines, and render
 * only on the undiscounted part.
 */
function Nudge() {
  const t = shopify.i18n.translate;
  const [adding, setAdding] = useState(false);
  const line = shopify.target.value;
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  const config = entry ? parseBogoConfig(entry.metafield.value) : null;
  const isGift = (cartLine: CartLine) => cartLine.attributes.some((attribute) => attribute.key === GIFT_ATTRIBUTE_KEY);
  if (!config || !appliesTo(config, line.merchandise.product.id, isGift(line))) return null;
  if (line.discountAllocations.length > 0) return null;

  const sameSku = shopify.lines.value.filter((cartLine) => cartLine.merchandise.id === line.merchandise.id && !isGift(cartLine));
  const quantity = sameSku.reduce((sum, cartLine) => sum + cartLine.quantity, 0);
  const missing = unitsToNextFree(config, quantity);
  const free = freeUnits(config, quantity);
  const canUpdate = shopify.instructions.value.lines.canUpdateCartLine;

  async function addMore(count: number) {
    setAdding(true);
    try {
      await shopify.applyCartLinesChange({type: 'updateCartLine', id: line.id, quantity: line.quantity + count});
    } finally {
      setAdding(false);
    }
  }

  return (
    <s-stack gap="small-200">
      {free === 0 && missing === null && (
        <s-text type="small" color="subdued">
          {config.label}
        </s-text>
      )}
      {missing !== null && canUpdate && (
        <s-button variant="secondary" loading={adding} onClick={() => addMore(missing)}>
          {t('addOneFree', {count: missing})}
        </s-button>
      )}
    </s-stack>
  );
}

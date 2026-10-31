import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';
import type {CartLine} from '@shopify/ui-extensions/checkout';
import {parseTiersConfig, volumeProgress} from '../../../shared/tiers/tiers';

export default async () => {
  render(<Volume />, document.body);
};

const CONFIG_KEY = 'tiers_config';
/** Gift lines (free-gift block) never take part. */
const GIFT_ATTRIBUTE_KEY = '_free_gift';

/**
 * "Stock up & save: 2+ 5% · 4+ 10% · 6+ 15%" under an eligible line, plus a one-tap
 * "Add 2 more for 10% off". Quantity is summed per variant, like the Function does.
 */
function Volume() {
  const t = shopify.i18n.translate;
  const [adding, setAdding] = useState(false);
  const line = shopify.target.value;
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  const volume = entry ? parseTiersConfig(entry.metafield.value)?.volume : null;
  const isGift = (cartLine: CartLine) => cartLine.attributes.some((attribute) => attribute.key === GIFT_ATTRIBUTE_KEY);
  if (!volume || isGift(line) || !volume.productIds.includes(line.merchandise.product.id)) return null;

  const sameVariant = shopify.lines.value.filter((cartLine) => cartLine.merchandise.id === line.merchandise.id && !isGift(cartLine));
  // Render once per variant, on its first line.
  if (sameVariant[0] && sameVariant[0].id !== line.id) return null;
  const quantity = sameVariant.reduce((sum, cartLine) => sum + cartLine.quantity, 0);
  const {current, next} = volumeProgress(volume.tiers, quantity);
  const ladder = [...volume.tiers]
    .sort((a, b) => a.minQuantity - b.minQuantity)
    .map((tier) => `${tier.minQuantity}+ ${tier.percent}%`)
    .join(' · ');
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
      <s-text type="small" color="subdued">
        {t('tierLadder', {label: volume.label, tiers: ladder})}
      </s-text>
      {next && canUpdate && (
        <s-button variant="secondary" loading={adding} onClick={() => addMore(next.minQuantity - quantity)}>
          {t('addForTier', {count: next.minQuantity - quantity, percent: next.percent})}
        </s-button>
      )}
      {!next && current && (
        <s-text type="small">{t('atTopTier', {percent: current.percent})}</s-text>
      )}
    </s-stack>
  );
}

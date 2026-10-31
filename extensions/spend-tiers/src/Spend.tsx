import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {amountsBeforeDiscounts} from '../../../shared/cart/subtotal';
import {parseTiersConfig, spendProgress} from '../../../shared/tiers/tiers';

export default async () => {
  render(<Spend />, document.body);
};

const CONFIG_KEY = 'tiers_config';
/** Gift lines (free-gift block) never count towards a spend tier. */
const GIFT_ATTRIBUTE_KEY = '_free_gift';

/**
 * "Spend $30.00 more for 10% off" above the discount field. Counts what the Function
 * counts: the lines' amounts before discounts, no gifts, no excluded products.
 */
function Spend() {
  const t = shopify.i18n.translate;
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  const config = entry ? parseTiersConfig(entry.metafield.value) : null;
  if (!config?.spend) return null;

  const excluded = new Set(config.spend.excludedProductIds);
  const lines = shopify.lines.value;
  const counts = (line: (typeof lines)[number]) =>
    !line.attributes.some((attribute) => attribute.key === GIFT_ATTRIBUTE_KEY) && !excluded.has(line.merchandise.product.id);
  const amounts = amountsBeforeDiscounts(shopify.cost.subtotalAmount.value.amount, lines, counts);
  const subtotal = lines.reduce((sum, line, i) => sum + (counts(line) ? amounts[i] : 0), 0);
  const currencyCode = shopify.cost.subtotalAmount.value.currencyCode;
  // No exchange rate in checkout: unknown currencies without an explicit amount stay hidden.
  const {current, next} = spendProgress(config, subtotal, currencyCode, undefined);
  if (!current && !next) return null;

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small-200">
        {current && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="discount" />
            <s-text type="strong">{t('saving', {label: config.spend.label, percent: current.percent})}</s-text>
          </s-stack>
        )}
        {next && (
          <>
            <s-text>
              {t('spendMore', {
                amount: shopify.i18n.formatCurrency(next.remaining, {currency: currencyCode}),
                percent: next.percent,
              })}
            </s-text>
            <s-progress value={Math.min(1, subtotal / next.threshold)} max={1} accessibilityLabel={t('progress')} />
          </>
        )}
      </s-stack>
    </s-box>
  );
}

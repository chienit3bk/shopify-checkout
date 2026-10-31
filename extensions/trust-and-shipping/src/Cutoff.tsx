import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {cutoffStatus, formatLeft, parseCutoffConfig} from '../../../shared/shipping/cutoff';
import {amountsBeforeDiscounts} from '../../../shared/cart/subtotal';
import {freeShippingStatus, parseFreeShippingConfig} from '../../../shared/shipping/free-shipping';

export default async () => {
  render(<Cutoff />, document.body);
};

const CONFIG_KEY = 'shipping_cutoff_config';
const FREE_SHIPPING_KEY = 'free_shipping_config';
/** Same line attribute the free-gift block sets; gift lines never count towards a threshold. */
const GIFT_ATTRIBUTE_KEY = '_free_gift';

function Cutoff() {
  return (
    <s-stack gap="base">
      <FreeShippingBar />
      <CutoffBanner />
    </s-stack>
  );
}

function shopMetafield(key: string): unknown {
  return shopify.appMetafields.value.find(({target, metafield}) => target.type === 'shop' && metafield.key === key)
    ?.metafield.value;
}

/**
 * "Add $24.00 for free Express shipping" — counted like the discount Function counts:
 * amounts before discounts, excluded products and gift lines don't help.
 */
function FreeShippingBar() {
  const t = shopify.i18n.translate;
  const config = parseFreeShippingConfig(shopMetafield(FREE_SHIPPING_KEY));
  if (!config) return null;

  const currencyCode = shopify.cost.subtotalAmount.value.currencyCode;
  const lines = shopify.lines.value;
  const isGift = (line: (typeof lines)[number]) => line.attributes.some((attribute) => attribute.key === GIFT_ATTRIBUTE_KEY);
  const amounts = amountsBeforeDiscounts(shopify.cost.subtotalAmount.value.amount, lines, (line) => !isGift(line));
  const status = freeShippingStatus(config, {
    currencyCode,
    // No exchange rate in checkout: unknown currencies without an explicit amount stay hidden.
    rate: undefined,
    lines: lines.map((line, i) => ({productId: line.merchandise.product.id, subtotal: amounts[i], isGift: isGift(line)})),
  });
  if (status.threshold === null) return null;

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={status.unlocked ? 'check-circle' : 'delivery'} />
          <s-text type="strong">
            {status.unlocked
              ? t('freeShippingUnlocked', {label: config.label})
              : t('freeShippingAway', {
                  amount: shopify.i18n.formatCurrency(status.remaining, {currency: currencyCode}),
                  label: config.label.toLowerCase(),
                })}
          </s-text>
        </s-stack>
        {!status.unlocked && <s-progress value={status.ratio} max={1} accessibilityLabel={t('freeShippingProgress')} />}
        {status.excludedCount > 0 && !status.unlocked && (
          <s-text type="small" color="subdued">
            {t('freeShippingExcluded', {count: status.excludedCount})}
          </s-text>
        )}
      </s-stack>
    </s-box>
  );
}

function CutoffBanner() {
  const t = shopify.i18n.translate;
  const now = useMinuteClock();
  const config = parseCutoffConfig(shopMetafield(CONFIG_KEY));
  if (!config) return null;

  const status = cutoffStatus(config, now);
  const shipDay = formatLocalDate(status.shipDate, {weekday: 'long', month: 'short', day: 'numeric'});

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={status.shipsToday ? 'clock' : 'truck'} />
          <s-text type="strong">
            {status.shipsToday
              ? t('shipsToday', {time: formatLeft(status.msLeft)})
              : t('shipsOn', {day: shipDay})}
          </s-text>
        </s-stack>
        {status.deadline && (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-icon type="calendar" />
            <s-text color="subdued">
              {t('deadline', {
                date: formatLocalDate(status.deadline.lastOrderDate, {weekday: 'short', month: 'short', day: 'numeric'}),
                label: status.deadline.label,
              })}
            </s-text>
          </s-stack>
        )}
      </s-stack>
    </s-box>
  );
}

/** A YYYY-MM-DD warehouse date in the buyer's language (formatted as a calendar date, no timezone shift). */
function formatLocalDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = date.split('-').map(Number);
  return shopify.i18n.formatDate(new Date(Date.UTC(y, m - 1, d, 12)), {...options, timeZone: 'UTC'});
}

/** Re-renders every 30 s — the countdown shows minutes. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

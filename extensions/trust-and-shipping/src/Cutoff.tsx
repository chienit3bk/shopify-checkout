import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {cutoffStatus, formatLeft, parseCutoffConfig} from '../../../shared/shipping/cutoff';

export default async () => {
  render(<Cutoff />, document.body);
};

const CONFIG_KEY = 'shipping_cutoff_config';

function Cutoff() {
  const t = shopify.i18n.translate;
  const now = useMinuteClock();
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  const config = entry ? parseCutoffConfig(entry.metafield.value) : null;
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

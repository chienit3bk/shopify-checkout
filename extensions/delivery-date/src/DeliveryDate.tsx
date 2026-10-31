import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {earliestDeliveryDate, parseDeliveryDateConfig, pickerConstraints} from '../../../shared/delivery/date';
import {parseCutoffConfig} from '../../../shared/shipping/cutoff';

export default async () => {
  render(<DeliveryDate />, document.body);
};

function shopMetafield(key: string): unknown {
  return shopify.appMetafields.value.find(({target, metafield}) => target.type === 'shop' && metafield.key === key)
    ?.metafield.value;
}

/**
 * Delivery date picker on the warehouse calendar: no weekends, no holidays, nothing
 * before ship date + transit days (cut-off aware). The choice is a cart attribute, so it
 * shows on the order; delivery-validation re-checks it when the order is placed.
 */
function DeliveryDate() {
  const t = shopify.i18n.translate;
  const [saving, setSaving] = useState(false);
  const cutoff = parseCutoffConfig(shopMetafield('shipping_cutoff_config'));
  const config = parseDeliveryDateConfig(shopMetafield('delivery_date_config'));
  if (!cutoff || !config || !shopify.instructions.value.attributes.canUpdateAttributes) return null;

  const earliest = earliestDeliveryDate(cutoff, config, Date.now());
  const {disallow, disallowDays, defaultView} = pickerConstraints(cutoff, config, earliest);
  const chosen = shopify.attributes.value.find((attribute) => attribute.key === config.attributeKey)?.value ?? '';
  const format = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return shopify.i18n.formatDate(new Date(Date.UTC(y, m - 1, d, 12)), {weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'});
  };

  async function save(value: string) {
    setSaving(true);
    try {
      await shopify.applyAttributeChange(
        value ? {type: 'updateAttribute', key: config!.attributeKey, value} : {type: 'removeAttribute', key: config!.attributeKey},
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <s-stack gap="base">
      <s-stack gap="small-200">
        <s-text type="strong">{t('heading')}</s-text>
        <s-text color="subdued">
          {chosen ? t('chosen', {date: format(chosen)}) : t('hint', {date: format(earliest)})}
        </s-text>
      </s-stack>
      <s-date-picker
        value={chosen}
        defaultView={defaultView}
        disallow={disallow}
        disallowDays={disallowDays}
        disabled={saving}
        onChange={(event) => save((event.currentTarget as HTMLElementTagNameMap['s-date-picker']).value ?? '')}
      />
      {chosen && (
        <s-button variant="secondary" disabled={saving} onClick={() => save('')}>
          {t('clear')}
        </s-button>
      )}
    </s-stack>
  );
}

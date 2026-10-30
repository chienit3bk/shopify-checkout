import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default async () => {
  render(<Trust />, document.body);
};

/** Each slot has a fixed icon; the merchant edits the wording in the checkout editor (extension settings). */
const SLOTS = [
  {setting: 'secure_text', icon: 'lock', fallback: 'secureDefault'},
  {setting: 'returns_text', icon: 'return', fallback: 'returnsDefault'},
  {setting: 'shipping_text', icon: 'truck', fallback: 'shippingDefault'},
  {setting: 'guarantee_text', icon: 'check-circle', fallback: 'guaranteeDefault'},
] as const;

function Trust() {
  const t = shopify.i18n.translate;
  const settings = shopify.settings.value;
  const text = (key: string, fallback: string) => {
    const value = settings[key];
    return typeof value === 'string' && value.trim() ? value.trim() : t(fallback);
  };

  return (
    <s-grid gridTemplateColumns="1fr 1fr" gap="base" padding="base" background="subdued" borderRadius="base">
      {SLOTS.map((slot) => (
        // Icon column + text column, so long text wraps under itself instead of pushing the icon up.
        <s-grid key={slot.setting} gridTemplateColumns="auto 1fr" gap="small-200" alignItems="center">
          <s-icon type={slot.icon} />
          <s-text type="small">{text(slot.setting, slot.fallback)}</s-text>
        </s-grid>
      ))}
    </s-grid>
  );
}

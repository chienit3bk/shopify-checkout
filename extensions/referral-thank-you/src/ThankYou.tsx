import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {parseReferralConfig, shareUrl} from '../../../shared/referral/referral';

export default async () => {
  render(<Extension />, document.body);
};

const CONFIG_KEY = 'referral_config';

function Extension() {
  const t = shopify.i18n.translate;
  const [copied, setCopied] = useState(false);
  const entry = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'shop' && metafield.key === CONFIG_KEY,
  );
  const config = entry ? parseReferralConfig(entry.metafield.value) : null;
  if (!config) return null;

  const storefront = shopify.shop.storefrontUrl ?? `https://${shopify.shop.myshopifyDomain}`;
  const link = shareUrl(storefront, config.code);

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="base">
        <s-heading>{t('heading', {percent: config.percentOff})}</s-heading>
        <s-text>{t('body', {percent: config.percentOff})}</s-text>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge size="base">{config.code}</s-badge>
          <s-button variant="secondary" commandFor="referral-code" command="--copy">
            {copied ? t('copied') : t('copy')}
          </s-button>
          <s-clipboard-item id="referral-code" text={config.code} onCopy={() => setCopied(true)} />
        </s-stack>
        <s-link href={link} target="_blank">
          {t('shareLink')}
        </s-link>
      </s-stack>
    </s-box>
  );
}

import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {
  type Source,
  ATTRIBUTION_KEY,
  ATTRIBUTION_NAMESPACE,
  SOURCES,
  fromStoredValue,
  isSource,
  toStoredValue,
} from '../../../shared/attribution/survey';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const t = shopify.i18n.translate;
  const stored = shopify.appMetafields.value.find(
    ({target, metafield}) => target.type === 'cart' && metafield.key === ATTRIBUTION_KEY,
  );
  const initial = fromStoredValue(stored?.metafield.value);
  const [source, setSource] = useState<Source | null>(initial.source);
  const [detail, setDetail] = useState(initial.detail);
  const [saved, setSaved] = useState(Boolean(initial.source));

  // Accelerated checkouts and some contexts can't write cart metafields: skip the question.
  if (!shopify.instructions.value.metafields.canSetCartMetafields) return null;

  async function save(nextSource: Source, nextDetail: string) {
    const result = await shopify.applyMetafieldChange({
      type: 'updateCartMetafield',
      metafield: {
        namespace: ATTRIBUTION_NAMESPACE,
        key: ATTRIBUTION_KEY,
        type: 'single_line_text_field',
        value: toStoredValue(nextSource, nextDetail),
      },
    });
    setSaved(result.type === 'success');
  }

  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="base">
        <s-choice-list
          label={t('question')}
          name="attribution"
          values={source ? [source] : []}
          onChange={(event) => {
            const value = (event.currentTarget as HTMLElementTagNameMap['s-choice-list']).values?.[0];
            if (!isSource(value)) return;
            setSource(value);
            save(value, detail);
          }}
        >
          {SOURCES.map((id) => (
            <s-choice key={id} value={id}>
              {t(`sources.${id}`)}
            </s-choice>
          ))}
        </s-choice-list>
        {source === 'other' && (
          <s-text-field
            label={t('otherLabel')}
            value={detail}
            maxLength={80}
            onChange={(event) => {
              const value = (event.currentTarget as HTMLElementTagNameMap['s-text-field']).value ?? '';
              setDetail(value);
              save('other', value);
            }}
          />
        )}
        {saved && <s-text color="subdued">{t('thanks')}</s-text>}
      </s-stack>
    </s-box>
  );
}

import {register} from '@shopify/web-pixels-extension';
import {
  GIFT_EVENTS,
  GIFT_EVENT_PREFIX,
  type FunnelState,
  isGiftEventData,
  parseFunnel,
  recordGiftEvent,
  recordOrder,
} from '../../../shared/analytics/gift-funnel';
import {GIFT_ATTRIBUTE_KEY} from '../../../shared/free-gift/rules';

/** Running totals in the storefront's localStorage — readable on the store's own pages, no backend. */
const STORAGE_KEY = 'free_gift_funnel';

register(({analytics, browser, settings}) => {
  // Optional: also POST each event to the merchant's collector (GA4 proxy, Segment, …).
  const endpoint = typeof settings.endpoint === 'string' && settings.endpoint.startsWith('https://') ? settings.endpoint : null;

  // Events arrive back to back (unlock + order); serialize read-modify-write.
  let queue = Promise.resolve();
  function update(change: (state: FunnelState) => FunnelState) {
    queue = queue
      .then(async () => {
        const state = parseFunnel(await browser.localStorage.getItem(STORAGE_KEY));
        await browser.localStorage.setItem(STORAGE_KEY, JSON.stringify(change(state)));
      })
      .catch((error) => console.error('[gift-funnel] storage failed', error));
  }

  function forward(payload: Record<string, unknown>) {
    if (!endpoint) return;
    fetch(endpoint, {method: 'POST', body: JSON.stringify(payload), keepalive: true}).catch(() => {});
  }

  for (const name of GIFT_EVENTS) {
    analytics.subscribe(`${GIFT_EVENT_PREFIX}${name}`, (event) => {
      const data = event.customData;
      if (!isGiftEventData(data)) return;
      update((state) => recordGiftEvent(state, name, data));
      forward({event: `${GIFT_EVENT_PREFIX}${name}`, timestamp: event.timestamp, ...data});
    });
  }

  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data.checkout;
    const order = {
      subtotal: Number(checkout.subtotalPrice?.amount ?? 0),
      currencyCode: checkout.currencyCode ?? checkout.subtotalPrice?.currencyCode ?? 'USD',
      lines: checkout.lineItems.map((line) => ({properties: line.properties ?? []})),
    };
    update((state) => recordOrder(state, order, GIFT_ATTRIBUTE_KEY));
    forward({event: 'checkout_completed', timestamp: event.timestamp, subtotal: order.subtotal, currencyCode: order.currencyCode});
  });
});

import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Cutoff.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.shipping-option-list.render-before').Api;
  const globalThis: { shopify: typeof shopify };
}

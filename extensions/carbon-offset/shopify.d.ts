import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Offset.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.shipping-option-list.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

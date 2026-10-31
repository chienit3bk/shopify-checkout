import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Volume.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.cart-line-item.render-after').Api;
  const globalThis: { shopify: typeof shopify };
}

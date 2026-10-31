import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Spend.tsx' {
  const shopify: import('@shopify/ui-extensions/purchase.checkout.reductions.render-before').Api;
  const globalThis: { shopify: typeof shopify };
}

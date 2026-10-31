import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
  CartInput,
  CartLinesDiscountsGenerateRunResult,
} from '../generated/api';
import {type CartLike, freeGiftAllocations, parseConfig} from '../../../shared/free-gift/rules';

/**
 * Server-side half of the free gift: the checkout extension adds the gift line,
 * this Function decides whether it is actually free. It re-runs the same rules,
 * so a gift attribute added by hand (cart API, theme) never gets a discount
 * unless the cart really qualifies.
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return {operations: []};
  }

  const config = parseConfig(input.shop.config?.jsonValue);
  if (!config || config.rules.length === 0) {
    return {operations: []};
  }

  const cart: CartLike = {
    currencyCode: input.cart.cost.subtotalAmount.currencyCode,
    // Buyer-currency units per shop-currency unit: converts thresholds that have no per-market override.
    rate: Number(input.presentmentCurrencyRate) || 1,
    lines: input.cart.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      subtotal: Number(line.cost.subtotalAmount.amount),
      giftRuleId: line.giftRule?.value ?? null,
      variantId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.id : '',
      productId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '',
      inGiftCollection: line.merchandise.__typename === 'ProductVariant' && line.merchandise.product.inGiftCollection,
    })),
  };

  const allocations = freeGiftAllocations(config, cart);
  if (allocations.length === 0) {
    return {operations: []};
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: allocations.map(({lineId, quantity, rule}) => ({
            message: rule.title,
            targets: [{cartLine: {id: lineId, quantity}}],
            // Decimal scalars are serialized as strings.
            value: {percentage: {value: '100.0'}},
          })),
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

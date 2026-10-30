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

  const rate = Number(input.presentmentCurrencyRate) || 1;
  const cart: CartLike = {
    lines: input.cart.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      // Back to the shop currency, so rule amounts compare like for like.
      subtotal: Number(line.cost.subtotalAmount.amount) / rate,
      giftRuleId: line.giftRule?.value ?? null,
      variantId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.id : '',
      productId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '',
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

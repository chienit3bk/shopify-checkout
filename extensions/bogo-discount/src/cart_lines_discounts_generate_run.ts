import {
  type CartInput,
  type CartLinesDiscountsGenerateRunResult,
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';
import {appliesTo, freeUnits, parseBogoConfig} from '../../../shared/bogo/bogo';

/**
 * Buy X get Y on the same SKU. Targets only the free units of a line
 * (`cartLine.quantity`), so 3 lip oils show "1 × free" instead of 33% off each.
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const config = parseBogoConfig(input.shop.config?.jsonValue);
  if (!config || !input.discount.discountClasses.includes(DiscountClass.Product)) {
    return {operations: []};
  }

  const candidates = input.cart.lines.flatMap((line) => {
    const productId = line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '';
    if (!appliesTo(config, productId, Boolean(line.giftRule?.value))) return [];
    const quantity = freeUnits(config, line.quantity);
    if (quantity === 0) return [];
    return [
      {
        message: config.label,
        targets: [{cartLine: {id: line.id, quantity}}],
        // Decimal scalars are serialized as strings.
        value: {percentage: {value: '100.0'}},
      },
    ];
  });
  if (candidates.length === 0) return {operations: []};

  return {
    operations: [{productDiscountsAdd: {candidates, selectionStrategy: ProductDiscountSelectionStrategy.All}}],
  };
}

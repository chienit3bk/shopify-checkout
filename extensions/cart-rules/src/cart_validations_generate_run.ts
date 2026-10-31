import {
  BuyerJourneyStep,
  type CartValidationsGenerateRunInput,
  type CartValidationsGenerateRunResult,
  type ValidationError,
} from '../generated/api';
import {type Violation, parseCartRules, violations} from '../../../shared/cart/rules';

function message(v: Violation): string {
  switch (v.type) {
    case 'max_quantity':
      return `You can buy up to ${v.max} of ${v.title} per order (you have ${v.quantity}).`;
    case 'min_subtotal':
      return `The minimum order is ${v.minimum.toFixed(2)} ${v.currencyCode}. Add ${(v.minimum - v.subtotal).toFixed(2)} ${v.currencyCode} more to check out.`;
    case 'incompatible':
      return `${v.label}: ${v.titles.join(' and ')} can't be ordered together. Remove one to continue.`;
  }
}

/**
 * Max quantity per product, minimum order value per market and incompatible products.
 * Checked in checkout (not on the cart page, where buyers are still building the cart).
 */
export function cartValidationsGenerateRun(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const config = parseCartRules(input.shop.config?.jsonValue);
  if (!config || input.buyerJourney.step === BuyerJourneyStep.CartInteraction) {
    return {operations: [{validationAdd: {errors: []}}]};
  }

  const errors: ValidationError[] = violations(config, {
    currencyCode: input.cart.cost.subtotalAmount.currencyCode,
    rate: Number(input.presentmentCurrencyRate) || undefined,
    lines: input.cart.lines.map((line) => ({
      productId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '',
      title: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.title : 'This item',
      quantity: line.quantity,
      subtotal: Number(line.cost.subtotalAmount.amount),
      isGift: Boolean(line.giftRule?.value),
    })),
  }).map((v) => ({message: message(v), target: '$.cart'}));

  return {operations: [{validationAdd: {errors}}]};
}

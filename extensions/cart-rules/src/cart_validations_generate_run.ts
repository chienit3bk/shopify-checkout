import {
  BuyerJourneyStep,
  type CartValidationsGenerateRunInput,
  type CartValidationsGenerateRunResult,
  type ValidationError,
} from '../generated/api';
import {type Violation, casePackOptions, parseCartRules, violations} from '../../../shared/cart/rules';

function message(v: Violation): string {
  switch (v.type) {
    case 'max_quantity':
      return `You can buy up to ${v.max} of ${v.title} per order (you have ${v.quantity}).`;
    case 'min_subtotal':
      return `The minimum ${v.firstOrder ? 'first order' : 'order'} is ${v.minimum.toFixed(2)} ${v.currencyCode}. Add ${(v.minimum - v.subtotal).toFixed(2)} ${v.currencyCode} more to check out.`;
    case 'min_quantity':
      return `The minimum for ${v.title} is ${v.min} (you have ${v.quantity}).`;
    case 'case_pack': {
      const {lower, upper} = casePackOptions(v.size, v.quantity);
      const options = lower > 0 ? `${lower} or ${upper}` : `${upper}`;
      return `${v.title} ships in cases of ${v.size}. Change the quantity to ${options} (you have ${v.quantity}).`;
    }
    case 'incompatible':
      return `${v.label}: ${v.titles.join(' and ')} can't be ordered together. Remove one to continue.`;
  }
}

/**
 * Max quantity per product, minimum order value per market and incompatible products; for B2B
 * buyers also minimum quantity, case packs and a first-order minimum.
 * Checked in checkout (not on the cart page, where buyers are still building the cart).
 */
export function cartValidationsGenerateRun(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const config = parseCartRules(input.shop.config?.jsonValue);
  if (!config || input.buyerJourney.step === BuyerJourneyStep.CartInteraction) {
    return {operations: [{validationAdd: {errors: []}}]};
  }

  const {purchasingCompany, customer, isAuthenticated} = input.cart.buyerIdentity ?? {};
  const pastOrders = purchasingCompany
    ? purchasingCompany.location.ordersCount
    : isAuthenticated
      ? customer?.numberOfOrders
      : undefined;
  const errors: ValidationError[] = violations(config, {
    currencyCode: input.cart.cost.subtotalAmount.currencyCode,
    subtotal: Number(input.cart.cost.subtotalAmount.amount),
    isB2B: Boolean(purchasingCompany),
    isFirstOrder: pastOrders === 0,
    rate: Number(input.presentmentCurrencyRate) || undefined,
    lines: input.cart.lines.map((line) => ({
      productId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '',
      title: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.title : 'This item',
      quantity: line.quantity,
      subtotal: Number(line.cost.totalAmount.amount),
      isGift: Boolean(line.giftRule?.value),
    })),
  }).map((v) => ({message: message(v), target: '$.cart'}));

  return {operations: [{validationAdd: {errors}}]};
}

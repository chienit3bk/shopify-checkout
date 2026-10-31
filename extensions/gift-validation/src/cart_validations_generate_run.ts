import {
  BuyerJourneyStep,
  type CartValidationsGenerateRunInput,
  type CartValidationsGenerateRunResult,
  type ValidationError,
} from '../generated/api';
import {type CartLike, type InvalidGiftReason, invalidGiftLines, markExcluded, parseConfig} from '../../../shared/free-gift/rules';

const MESSAGES: Record<InvalidGiftReason, (gift: string) => string> = {
  not_eligible: (gift) => `${gift} is no longer a free gift for this order. Remove it to continue.`,
  not_offered: (gift) => `${gift} isn't one of the gifts you can choose. Remove it to continue.`,
  too_many: (gift) => `Only one ${gift} is free. Lower the quantity to continue.`,
};

/**
 * Blocks paying for a "gift" that wouldn't be free — e.g. an express checkout
 * (Shop Pay from the cart page) skips the checkout block that removes it.
 * Same rules as the discount Function, enforced only when the order is placed so
 * cart edits and the block's own add/remove steps are never interrupted.
 */
export function cartValidationsGenerateRun(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const config = parseConfig(input.shop.config?.jsonValue);
  if (!config || input.buyerJourney.step !== BuyerJourneyStep.CheckoutCompletion) {
    return {operations: [{validationAdd: {errors: []}}]};
  }

  const cart: CartLike = {
    currencyCode: input.cart.cost.subtotalAmount.currencyCode,
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

  cart.lines = markExcluded(config, cart.lines);

  const titles = new Map(
    input.cart.lines.map((line) => [
      line.id,
      line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.title : 'This gift',
    ]),
  );
  const errors: ValidationError[] = invalidGiftLines(config, cart).map(({lineId, reason}) => ({
    message: MESSAGES[reason](titles.get(lineId) ?? 'This gift'),
    target: '$.cart',
  }));

  return {operations: [{validationAdd: {errors}}]};
}

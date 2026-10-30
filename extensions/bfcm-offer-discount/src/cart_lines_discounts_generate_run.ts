import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
  CartInput,
  CartLinesDiscountsGenerateRunResult,
} from '../generated/api';
import {offerAllocations, parseOfferConfig} from '../../../shared/bfcm/offer';

/**
 * Discounts BFCM add-ons accepted in checkout. Re-checks the campaign window (shop
 * timezone), the offer's variant and its quantity cap, so a hand-made `_bfcm_offer`
 * attribute or a late checkout never gets the price.
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return {operations: []};
  }

  const config = parseOfferConfig(input.shop.config?.jsonValue);
  if (!config) {
    return {operations: []};
  }

  const lines = input.cart.lines.map((line) => ({
    id: line.id,
    quantity: line.quantity,
    offerId: line.offer?.value ?? null,
    variantId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.id : '',
  }));

  const allocations = offerAllocations(config, String(input.shop.localTime.date), lines);
  if (allocations.length === 0) {
    return {operations: []};
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: allocations.map(({lineId, quantity, offer}) => ({
            message: offer.title,
            targets: [{cartLine: {id: lineId, quantity}}],
            // Decimal scalars are serialized as strings.
            value: {percentage: {value: offer.percentOff.toFixed(1)}},
          })),
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

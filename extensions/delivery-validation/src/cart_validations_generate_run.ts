import {
  BuyerJourneyStep,
  type CartValidationsGenerateRunInput,
  type CartValidationsGenerateRunResult,
  type ValidationError,
} from '../generated/api';
import {type DateProblem, blocksPoBox, dateProblem, earliestFromShipDate, isDeliveryDay, isPoBox, addDays, parseDeliveryDateConfig} from '../../../shared/delivery/date';
import {parseCutoffConfig} from '../../../shared/shipping/cutoff';

const DATE_MESSAGES: Record<DateProblem, string> = {
  invalid: "We couldn't read the delivery date. Please pick it again.",
  too_early: 'That delivery date is no longer possible. Please pick a later date.',
  too_late: 'Please pick a delivery date within the next 30 days.',
  not_a_delivery_day: "We don't deliver on that day. Please pick another date.",
};

/**
 * - PO Box + a carrier that can't deliver there (Express/UPS): an error on the address
 *   field as soon as the buyer enters it.
 * - Delivery date (cart attribute from the delivery-date block): re-checked when the
 *   order is placed, against the warehouse calendar.
 */
export function cartValidationsGenerateRun(input: CartValidationsGenerateRunInput): CartValidationsGenerateRunResult {
  const config = parseDeliveryDateConfig(input.shop.config?.jsonValue);
  const cutoff = parseCutoffConfig(input.shop.cutoff?.jsonValue);
  const step = input.buyerJourney.step;
  const errors: ValidationError[] = [];
  if (!config || step === BuyerJourneyStep.CartInteraction) return {operations: [{validationAdd: {errors}}]};

  input.cart.deliveryGroups.forEach((group, i) => {
    const address = group.deliveryAddress;
    if (address && blocksPoBox(config, group.selectedDeliveryOption?.title) && isPoBox(address.address1, address.address2)) {
      errors.push({
        message: "Express (UPS) can't deliver to a PO Box. Choose Standard or use a street address.",
        target: `$.cart.deliveryGroups[${i}].deliveryAddress.address1`,
      });
    }
  });

  const chosen = input.cart.deliveryDate?.value;
  if (chosen && cutoff && step === BuyerJourneyStep.CheckoutCompletion) {
    // The Function only knows the shop's date, not the time: assume it still ships today if it's
    // a ship day (the block already enforced the cut-off), so a valid choice is never rejected.
    let shipDate = input.shop.localTime.date;
    for (let i = 0; i < 31 && !isDeliveryDay(cutoff, shipDate); i++) shipDate = addDays(shipDate, 1);
    const problem = dateProblem(cutoff, config, chosen, earliestFromShipDate(cutoff, config, shipDate));
    if (problem) errors.push({message: DATE_MESSAGES[problem], target: '$.cart'});
  }

  return {operations: [{validationAdd: {errors}}]};
}

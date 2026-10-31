import type {
  CartDeliveryOptionsTransformRunInput,
  CartDeliveryOptionsTransformRunResult,
  Operation,
} from '../generated/api';
import {cartWeightKg, deliveryOperations, parseDeliveryRules} from '../../../shared/delivery/rules';

/**
 * Hides, renames and reorders delivery options per group: by cart weight (no Express
 * over 1 kg), destination country (carrier names for US buyers) and subtotal.
 */
export function cartDeliveryOptionsTransformRun(
  input: CartDeliveryOptionsTransformRunInput,
): CartDeliveryOptionsTransformRunResult {
  const config = parseDeliveryRules(input.shop.config?.jsonValue);
  if (!config || config.rules.length === 0) return {operations: []};

  const weightKg = cartWeightKg(
    input.cart.lines.map((line) =>
      line.merchandise.__typename === 'ProductVariant'
        ? {quantity: line.quantity, weight: line.merchandise.weight ?? null, weightUnit: line.merchandise.weightUnit}
        : {quantity: line.quantity, weight: null, weightUnit: 'GRAMS' as const},
    ),
  );
  const subtotal = Number(input.cart.cost.subtotalAmount.amount);

  const operations: Operation[] = input.cart.deliveryGroups.flatMap((group) =>
    deliveryOperations(config, group.deliveryOptions.map((o) => ({handle: o.handle, title: o.title ?? null})), {
      weightKg,
      subtotal,
      countryCode: group.deliveryAddress?.countryCode ?? null,
    }).map((op): Operation => {
      switch (op.type) {
        case 'hide':
          return {deliveryOptionHide: {deliveryOptionHandle: op.handle}};
        case 'rename':
          return {deliveryOptionRename: {deliveryOptionHandle: op.handle, title: op.title}};
        case 'move':
          return {deliveryOptionMove: {deliveryOptionHandle: op.handle, index: op.index}};
      }
    }),
  );
  return {operations};
}

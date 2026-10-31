import {
  type CartDeliveryOptionsDiscountsGenerateRunResult,
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
  type CartDeliveryOptionsDiscountsGenerateRunInput,
} from '../generated/api';
import {freeShippingStatus, matchesMethod, parseFreeShippingConfig} from '../../../shared/shipping/free-shipping';

/**
 * Makes the configured delivery methods free once the lines that count reach the
 * threshold. Unlike a rate condition, excluded products (sale items, gift lines)
 * don't help reach it. The checkout bar reads the same config and the same rule.
 */
export function cartDeliveryOptionsDiscountsGenerateRun(
  input: CartDeliveryOptionsDiscountsGenerateRunInput,
): CartDeliveryOptionsDiscountsGenerateRunResult {
  const config = parseFreeShippingConfig(input.shop.config?.jsonValue);
  if (!config || !input.discount.discountClasses.includes(DiscountClass.Shipping)) {
    return {operations: []};
  }

  const status = freeShippingStatus(config, {
    currencyCode: input.cart.cost.subtotalAmount.currencyCode,
    rate: Number(input.presentmentCurrencyRate) || undefined,
    lines: input.cart.lines.map((line) => ({
      productId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '',
      subtotal: Number(line.cost.subtotalAmount.amount),
      isGift: Boolean(line.giftRule?.value),
    })),
  });
  if (!status.unlocked) return {operations: []};

  const handles = input.cart.deliveryGroups.flatMap((group) =>
    group.deliveryOptions.filter((option) => matchesMethod(config, option.title)).map((option) => option.handle),
  );
  if (handles.length === 0) return {operations: []};

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates: handles.map((handle) => ({
            message: config.label,
            targets: [{deliveryOption: {handle}}],
            // Decimal scalars are serialized as strings.
            value: {percentage: {value: '100.0'}},
          })),
          selectionStrategy: DeliveryDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

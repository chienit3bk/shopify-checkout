import {
  type CartInput,
  type CartLinesDiscountsGenerateRunResult,
  type CartOperation,
  DiscountClass,
  OrderDiscountSelectionStrategy,
  ProductDiscountSelectionStrategy,
} from '../generated/api';
import {parseTiersConfig, spendProgress, volumeProgress} from '../../../shared/tiers/tiers';

/**
 * One config, two discount classes:
 *   PRODUCT — volume tiers per SKU (quantity summed across lines of the same variant),
 *   ORDER   — spend tiers on the subtotal of the lines that count (no gifts, no excluded products).
 */
export function cartLinesDiscountsGenerateRun(input: CartInput): CartLinesDiscountsGenerateRunResult {
  const config = parseTiersConfig(input.shop.config?.jsonValue);
  if (!config) return {operations: []};

  const lines = input.cart.lines.map((line) => ({
    id: line.id,
    quantity: line.quantity,
    subtotal: Number(line.cost.subtotalAmount.amount),
    isGift: Boolean(line.giftRule?.value),
    variantId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.id : '',
    productId: line.merchandise.__typename === 'ProductVariant' ? line.merchandise.product.id : '',
  }));
  const operations: CartOperation[] = [];

  if (config.volume && input.discount.discountClasses.includes(DiscountClass.Product)) {
    const volume = config.volume;
    const eligible = lines.filter((line) => !line.isGift && volume.productIds.includes(line.productId));
    const perVariant = new Map<string, number>();
    eligible.forEach((line) => perVariant.set(line.variantId, (perVariant.get(line.variantId) ?? 0) + line.quantity));

    const candidates = eligible.flatMap((line) => {
      const tier = volumeProgress(volume.tiers, perVariant.get(line.variantId) ?? 0).current;
      if (!tier) return [];
      return [
        {
          message: `${volume.label} — ${tier.percent}% off`,
          targets: [{cartLine: {id: line.id}}],
          value: {percentage: {value: tier.percent.toFixed(1)}},
        },
      ];
    });
    if (candidates.length) {
      operations.push({productDiscountsAdd: {candidates, selectionStrategy: ProductDiscountSelectionStrategy.All}});
    }
  }

  if (config.spend && input.discount.discountClasses.includes(DiscountClass.Order)) {
    const excluded = new Set(config.spend.excludedProductIds);
    const notCounted = lines.filter((line) => line.isGift || excluded.has(line.productId));
    const subtotal = lines.filter((line) => !notCounted.includes(line)).reduce((sum, line) => sum + line.subtotal, 0);
    const tier = spendProgress(
      config,
      subtotal,
      input.cart.cost.subtotalAmount.currencyCode,
      Number(input.presentmentCurrencyRate) || undefined,
    ).current;
    if (tier) {
      operations.push({
        orderDiscountsAdd: {
          candidates: [
            {
              message: `${config.spend.label} — ${tier.percent}% off`,
              targets: [{orderSubtotal: {excludedCartLineIds: notCounted.map((line) => line.id)}}],
              value: {percentage: {value: tier.percent.toFixed(1)}},
            },
          ],
          selectionStrategy: OrderDiscountSelectionStrategy.First,
        },
      });
    }
  }

  return {operations};
}

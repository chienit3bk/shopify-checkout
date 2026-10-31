/**
 * Line amounts before discounts — what Shopify Functions read as `cost.subtotalAmount`.
 *
 * Checkout UI extensions only get `cost.totalAmount`, which is after every discount.
 * Line-level discounts are listed on the line (`discountAllocations`), but a line's share
 * of an *order* discount is baked into `totalAmount` and listed nowhere on the line. The
 * cart subtotal (`shopify.cost.subtotalAmount`) is after line discounts and before order
 * discounts, so: order discounts = cart subtotal − Σ line totals, handed back to the lines
 * that can receive them in proportion to their totals (how Shopify allocates them).
 *
 * Without this, a "spend $X more" bar disagrees with the Function that applies the offer.
 */
export interface LineAmounts {
  cost: {totalAmount: {amount: number}};
  discountAllocations: ReadonlyArray<{discountedAmount: {amount: number}}>;
}

export function amountsBeforeDiscounts<T extends LineAmounts>(
  cartSubtotal: number,
  lines: readonly T[],
  receivesOrderDiscounts: (line: T) => boolean,
): number[] {
  const totals = lines.map((line) => line.cost.totalAmount.amount);
  const orderDiscounts = Math.max(0, cartSubtotal - totals.reduce((sum, total) => sum + total, 0));
  const base = lines.reduce((sum, line, i) => sum + (receivesOrderDiscounts(line) ? totals[i] : 0), 0);

  return lines.map((line, i) => {
    const lineDiscounts = line.discountAllocations.reduce((sum, allocation) => sum + allocation.discountedAmount.amount, 0);
    const share = base > 0 && receivesOrderDiscounts(line) ? (orderDiscounts * totals[i]) / base : 0;
    return round2(totals[i] + lineDiscounts + share);
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

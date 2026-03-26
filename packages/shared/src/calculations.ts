/**
 * SplitCheck Calculation Engine
 *
 * All functions are pure — no side effects, no DB access.
 * Uses banker's rounding (round half to even) throughout.
 */

/**
 * Banker's rounding: rounds to N decimal places, rounding 0.5 to the nearest even number.
 * Example: bankersRound(2.5, 0) = 2, bankersRound(3.5, 0) = 4
 */
export function bankersRound(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals);
  const shifted = value * multiplier;
  const truncated = Math.trunc(shifted);
  const remainder = Math.abs(shifted - truncated);

  // If remainder is exactly 0.5, round to even
  if (Math.abs(remainder - 0.5) < 1e-9) {
    if (truncated % 2 === 0) {
      return truncated / multiplier;
    }
    return (truncated + (shifted > 0 ? 1 : -1)) / multiplier;
  }

  return Math.round(shifted) / multiplier;
}

/**
 * Calculate line total for an item: quantity × unit_price
 */
export function calculateLineTotal(
  quantity: number,
  unitPrice: number
): number {
  return bankersRound(quantity * unitPrice, 2);
}

/**
 * Calculate the cost of a shared item per claimant: line_total ÷ claimant_count
 * If only 1 claimant, they pay the full cost.
 */
export function calculateSharedItemCost(
  lineTotal: number,
  claimantCount: number
): number {
  if (claimantCount <= 0) {
    return 0;
  }
  return bankersRound(lineTotal / claimantCount, 2);
}

/**
 * Calculate cost for a non-shared item claim: unit_price × claimed_quantity
 */
export function calculateClaimAmount(
  unitPrice: number,
  claimedQuantity: number
): number {
  return bankersRound(unitPrice * claimedQuantity, 2);
}

/**
 * Calculate personal subtotal: sum of all claim amounts for a participant
 */
export function calculatePersonalSubtotal(claimAmounts: number[]): number {
  const sum = claimAmounts.reduce((acc, amount) => acc + amount, 0);
  return bankersRound(sum, 2);
}

/**
 * Calculate tax and service amounts from bill subtotal and percentages.
 */
export function calculateSessionTotals(
  billSubtotal: number,
  taxPct: number,
  servicePct: number
): { taxAmount: number; serviceAmount: number } {
  return {
    taxAmount: bankersRound(billSubtotal * taxPct / 100, 2),
    serviceAmount: bankersRound(billSubtotal * servicePct / 100, 2),
  };
}

/**
 * Split an amount equally among N participants.
 * Returns an array of N amounts. The remainder (from rounding) goes to the host (index 0).
 *
 * Example: splitEqually(70, 3) → [23.34, 23.33, 23.33]
 */
export function splitEqually(
  totalAmount: number,
  participantCount: number
): number[] {
  if (participantCount <= 0) {
    return [];
  }
  if (participantCount === 1) {
    return [bankersRound(totalAmount, 2)];
  }

  const perPerson = bankersRound(totalAmount / participantCount, 2);
  const shares = Array(participantCount).fill(perPerson) as number[];

  // Calculate remainder and assign to host (index 0)
  const distributed = bankersRound(perPerson * participantCount, 2);
  const remainder = bankersRound(totalAmount - distributed, 2);

  if (remainder !== 0) {
    shares[0] = bankersRound(shares[0] + remainder, 2);
  }

  return shares;
}

/**
 * Calculate a single participant's personal total.
 */
export function calculatePersonalTotal(
  subtotal: number,
  taxShare: number,
  serviceShare: number
): number {
  return bankersRound(subtotal + taxShare + serviceShare, 2);
}

/**
 * Calculate the rounding difference between the expected bill total
 * and the sum of all personal totals.
 */
export function calculateRoundingDifference(
  billTotal: number,
  personalTotals: number[]
): number {
  const sumOfTotals = personalTotals.reduce((acc, t) => acc + t, 0);
  return bankersRound(billTotal - sumOfTotals, 2);
}

/**
 * Validate that the sum of personal totals matches the bill total within tolerance.
 * Tolerance: ± EGP 0.10
 */
export function isWithinTolerance(
  billTotal: number,
  personalTotals: number[],
  toleranceEgp: number = 0.10
): boolean {
  const diff = Math.abs(calculateRoundingDifference(billTotal, personalTotals));
  return diff <= toleranceEgp;
}

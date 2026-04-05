/**
 * Calculate the case size in natural units.
 * For packaged items: unitsPerCase × packSize (e.g. 6 tins × 400g = 2400g).
 * For loose/bulk items: packSize alone (e.g. 5kg bag = 5).
 */
export function calculateCaseSize(unitsPerCase: number | null, packSize: number): number {
  return unitsPerCase ? unitsPerCase * packSize : packSize;
}

/**
 * Convert Infinity Foods VAT rate code to a percentage.
 * Codes: 0 = zero-rated (0%), 2 = standard rate (20%).
 */
export function vatRateToPercent(vatCode: number): number {
  if (vatCode === 2) return 20;
  return 0;
}

/**
 * Estimate the cost for a member's claim on a proportional basis.
 * @param claimAmount  Amount the member wants (in natural units)
 * @param caseSize     Total units per case (from calculateCaseSize)
 * @param casePrice    Trade price per case in £
 * @param vatCode      Infinity Foods VAT code (0 = zero-rated, 2 = standard 20%)
 */
export function estimateCost(
  claimAmount: number,
  caseSize: number,
  casePrice: number,
  vatCode: number,
): { net: number; vat: number; gross: number } {
  if (claimAmount === 0) {
    return { net: 0, vat: 0, gross: 0 };
  }
  const proportion = claimAmount / caseSize;
  const net = proportion * casePrice;
  const vatPercent = vatRateToPercent(vatCode);
  const vat = net * (vatPercent / 100);
  const gross = net + vat;
  return { net, vat, gross };
}

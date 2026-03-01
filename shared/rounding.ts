import type { Claim, RoundingResult, RoundingStatus } from './types';

export function calculateRounding(
  claims: Pick<Claim, 'amount' | 'flexibility'>[],
  unitsPerCase: number | null,
  packSize: number
): RoundingResult {
  const totalClaimed = claims.reduce((sum, c) => sum + c.amount, 0);

  // Case size in natural units
  const caseSize = unitsPerCase ? unitsPerCase * packSize : packSize;

  if (totalClaimed === 0) {
    return { totalClaimed: 0, caseSize, casesNeeded: 0, gap: 0, status: 'needs_more' };
  }

  const casesNeeded = Math.ceil(totalClaimed / caseSize);
  const gap = casesNeeded * caseSize - totalClaimed;

  let status: RoundingStatus;
  if (gap === 0) {
    status = 'ready';
  } else if (gap < caseSize * 0.2 && claims.some((c) => c.flexibility === '+' || c.flexibility === '+-')) {
    status = 'nearly';
  } else if (totalClaimed > casesNeeded * caseSize && claims.some((c) => c.flexibility === '-' || c.flexibility === '+-')) {
    status = 'over';
  } else {
    status = 'needs_more';
  }

  return { totalClaimed, caseSize, casesNeeded, gap, status };
}

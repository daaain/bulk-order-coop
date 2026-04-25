export function formatPrice(pence: number): string {
  return `£${pence.toFixed(2)}`;
}

export function formatWeight(amount: number, unit: string): string {
  if (unit === 'g' && amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}kg`;
  }
  if (unit === 'ml' && amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}l`;
  }
  return `${amount}${unit}`;
}

export function formatCaseSize(
  unitsPerCase: number | null,
  packSize: number,
  unit: string,
): string {
  if (unitsPerCase) {
    return `${unitsPerCase}×${formatWeight(packSize, unit)}`;
  }
  return formatWeight(packSize, unit);
}

/**
 * Returns how much to increment the claim amount input by for one whole case.
 * For packaged items (amount input is in packs): returns unitsPerCase (packs per case).
 * For bulk/loose items (amount input is in natural units): returns packSize (case weight).
 */
export function getCaseIncrement(
  unitsPerCase: number | null,
  packSize: number,
): number | undefined {
  if (unitsPerCase != null && unitsPerCase > 0) return unitsPerCase;
  if (packSize > 0) return packSize;
  return undefined;
}

export function isPackaged(unitsPerCase: number | null): boolean {
  return unitsPerCase != null && unitsPerCase > 0;
}

function toPacks(amount: number, packSize: number): number {
  return packSize > 0 ? Math.round(amount / packSize) : amount;
}

export function formatClaimAmount(
  amount: number,
  unitsPerCase: number | null,
  packSize: number,
  unit: string,
): string {
  if (isPackaged(unitsPerCase)) {
    const packs = toPacks(amount, packSize);
    return `${packs} pack${packs === 1 ? '' : 's'}`;
  }
  return `${amount}${unit}`;
}

export function formatClaimDelta(
  delta: number,
  unitsPerCase: number | null,
  packSize: number,
  unit: string,
): string {
  const sign = delta >= 0 ? '+' : '-';
  return `${sign}${formatClaimAmount(Math.abs(delta), unitsPerCase, packSize, unit)}`;
}

export function calculateCasePriceGross(
  casePrice: number,
  vatPerCase: number,
): number {
  return casePrice + vatPerCase;
}

export interface UnitPrice {
  price: number;
  perUnit: string;
  secondary?: { price: number; perUnit: string };
}

function weightPriceFromTotal(gross: number, totalSize: number, unit: string) {
  if (totalSize === 0) return undefined;
  if (unit === 'g') return { price: (gross / totalSize) * 1000, perUnit: 'kg' };
  if (unit === 'ml') return { price: (gross / totalSize) * 1000, perUnit: 'l' };
  if (unit === 'l') return { price: gross / totalSize, perUnit: 'l' };
  if (unit === 'kg') return { price: gross / totalSize, perUnit: 'kg' };
  return undefined;
}

export function calculateUnitPriceGross(
  casePrice: number,
  vatPerCase: number,
  unitsPerCase: number | null,
  packSize: number,
  unit: string,
): UnitPrice {
  const gross = casePrice + vatPerCase;

  // Packaged items: price per pack, plus optional per-kg/l when pack size is a weight/volume
  if (unitsPerCase) {
    const secondary = weightPriceFromTotal(gross, unitsPerCase * packSize, unit);
    return { price: gross / unitsPerCase, perUnit: 'pack', secondary };
  }

  // Loose items: price per kg or l
  if (packSize === 0) {
    const perUnit = unit === 'ml' || unit === 'l' ? 'l' : 'kg';
    return { price: 0, perUnit };
  }

  return weightPriceFromTotal(gross, packSize, unit) ?? { price: gross / packSize, perUnit: 'kg' };
}

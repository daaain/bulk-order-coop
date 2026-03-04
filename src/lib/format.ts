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

export function formatCaseSize(unitsPerCase: number | null, packSize: number, unit: string): string {
  if (unitsPerCase) {
    return `${unitsPerCase}×${formatWeight(packSize, unit)}`;
  }
  return formatWeight(packSize, unit);
}

export function calculateUnitPriceGross(
  casePrice: number,
  vatPerCase: number,
  unitsPerCase: number | null,
  packSize: number,
  unit: string
): { price: number; perUnit: string } {
  const gross = casePrice + vatPerCase;

  // Packaged items: price per pack
  if (unitsPerCase) {
    return { price: gross / unitsPerCase, perUnit: 'pack' };
  }

  // Loose items: price per kg or l
  if (packSize === 0) {
    const perUnit = unit === 'ml' || unit === 'l' ? 'l' : 'kg';
    return { price: 0, perUnit };
  }

  if (unit === 'g') {
    return { price: (gross / packSize) * 1000, perUnit: 'kg' };
  }
  if (unit === 'ml') {
    return { price: (gross / packSize) * 1000, perUnit: 'l' };
  }
  if (unit === 'l') {
    return { price: gross / packSize, perUnit: 'l' };
  }
  // kg or other
  return { price: gross / packSize, perUnit: 'kg' };
}

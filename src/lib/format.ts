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

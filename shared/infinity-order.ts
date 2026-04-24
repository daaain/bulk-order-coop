export interface InfinityOrderLine {
  productCode: string;
  cases: number;
}

// CSV format accepted by Infinity Foods' order entry system.
// Header row followed by `productCode,cases` rows.
export function formatInfinityOrderCsv(lines: InfinityOrderLine[]): string {
  const header = 'Item number, Quantity';
  const rows = lines.map((l) => `${l.productCode},${l.cases}`);
  return [header, ...rows].join('\n');
}

// Lenient parser for the same format we emit — tolerates extra whitespace, CRLF
// line endings, and either the header row or no header. Skips blank lines and
// any row whose quantity doesn't parse as a positive integer.
export function parseInfinityOrderCsv(csv: string): InfinityOrderLine[] {
  const lines = csv.replace(/\r\n/g, '\n').split('\n');
  const result: InfinityOrderLine[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const [productCode, qtyStr] = parts;
    if (!productCode || /^item\s*number/i.test(productCode)) continue;
    const cases = Number(qtyStr);
    if (!Number.isFinite(cases) || !Number.isInteger(cases) || cases <= 0) continue;
    result.push({ productCode, cases });
  }
  return result;
}

// Split `total` across `parts` positive amounts that sum to exactly `total`.
// Used when distributing test claims across random members — each member gets
// a plausible share rather than everyone getting an identical split.
export function splitAmountRandomly(
  total: number,
  parts: number,
  rng: () => number = Math.random,
): number[] {
  if (parts <= 0) return [];
  if (parts === 1) return [total];

  // Generate positive weights, normalise to target, then patch the last entry
  // so the sum is exact (floating-point drift otherwise breaks gap===0 ready).
  const weights = Array.from({ length: parts }, () => rng() + 0.1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) => Math.round(((w / weightSum) * total) * 100) / 100);
  const diff = total - amounts.reduce((a, b) => a + b, 0);
  amounts[amounts.length - 1] = Math.round((amounts[amounts.length - 1] + diff) * 100) / 100;
  return amounts;
}

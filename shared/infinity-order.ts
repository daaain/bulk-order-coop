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

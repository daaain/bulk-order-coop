import { parseCsvLine } from './csv';
import type { InfinityOrderLine } from './infinity-order';

// A line from the provisional invoice Infinity send back after an order is
// placed — only what they can actually supply appears on it.
export interface ProvisionalLine extends InfinityOrderLine {
  description: string;
}

// A line we submitted, with enough detail to describe it even after the order
// item has been swapped away.
export interface SubmittedLine extends InfinityOrderLine {
  description: string;
}

// Snapshot taken when the provisional invoice is uploaded: what Infinity
// confirmed alongside what we had submitted at that moment. Kept so later
// swaps can be told apart from items that were never confirmed.
export interface ProvisionalCheck {
  fileName: string;
  checkedAt: string;
  submitted: SubmittedLine[];
  provisional: ProvisionalLine[];
}

export interface MissingLine {
  productCode: string;
  description: string;
  ordered: number;
  confirmed: number;
  // False once the item has been swapped out (or removed) since the check.
  stillOnOrder: boolean;
}

export interface ProvisionalComparison {
  // Submitted but not (fully) confirmed on the provisional invoice.
  missing: MissingLine[];
  // Cases added to the order since the check (typically swap replacements)
  // that still need to go on the Infinity order.
  additions: SubmittedLine[];
  // On the provisional invoice but not in what we submitted.
  unexpected: ProvisionalLine[];
}

function findColumn(header: string[], pattern: RegExp, fallback: number): number {
  const idx = header.findIndex((h) => pattern.test(h.trim()));
  return idx === -1 ? fallback : idx;
}

// Parses Infinity's "order" CSV export (the provisional invoice). Columns are
// located by header name so column reordering doesn't break parsing; without
// a recognisable header it falls back to `code,quantity` like our own export.
// Repeated product codes are summed.
export function parseProvisionalOrderCsv(csv: string): ProvisionalLine[] {
  const rows = csv
    .replace(/^\u{FEFF}/u, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map(parseCsvLine);
  if (rows.length === 0) return [];

  const header = rows[0];
  const hasHeader = header.some((h) => /product\s*code|item\s*number/i.test(h));
  const codeCol = findColumn(header, /^(product\s*code|item\s*number)$/i, 0);
  const qtyCol = findColumn(header, /^(order\s*)?quantity$/i, 1);
  const descCol = hasHeader ? findColumn(header, /^description$/i, -1) : -1;

  const byCode = new Map<string, ProvisionalLine>();
  for (const cols of hasHeader ? rows.slice(1) : rows) {
    const productCode = (cols[codeCol] ?? '').trim();
    const cases = Number((cols[qtyCol] ?? '').trim());
    if (!productCode || !Number.isInteger(cases) || cases <= 0) continue;
    const description = descCol >= 0 ? (cols[descCol] ?? '').trim() : '';
    const existing = byCode.get(productCode);
    if (existing) existing.cases += cases;
    else byCode.set(productCode, { productCode, cases, description });
  }
  return [...byCode.values()];
}

export function compareWithProvisional(
  check: Pick<ProvisionalCheck, 'submitted' | 'provisional'>,
  current: SubmittedLine[],
): ProvisionalComparison {
  const confirmed = new Map(check.provisional.map((l) => [l.productCode, l.cases]));
  const submitted = new Map(check.submitted.map((l) => [l.productCode, l]));
  const currentCodes = new Set(current.map((l) => l.productCode));

  const missing: MissingLine[] = [];
  for (const line of check.submitted) {
    const got = confirmed.get(line.productCode) ?? 0;
    if (got >= line.cases) continue;
    missing.push({
      productCode: line.productCode,
      description: line.description,
      ordered: line.cases,
      confirmed: got,
      stillOnOrder: currentCodes.has(line.productCode),
    });
  }

  const additions: SubmittedLine[] = [];
  for (const line of current) {
    const before = submitted.get(line.productCode);
    // Items we'd already submitted only count the growth since the check —
    // re-adding their unconfirmed cases would just be refused again. New items
    // count whatever Infinity hasn't already confirmed.
    const baseline = before ? before.cases : (confirmed.get(line.productCode) ?? 0);
    const extra = line.cases - baseline;
    if (extra > 0) additions.push({ ...line, cases: extra });
  }

  const unexpected = check.provisional.filter((l) => !submitted.has(l.productCode));

  return { missing, additions, unexpected };
}

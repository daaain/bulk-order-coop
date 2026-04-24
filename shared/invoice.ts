export interface PositionedTextItem {
  str: string;
  x: number;
  y: number;
  page: number;
}

export interface InvoiceLineItem {
  productCode: string;
  size: string;
  organic: boolean;
  description: string;
  rrp: number | null;
  brand: string;
  changeMarker: string | null;
  ordered: number;
  invoiced: number;
  short: number | null;
  unitPrice: number | null;
  cost: number;
  vat: number | null;
}

export interface InvoiceTotals {
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  nettGoodsValue: number;
  vat: number;
  totalPayable: number;
  cases: number;
  totalWeight: string;
}

export interface ParsedInvoice {
  invoiceNumber: string;
  date: string;
  customerName: string;
  items: InvoiceLineItem[];
  totals: InvoiceTotals;
}

export interface PositionedRow {
  y: number;
  page: number;
  tokens: PositionedTextItem[];
}

const ROW_Y_TOLERANCE = 2;

// Column x-position ranges from the Infinity Foods invoice PDF layout
const COL = {
  CODE: { min: 15, max: 55 },
  SIZE: { min: 45, max: 58 },
  ORGANIC: { min: 82, max: 96 },
  PRODUCT: { min: 116, max: 280 },
  RRP: { min: 280, max: 300 },
  BRAND: { min: 306, max: 370 },
  CHANGE_MARKER: { min: 370, max: 385 },
  ORDERED: { min: 386, max: 400 },
  INVOICED: { min: 404, max: 418 },
  UNIT_PRICE: { min: 476, max: 496 },
  COST: { min: 513, max: 545 },
  VAT: { min: 550, max: 575 },
} as const;

const CHANGE_MARKERS = new Set(['M', 'p', 'q', 'E', 'L', 'R', 't']);

export function groupItemsIntoRows(items: PositionedTextItem[]): PositionedRow[] {
  if (items.length === 0) return [];

  // Sort by page ascending, then y descending (PDF: higher y = higher on page)
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y);

  const rows: PositionedRow[] = [];
  let currentRow: PositionedRow = { y: sorted[0].y, page: sorted[0].page, tokens: [sorted[0]] };
  let maxY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    // Only group items from the same page within y-tolerance
    if (item.page === currentRow.page && maxY - item.y <= ROW_Y_TOLERANCE) {
      currentRow.tokens.push(item);
    } else {
      rows.push(currentRow);
      currentRow = { y: item.y, page: item.page, tokens: [item] };
      maxY = item.y;
    }
  }
  rows.push(currentRow);

  // Sort tokens within each row left-to-right
  for (const row of rows) {
    row.tokens.sort((a, b) => a.x - b.x);
  }

  return rows;
}

function inRange(x: number, col: { min: number; max: number }): boolean {
  return x >= col.min && x <= col.max;
}

type RowType = 'item' | 'lot' | 'header' | 'other';

function classifyRow(row: PositionedRow): RowType {
  if (row.tokens.length === 0) return 'other';

  const first = row.tokens[0];

  // Lot lines: start around x=30 with "Lot"
  if (first.str.startsWith('Lot') && first.x >= 25 && first.x <= 35) {
    return 'lot';
  }

  // Header rows: contain column labels like "code" or "product"
  if (row.tokens.some((t) => t.str === 'code' || t.str === 'product')) {
    return 'header';
  }

  // Item rows: first token is a numeric product code in the CODE x-range
  if (/^\d+$/.test(first.str) && first.x >= COL.CODE.min && first.x < COL.ORGANIC.min) {
    return 'item';
  }

  return 'other';
}

function collectTokens(
  tokens: PositionedTextItem[],
  col: { min: number; max: number },
): PositionedTextItem[] {
  return tokens.filter((t) => inRange(t.x, col));
}

function joinTokens(tokens: PositionedTextItem[]): string {
  return tokens.map((t) => t.str).join(' ');
}

function firstTokenValue(tokens: PositionedTextItem[]): string | null {
  return tokens.length > 0 ? tokens[0].str : null;
}

function parseItemRow(row: PositionedRow): InvoiceLineItem {
  const tokens = row.tokens;

  const productCode = tokens[0].str;

  // Size: second token if it's in SIZE range
  const sizeTokens = collectTokens(tokens, COL.SIZE);
  const size = joinTokens(sizeTokens) || '';

  // Organic: check for "organic" token
  const organicTokens = collectTokens(tokens, COL.ORGANIC);
  const organic = organicTokens.some((t) => t.str.toLowerCase() === 'organic');

  // Description: all tokens in PRODUCT range
  const descTokens = collectTokens(tokens, COL.PRODUCT);
  const description = joinTokens(descTokens);

  // RRP
  const rrpStr = firstTokenValue(collectTokens(tokens, COL.RRP));
  const rrp = rrpStr ? parseFloat(rrpStr) : null;

  // Brand: all tokens in BRAND range (can be multi-word)
  const brandTokens = tokens.filter(
    (t) => t.x >= COL.BRAND.min && t.x < COL.CHANGE_MARKER.min && !CHANGE_MARKERS.has(t.str),
  );
  const brand = joinTokens(brandTokens);

  // Change marker
  const markerTokens = collectTokens(tokens, COL.CHANGE_MARKER);
  const changeMarker =
    markerTokens.length > 0 && CHANGE_MARKERS.has(markerTokens[0].str) ? markerTokens[0].str : null;

  // Ordered / Invoiced
  const orderedStr = firstTokenValue(collectTokens(tokens, COL.ORDERED));
  const invoicedStr = firstTokenValue(collectTokens(tokens, COL.INVOICED));
  const ordered = orderedStr ? parseInt(orderedStr, 10) : 0;
  const invoiced = invoicedStr ? parseInt(invoicedStr, 10) : 0;

  // Unit price (only present when qty > 1)
  const unitPriceStr = firstTokenValue(collectTokens(tokens, COL.UNIT_PRICE));
  const unitPrice = unitPriceStr ? parseFloat(unitPriceStr) : null;

  // Cost (total line cost)
  const costStr = firstTokenValue(collectTokens(tokens, COL.COST));
  const cost = costStr ? parseFloat(costStr) : 0;

  // VAT amount
  const vatStr = firstTokenValue(collectTokens(tokens, COL.VAT));
  const vat = vatStr ? parseFloat(vatStr) : null;

  // Short is derived: ordered - invoiced when ordered > invoiced
  const short = ordered > invoiced ? ordered - invoiced : null;

  return {
    productCode,
    size,
    organic,
    description,
    rrp,
    brand,
    changeMarker,
    ordered,
    invoiced,
    short,
    unitPrice,
    cost,
    vat,
  };
}

function parseHeader(rows: PositionedRow[]): {
  invoiceNumber: string;
  date: string;
  customerName: string;
} {
  let invoiceNumber = '';
  let date = '';
  let customerName = '';

  // Scan top rows for header fields
  for (const row of rows) {
    for (const token of row.tokens) {
      // Invoice number: standalone 6-digit number, not a product code row
      if (!invoiceNumber && /^\d{6}$/.test(token.str) && token.x >= 130 && token.x <= 250) {
        invoiceNumber = token.str;
      }

      // Date: dd/mm/yy pattern
      if (!date && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(token.str)) {
        date = token.str;
      }

      // Customer name: on the INVOICE row (contains "INVOICE" at x≈140-230)
      if (
        !customerName &&
        row.tokens.some((t) => t.str === 'INVOICE' && t.x >= 130 && t.x <= 230)
      ) {
        const nameToken = row.tokens.find((t) => t.x >= 270 && t.x <= 400);
        if (nameToken) {
          customerName = nameToken.str;
        }
      }
    }

    if (invoiceNumber && date && customerName) break;
  }

  return { invoiceNumber, date, customerName };
}

// Match a number in the totals column: £-prefixed ("£1763.39") or bare ("1723.39").
const MONEY_TOKEN = /^£?(\d+(?:\.\d+)?)$/;

function firstMoneyValue(
  row: PositionedRow,
  opts: { minX?: number; excludeXs?: Set<number> } = {},
): number | null {
  const minX = opts.minX ?? 450;
  for (const t of row.tokens) {
    if (t.x <= minX) continue;
    if (opts.excludeXs?.has(t.x)) continue;
    const m = t.str.match(MONEY_TOKEN);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

function parseTotals(rows: PositionedRow[]): InvoiceTotals {
  let subtotal = 0;
  let discountPercentage = 0;
  let discountAmount = 0;
  let nettGoodsValue = 0;
  let vat = 0;
  let totalPayable = 0;
  let cases = 0;
  let totalWeight = '';

  // Parse from the last page where totals appear
  const lastPage = Math.max(...rows.map((r) => r.page));
  const lastPageRows = rows.filter((r) => r.page === lastPage);

  for (const row of lastPageRows) {
    const text = row.tokens.map((t) => t.str).join(' ');

    // SUBTOTAL row — pre-discount goods value. May share the row with a VAT
    // subtotal column; take the first (left-most) money token.
    if (row.tokens.some((t) => t.str === 'SUBTOTAL')) {
      const v = firstMoneyValue(row);
      if (v !== null) subtotal = v;
    }

    // Discount row — e.g. "6% Discount  110.01  2.55". Extract the percentage
    // and the first £/numeric amount.
    if (row.tokens.some((t) => t.str === 'Discount' || t.str === 'discount')) {
      for (const t of row.tokens) {
        const m = t.str.match(/^(\d+(?:\.\d+)?)%$/);
        if (m) {
          discountPercentage = parseFloat(m[1]);
          break;
        }
      }
      const v = firstMoneyValue(row);
      if (v !== null) discountAmount = v;
    }

    // NETT GOODS VALUE row
    if (text.includes('NETT GOODS VALUE')) {
      const v = firstMoneyValue(row);
      if (v !== null) nettGoodsValue = v;
    }

    // TOTAL row — accept either "TOTAL PAYABLE" or a bare "TOTAL" token
    // (Infinity Foods uses the latter when a discount is applied).
    const hasTotalPayable = text.includes('TOTAL PAYABLE');
    const hasBareTotal =
      !hasTotalPayable &&
      !text.includes('SUBTOTAL') &&
      row.tokens.some((t) => t.str === 'TOTAL');
    if (hasTotalPayable || hasBareTotal) {
      const v = firstMoneyValue(row);
      if (v !== null) totalPayable = v;
    }

    // VAT row (standalone "VAT" label in totals area, not the column header)
    if (
      row.tokens.some((t) => t.str === 'VAT' && t.x > 400) &&
      !text.includes('NETT') &&
      !text.includes('TOTAL') &&
      !text.includes('rate')
    ) {
      const v = firstMoneyValue(row);
      if (v !== null) vat = v;
    }

    // Cases
    for (const token of row.tokens) {
      if (token.str === 'cases') {
        const numToken = row.tokens.find((t) => t.x > token.x && /^\d+(\.\d+)?$/.test(t.str));
        if (numToken) {
          cases = parseFloat(numToken.str);
        }
      }
    }

    // Total weight
    for (const token of row.tokens) {
      const weightMatch = token.str.match(/^(\d+\.?\d*Kg)$/);
      if (weightMatch) {
        totalWeight = weightMatch[1];
      }
    }
  }

  // Invoices without an explicit SUBTOTAL row (no discount applied): the
  // subtotal equals the nett goods value.
  if (subtotal === 0 && nettGoodsValue > 0) {
    subtotal = nettGoodsValue + discountAmount;
  }

  return {
    subtotal,
    discountPercentage,
    discountAmount,
    nettGoodsValue,
    vat,
    totalPayable,
    cases,
    totalWeight,
  };
}

export function parseInvoice(items: PositionedTextItem[]): ParsedInvoice {
  const rows = groupItemsIntoRows(items.filter((i) => i.str.trim() !== ''));
  const header = parseHeader(rows);
  const totals = parseTotals(rows);

  const lineItems: InvoiceLineItem[] = [];
  for (const row of rows) {
    if (classifyRow(row) === 'item') {
      lineItems.push(parseItemRow(row));
    }
  }

  return { ...header, items: lineItems, totals };
}

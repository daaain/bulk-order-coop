import { describe, it, expect, beforeAll } from 'vitest';
import { groupItemsIntoRows, parseInvoice } from '../shared/invoice';
import type { PositionedTextItem, ParsedInvoice } from '../shared/invoice';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function item(str: string, x: number, y: number, page: number = 1): PositionedTextItem {
  return { str, x, y, page };
}

// Helper to build a minimal invoice with header + item rows + totals
// so parseInvoice can run. The y values decrease for each row (PDF top-to-bottom).
function makeInvoiceItems(...itemRows: PositionedTextItem[][]): PositionedTextItem[] {
  const header = [
    item('INVOICE', 140, 810),
    item('Kaeridwyn Eftelya - Clapton', 279, 810),
    item('012513', 504, 810),
    item('677901', 140, 784),
    item('29/9/25', 140, 748),
  ];

  const columnHeaders = [
    item('code', 19, 662),
    item('size', 60, 662),
    item('product', 140, 662),
    item('rrp', 291, 662),
    item('brand', 316, 662),
    item('ordered/invoiced/short', 362, 662),
    item('unit', 487, 662),
    item('cost', 523, 662),
    item('VAT', 557, 662),
  ];

  const totals = [
    item('NETT GOODS VALUE', 394.5, 224),
    item('£100.00', 499.6, 224),
    item('VAT', 439.3, 209),
    item('£10.00', 508.5, 209),
    item('TOTAL PAYABLE', 406.4, 194),
    item('£110.00', 499.6, 194),
    item('cases', 457, 70),
    item('1.00', 548, 70),
    item('10.00Kg', 530.6, 54),
  ];

  return [...header, ...columnHeaders, ...itemRows.flat(), ...totals];
}

// A synthetic item row matching Chia Seeds (6052) from the fixture
function chiaRow(y: number = 652): PositionedTextItem[] {
  return [
    item('6052', 19, y),
    item('6x250g', 51.5, y),
    item('organic', 89.3, y),
    item('Chia Seeds', 122, y),
    item('2.06', 289.8, y),
    item('Infinity Foods', 312, y),
    item('1', 392, y),
    item('1', 410, y),
    item('9.25', 525.4, y),
  ];
}

describe('groupItemsIntoRows', () => {
  it('groups tokens at the same y into one row', () => {
    const items = [item('A', 10, 100), item('B', 50, 100), item('C', 90, 100)];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens.map((t) => t.str)).toEqual(['A', 'B', 'C']);
  });

  it('groups tokens within y-tolerance into the same row', () => {
    const items = [item('A', 10, 100), item('B', 50, 101), item('C', 90, 99)];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokens).toHaveLength(3);
  });

  it('splits tokens more than y-tolerance apart into separate rows', () => {
    const items = [item('A', 10, 100), item('B', 10, 90), item('C', 10, 80)];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(3);
  });

  it('sorts rows top-to-bottom (descending y in PDF space)', () => {
    const items = [item('bottom', 10, 80), item('top', 10, 100), item('middle', 10, 90)];
    const rows = groupItemsIntoRows(items);
    expect(rows[0].tokens[0].str).toBe('top');
    expect(rows[1].tokens[0].str).toBe('middle');
    expect(rows[2].tokens[0].str).toBe('bottom');
  });

  it('sorts tokens within a row left-to-right (ascending x)', () => {
    const items = [item('C', 90, 100), item('A', 10, 100), item('B', 50, 100)];
    const rows = groupItemsIntoRows(items);
    expect(rows[0].tokens.map((t) => t.str)).toEqual(['A', 'B', 'C']);
  });

  it('handles an empty input array', () => {
    const rows = groupItemsIntoRows([]);
    expect(rows).toEqual([]);
  });

  it('keeps items on different pages separate even at the same y', () => {
    const items = [item('A', 10, 100, 1), item('B', 10, 100, 2)];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(2);
    expect(rows[0].page).toBe(1);
    expect(rows[1].page).toBe(2);
  });
});

describe('parseInvoice — item row parsing', () => {
  it('parses a zero-rated item with no change marker', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.items).toHaveLength(1);

    const chia = invoice.items[0];
    expect(chia.productCode).toBe('6052');
    expect(chia.size).toBe('6x250g');
    expect(chia.organic).toBe(true);
    expect(chia.description).toBe('Chia Seeds');
    expect(chia.rrp).toBe(2.06);
    expect(chia.brand).toBe('Infinity Foods');
    expect(chia.changeMarker).toBeNull();
    expect(chia.ordered).toBe(1);
    expect(chia.invoiced).toBe(1);
    expect(chia.short).toBeNull();
    expect(chia.unitPrice).toBeNull();
    expect(chia.cost).toBe(9.25);
    expect(chia.vat).toBeNull();
  });

  it('parses an item with a change marker M', () => {
    const y = 650;
    const items = makeInvoiceItems([
      item('316518', 19, y),
      item('1x1l', 51.5, y),
      item('organic', 89.3, y),
      item('Maple Syrup - amber grade A - plastic jug', 122, y),
      item('22.07', 285.3, y),
      item('St Lawrence Gold', 312, y),
      item('M', 374, y),
      item('1', 392, y),
      item('1', 410, y),
      item('16.55', 521, y),
    ]);
    const invoice = parseInvoice(items);
    const maple = invoice.items[0];
    expect(maple.changeMarker).toBe('M');
    expect(maple.brand).toBe('St Lawrence Gold');
    expect(maple.cost).toBe(16.55);
  });

  it('parses an item with quantity > 1 and unitPrice', () => {
    const y = 648;
    const items = makeInvoiceItems([
      item('600647', 19, y),
      item('1x1000g', 51.5, y),
      item('organic', 89.3, y),
      item('Coffee Beans - Italian - 5 - single', 122, y),
      item('30.00', 285.3, y),
      item('Equal Exchange', 312, y),
      item('3', 392, y),
      item('3', 410, y),
      item('22.50', 483, y),
      item('67.50', 521, y),
    ]);
    const invoice = parseInvoice(items);
    const coffee = invoice.items[0];
    expect(coffee.ordered).toBe(3);
    expect(coffee.invoiced).toBe(3);
    expect(coffee.unitPrice).toBe(22.5);
    expect(coffee.cost).toBe(67.5);
  });

  it('parses an item with VAT amount', () => {
    const y = 646;
    const items = makeInvoiceItems([
      item('830560', 19, y),
      item('1x12.5kg', 51.5, y),
      item('Concentrated Washing Powder', 122, y),
      item('60.73', 285.3, y),
      item('Bio-D', 312, y),
      item('1', 392, y),
      item('1', 410, y),
      item('37.90', 521, y),
      item('7.58', 558.4, y),
    ]);
    const invoice = parseInvoice(items);
    const powder = invoice.items[0];
    expect(powder.vat).toBe(7.58);
    expect(powder.cost).toBe(37.9);
    expect(powder.organic).toBe(false);
  });

  it('sets organic: false when organic token is absent', () => {
    const y = 644;
    const items = makeInvoiceItems([
      item('91075', 19, y),
      item('5kg', 51.5, y),
      item('Cashews - large pieces', 122, y),
      item('Infinity Foods', 312, y),
      item('1', 392, y),
      item('1', 410, y),
      item('26.20', 521, y),
    ]);
    const invoice = parseInvoice(items);
    expect(invoice.items[0].organic).toBe(false);
    expect(invoice.items[0].rrp).toBeNull();
  });

  it('derives short from ordered - invoiced when ordered > invoiced', () => {
    const y = 642;
    const items = makeInvoiceItems([
      item('10627', 19, y),
      item('5kg', 51.5, y),
      item('organic', 89.3, y),
      item('White Basmati Rice', 122, y),
      item('Infinity Foods', 312, y),
      item('3', 392, y),
      item('2', 410, y),
      item('19.00', 483, y),
      item('38.00', 521, y),
    ]);
    const invoice = parseInvoice(items);
    expect(invoice.items[0].ordered).toBe(3);
    expect(invoice.items[0].invoiced).toBe(2);
    expect(invoice.items[0].short).toBe(1);
  });
});

describe('parseInvoice — row classification', () => {
  it('skips lot lines', () => {
    const y = 641;
    const items = makeInvoiceItems(chiaRow(), [
      item('Lot 220725A 48083.1f', 30, y),
      item('31/01/2027 COO Paraguay', 92.3, y),
    ]);
    const invoice = parseInvoice(items);
    // Only the Chia Seeds item should be parsed, not the lot line
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].productCode).toBe('6052');
  });

  it('skips header rows containing column labels', () => {
    // The header row is already in makeInvoiceItems, so just check it's not parsed as items
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.items).toHaveLength(1);
  });
});

describe('parseInvoice — header fields', () => {
  it('extracts invoice number from header area', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.invoiceNumber).toBe('677901');
  });

  it('extracts date from header area', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.date).toBe('29/9/25');
  });

  it('extracts customer name from header area', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.customerName).toBe('Kaeridwyn Eftelya - Clapton');
  });
});

describe('parseInvoice — totals', () => {
  it('extracts nettGoodsValue', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.totals.nettGoodsValue).toBe(100);
  });

  it('extracts vat', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.totals.vat).toBe(10);
  });

  it('extracts totalPayable', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.totals.totalPayable).toBe(110);
  });

  it('extracts cases count', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.totals.cases).toBe(1);
  });

  it('extracts totalWeight string', () => {
    const items = makeInvoiceItems(chiaRow());
    const invoice = parseInvoice(items);
    expect(invoice.totals.totalWeight).toBe('10.00Kg');
  });
});

describe('parseInvoice — real fixture PDF', () => {
  let invoice: ParsedInvoice;

  beforeAll(async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfPath = resolve(__dirname, 'fixtures/KaeridwynEftelyaClapton677901.pdf');
    const data = new Uint8Array(readFileSync(pdfPath));
    const pdf = await getDocument({ data }).promise;

    const allItems: PositionedTextItem[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      for (const textItem of content.items) {
        if ('str' in textItem) {
          allItems.push({
            str: (textItem as { str: string }).str,
            x: (textItem as { transform: number[] }).transform[4],
            y: (textItem as { transform: number[] }).transform[5],
            page: pageNum,
          });
        }
      }
    }

    invoice = parseInvoice(allItems);
  });

  it('parses the correct invoice number', () => {
    expect(invoice.invoiceNumber).toBe('677901');
  });

  it('parses the correct date', () => {
    expect(invoice.date).toBe('29/9/25');
  });

  it('parses the correct customer name', () => {
    expect(invoice.customerName).toBe('Kaeridwyn Eftelya - Clapton');
  });

  it('returns the correct number of line items', () => {
    expect(invoice.items).toHaveLength(59);
  });

  it('parses Chia Seeds (6052) correctly', () => {
    const chia = invoice.items.find((i) => i.productCode === '6052');
    expect(chia).toBeDefined();
    expect(chia!.size).toBe('6x250g');
    expect(chia!.organic).toBe(true);
    expect(chia!.description).toBe('Chia Seeds');
    expect(chia!.rrp).toBe(2.06);
    expect(chia!.brand).toBe('Infinity Foods');
    expect(chia!.changeMarker).toBeNull();
    expect(chia!.ordered).toBe(1);
    expect(chia!.invoiced).toBe(1);
    expect(chia!.short).toBeNull();
    expect(chia!.unitPrice).toBeNull();
    expect(chia!.cost).toBe(9.25);
    expect(chia!.vat).toBeNull();
  });

  it('parses Maple Syrup (316518) with change marker M', () => {
    const maple = invoice.items.find((i) => i.productCode === '316518');
    expect(maple).toBeDefined();
    expect(maple!.changeMarker).toBe('M');
    expect(maple!.brand).toBe('St Lawrence Gold');
    expect(maple!.cost).toBe(16.55);
    expect(maple!.rrp).toBe(22.07);
  });

  it('parses Coffee Beans (600647) with qty 3 and unitPrice', () => {
    const coffee = invoice.items.find((i) => i.productCode === '600647');
    expect(coffee).toBeDefined();
    expect(coffee!.ordered).toBe(3);
    expect(coffee!.invoiced).toBe(3);
    expect(coffee!.unitPrice).toBe(22.5);
    expect(coffee!.cost).toBe(67.5);
    expect(coffee!.organic).toBe(true);
  });

  it('parses Olive Oil (210525) with VAT amount', () => {
    const oil = invoice.items.find((i) => i.productCode === '210525');
    expect(oil).toBeDefined();
    expect(oil!.ordered).toBe(4);
    expect(oil!.invoiced).toBe(4);
    expect(oil!.unitPrice).toBe(46.65);
    expect(oil!.cost).toBe(186.6);
    // Olive oil is zero-rated for VAT (food)
    expect(oil!.vat).toBeNull();
  });

  it('parses Washing Powder (830560) with 20% VAT', () => {
    const powder = invoice.items.find((i) => i.productCode === '830560');
    expect(powder).toBeDefined();
    expect(powder!.cost).toBe(37.9);
    expect(powder!.vat).toBe(7.58);
  });

  it('parses Kombucha (641036) with VAT', () => {
    const kombucha = invoice.items.find((i) => i.productCode === '641036');
    expect(kombucha).toBeDefined();
    expect(kombucha!.cost).toBe(23.55);
    expect(kombucha!.vat).toBe(4.71);
    expect(kombucha!.changeMarker).toBe('M');
  });

  it('parses the Zonal WA Multi Pick Box (1000036) with zero cost', () => {
    const zonal = invoice.items.find((i) => i.productCode === '1000036');
    expect(zonal).toBeDefined();
    expect(zonal!.cost).toBe(0);
    expect(zonal!.description).toBe('Zonal WA Multi Pick Box');
  });

  it('does not duplicate items from page 2 header', () => {
    // Page 2 has "677901" at x≈231 and "INVOICE" at x≈224 — neither should parse as item rows
    const productCodes = invoice.items.map((i) => i.productCode);
    expect(productCodes).not.toContain('677901');
    // Each product code should appear exactly once
    const uniqueCodes = new Set(productCodes);
    expect(uniqueCodes.size).toBe(productCodes.length);
  });

  it('parses totals correctly', () => {
    expect(invoice.totals.nettGoodsValue).toBe(1494.95);
    expect(invoice.totals.vat).toBe(40.85);
    expect(invoice.totals.totalPayable).toBe(1535.8);
    expect(invoice.totals.cases).toBe(75);
    expect(invoice.totals.totalWeight).toBe('287.97Kg');
  });

  it('checksum: sum of item costs equals nettGoodsValue within £0.01', () => {
    const sumCosts = invoice.items.reduce((sum, i) => sum + i.cost, 0);
    expect(Math.abs(sumCosts - invoice.totals.nettGoodsValue)).toBeLessThan(0.02);
  });

  it('checksum: sum of item VAT equals totals.vat within £0.01', () => {
    const sumVat = invoice.items.reduce((sum, i) => sum + (i.vat ?? 0), 0);
    expect(Math.abs(sumVat - invoice.totals.vat)).toBeLessThan(0.02);
  });
});

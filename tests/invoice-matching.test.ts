import { describe, it, expect } from 'vitest';
import { matchInvoiceToOrder } from '../shared/invoice-matching';
import type { OrderItemForMatching } from '../shared/invoice-matching';
import type { InvoiceLineItem, ParsedInvoice } from '../shared/invoice';

function makeLine(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    productCode: '0000',
    size: '',
    organic: false,
    description: '',
    rrp: null,
    brand: '',
    changeMarker: null,
    ordered: 1,
    invoiced: 1,
    short: null,
    unitPrice: null,
    cost: 10,
    vat: null,
    ...overrides,
  };
}

function makeInvoice(items: InvoiceLineItem[]): ParsedInvoice {
  return {
    invoiceNumber: '000000',
    date: '01/01/26',
    customerName: 'Test',
    items,
    totals: { nettGoodsValue: 0, vat: 0, totalPayable: 0, cases: 0, totalWeight: '0Kg' },
  };
}

const chiaOrderItem: OrderItemForMatching = {
  orderItemId: 'oi-chia',
  productCode: '6052',
  description: 'Chia Seeds',
  casePrice: 9.25,
  unitsPerCase: 6,
  packSize: 250, // → caseSize = 1500g
};

const oilOrderItem: OrderItemForMatching = {
  orderItemId: 'oi-oil',
  productCode: '210525',
  description: 'Olive Oil',
  casePrice: 46.65,
  unitsPerCase: 1,
  packSize: 5, // → caseSize = 5l
};

describe('matchInvoiceToOrder', () => {
  it('marks fully invoiced items as arrived', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 9.25 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].status).toBe('arrived');
    expect(result.missing).toHaveLength(0);
  });

  it('marks partially invoiced items as partial with actualQuantity in natural units', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '210525', ordered: 4, invoiced: 2, unitPrice: 46.65, cost: 93.3 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [oilOrderItem]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].status).toBe('partial');
    // 2 cases × 5l = 10l
    expect(result.matched[0].actualQuantity).toBe(10);
  });

  it('marks items not on invoice as missing', () => {
    const invoice = makeInvoice([]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].status).toBe('missing');
    expect(result.missing[0].orderItemId).toBe('oi-chia');
  });

  it('marks items with invoiced=0 as missing', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '6052', ordered: 1, invoiced: 0, cost: 0 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].status).toBe('missing');
  });

  it('marks items with different prices as different_price with actualPrice', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 11.5 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.matched[0].status).toBe('different_price');
    expect(result.matched[0].actualPrice).toBe(11.5);
  });

  it('uses unitPrice for per-case price when qty > 1', () => {
    const invoice = makeInvoice([
      makeLine({
        productCode: '210525',
        ordered: 4,
        invoiced: 4,
        unitPrice: 50.0, // differs from order's 46.65
        cost: 200.0,
      }),
    ]);
    const result = matchInvoiceToOrder(invoice, [oilOrderItem]);
    expect(result.matched[0].status).toBe('different_price');
    expect(result.matched[0].actualPrice).toBe(50.0);
  });

  it('treats invoice prices up to £0.10 above catalogue as arrived (rounding cushion)', () => {
    const invoice = makeInvoice([
      // catalogue casePrice 9.25, invoice 9.35 → exactly at the £0.10 ceiling
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 9.35 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.matched[0].status).toBe('arrived');
  });

  it('flags invoice prices more than £0.10 above catalogue as different_price', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 9.36 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.matched[0].status).toBe('different_price');
    expect(result.matched[0].actualPrice).toBe(9.36);
  });

  it('flags any price drop as different_price (no downward tolerance)', () => {
    const invoice = makeInvoice([
      // 1p below catalogue: members would have overpaid → flag for refund
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 9.24 }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.matched[0].status).toBe('different_price');
    expect(result.matched[0].actualPrice).toBe(9.24);
  });

  it('reports invoice items with no matching order item as invoiceOnly', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 9.25 }),
      makeLine({
        productCode: '999999',
        ordered: 1,
        invoiced: 1,
        cost: 5.0,
        description: 'Surprise item',
      }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.invoiceOnly).toHaveLength(1);
    expect(result.invoiceOnly[0].productCode).toBe('999999');
  });

  it('excludes zero-cost items (e.g. 1000036) from invoiceOnly', () => {
    const invoice = makeInvoice([
      makeLine({ productCode: '6052', ordered: 1, invoiced: 1, cost: 9.25 }),
      makeLine({
        productCode: '1000036',
        ordered: 1,
        invoiced: 1,
        cost: 0,
        description: 'Zonal WA Multi Pick Box',
      }),
    ]);
    const result = matchInvoiceToOrder(invoice, [chiaOrderItem]);
    expect(result.invoiceOnly).toHaveLength(0);
  });

  it('partial takes precedence over different_price', () => {
    const invoice = makeInvoice([
      makeLine({
        productCode: '210525',
        ordered: 4,
        invoiced: 2,
        unitPrice: 50.0, // also different
        cost: 100.0,
      }),
    ]);
    const result = matchInvoiceToOrder(invoice, [oilOrderItem]);
    expect(result.matched[0].status).toBe('partial');
  });
});

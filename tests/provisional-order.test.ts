import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInfinityOrderCsv } from '$shared/infinity-order';
import { compareWithProvisional, parseProvisionalOrderCsv } from '$shared/provisional-order';

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8');

describe('parseProvisionalOrderCsv', () => {
  it('parses the Infinity order export by header name', () => {
    const lines = parseProvisionalOrderCsv(fixture('provisional-order.csv'));
    expect(lines).toHaveLength(70);
    expect(lines[0]).toEqual({
      productCode: '853511',
      cases: 1,
      description: 'Grapefruit & Orange Shampoo - Aluminium Faith in Nature 6x500ml',
    });
    expect(lines.find((l) => l.productCode === '200575')?.cases).toBe(6);
  });

  it('copes with reordered columns, CRLF and a BOM', () => {
    const csv =
      String.fromCharCode(0xfeff) +
      'Description,"Order Quantity","Product Code"\r\n"Oats, rolled",2,1001\r\n';
    expect(parseProvisionalOrderCsv(csv)).toEqual([
      { productCode: '1001', cases: 2, description: 'Oats, rolled' },
    ]);
  });

  it('falls back to code,quantity when there is no recognisable header', () => {
    expect(parseProvisionalOrderCsv('1001,2\n1002,1\n')).toEqual([
      { productCode: '1001', cases: 2, description: '' },
      { productCode: '1002', cases: 1, description: '' },
    ]);
  });

  it('accepts our own submission export format', () => {
    const lines = parseProvisionalOrderCsv('Item number, Quantity\n1001,2\n');
    expect(lines).toEqual([{ productCode: '1001', cases: 2, description: '' }]);
  });

  it('sums repeated product codes and skips zero or invalid quantities', () => {
    const csv = '"Product Code","Order Quantity"\n1001,1\n1001,2\n1002,0\n1003,abc\n,1\n';
    expect(parseProvisionalOrderCsv(csv)).toEqual([
      { productCode: '1001', cases: 3, description: '' },
    ]);
  });
});

describe('compareWithProvisional', () => {
  const line = (productCode: string, cases: number, description = `Item ${productCode}`) => ({
    productCode,
    cases,
    description,
  });

  it('finds the items missing from the real provisional invoice', () => {
    const submitted = parseInfinityOrderCsv(fixture('submission-export.csv')).map((l) =>
      line(l.productCode, l.cases),
    );
    const provisional = parseProvisionalOrderCsv(fixture('provisional-order.csv'));
    const result = compareWithProvisional({ submitted, provisional }, submitted);

    expect(result.missing.map((m) => [m.productCode, m.ordered, m.confirmed])).toEqual([
      ['20654', 4, 0],
      ['20655', 2, 0],
      ['390273', 2, 1],
      ['60122', 1, 0],
      ['63482', 1, 0],
      ['7020', 4, 0],
      ['830560', 1, 0],
      ['833075', 1, 0],
    ]);
    expect(result.missing.every((m) => m.stillOnOrder)).toBe(true);
    expect(result.additions).toEqual([]);
    expect(result.unexpected).toEqual([]);
  });

  it('marks swapped-out items as resolved and lists their replacements as additions', () => {
    const submitted = [line('A', 2), line('B', 1), line('C', 1)];
    const provisional = [line('A', 2), line('C', 1)];
    // B swapped for D; C swapped into A (merge) adding one more case of A.
    const current = [line('A', 3), line('D', 1)];

    const result = compareWithProvisional({ submitted, provisional }, current);

    expect(result.missing).toEqual([
      { productCode: 'B', description: 'Item B', ordered: 1, confirmed: 0, stillOnOrder: false },
    ]);
    expect(result.additions).toEqual([line('A', 1), line('D', 1)]);
  });

  it('does not re-add cases of a swapped-in item Infinity has already confirmed', () => {
    const result = compareWithProvisional(
      { submitted: [line('A', 1)], provisional: [line('B', 1)] },
      [line('B', 2)],
    );
    expect(result.additions).toEqual([line('B', 1)]);
    expect(result.unexpected).toEqual([line('B', 1)]);
  });
});

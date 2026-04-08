import { describe, it, expect } from 'vitest';
import { searchItems } from '../src/lib/catalogue';
import type { ParsedCatalogueItem } from '../shared/csv';

function item(partial: Partial<ParsedCatalogueItem>): ParsedCatalogueItem {
  return {
    productCode: '100001',
    description: '',
    brand: '',
    organic: false,
    casePrice: 10,
    vatRate: 0,
    vatPerCase: 0,
    unitsPerCase: 6,
    packSize: 400,
    unit: 'g',
    rrp: null,
    barcode: '',
    active: true,
    onOffer: false,
    ...partial,
  };
}

describe('searchItems', () => {
  const items = [
    item({ productCode: '100001', description: 'Tomatoes Chopped Organic', brand: 'Biona' }),
    item({ productCode: '100002', description: 'Chopped Tomatoes in Juice', brand: 'Suma' }),
    item({ productCode: '100003', description: 'Tomato Passata', brand: 'Mr Organic' }),
    item({ productCode: '100004', description: 'Kidney Beans', brand: 'Biona' }),
  ];

  it('returns all items for an empty query', () => {
    expect(searchItems(items, '')).toHaveLength(4);
    expect(searchItems(items, '   ')).toHaveLength(4);
  });

  it('matches a single substring in the description', () => {
    const result = searchItems(items, 'passata');
    expect(result).toHaveLength(1);
    expect(result[0].productCode).toBe('100003');
  });

  it('matches on brand alone', () => {
    const result = searchItems(items, 'biona');
    expect(result.map((i) => i.productCode).sort()).toEqual(['100001', '100004']);
  });

  it('matches on product code', () => {
    const result = searchItems(items, '100002');
    expect(result).toHaveLength(1);
    expect(result[0].productCode).toBe('100002');
  });

  it('is word-order-independent across the description', () => {
    // Both "Tomatoes Chopped Organic" and "Chopped Tomatoes in Juice"
    // should match regardless of the order the user types the words.
    const a = searchItems(items, 'chopped tomatoes');
    const b = searchItems(items, 'tomatoes chopped');
    expect(a.map((i) => i.productCode).sort()).toEqual(['100001', '100002']);
    expect(b.map((i) => i.productCode).sort()).toEqual(['100001', '100002']);
  });

  it('matches terms that straddle description and brand', () => {
    // "biona" is in the brand column, "tomatoes" is in the description.
    // Neither field contains the full query as a substring.
    const result = searchItems(items, 'biona tomatoes');
    expect(result).toHaveLength(1);
    expect(result[0].productCode).toBe('100001');
  });

  it('requires every term to match (AND semantics)', () => {
    // "biona" matches two items, but only one is a tomato product.
    const result = searchItems(items, 'biona beans');
    expect(result).toHaveLength(1);
    expect(result[0].productCode).toBe('100004');
  });

  it('is case-insensitive', () => {
    expect(searchItems(items, 'BIONA TOMATOES')).toHaveLength(1);
  });
});

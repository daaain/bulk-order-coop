import { describe, it, expect } from 'vitest';
import { validateAddItem, validateClaim } from '$server/services/items';

const VALID_SNAPSHOT = {
  productCode: '1001',
  description: 'Arborio Rice',
  brand: 'Infinity Foods',
  organic: true,
  casePrice: 15.55,
  vatRate: 0,
  vatPerCase: 0,
  unitsPerCase: 6,
  packSize: 500,
  unit: 'g',
  rrp: 3.46,
  barcode: '5028869010010',
};

describe('validateAddItem', () => {
  it('accepts a valid full snapshot', () => {
    const result = validateAddItem(VALID_SNAPSHOT);
    expect(result).toEqual({
      productCode: '1001',
      description: 'Arborio Rice',
      brand: 'Infinity Foods',
      organic: true,
      casePrice: 15.55,
      vatRate: 0,
      vatPerCase: 0,
      unitsPerCase: 6,
      packSize: 500,
      unit: 'g',
      rrp: 3.46,
      barcode: '5028869010010',
    });
  });

  it('rejects missing productCode', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, productCode: '' });
    expect(result).toEqual({ error: 'productCode is required' });
  });

  it('rejects missing description', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, description: '' });
    expect(result).toEqual({ error: 'description is required' });
  });

  it('rejects zero casePrice', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, casePrice: 0 });
    expect(result).toEqual({ error: 'casePrice must be a positive number' });
  });

  it('rejects negative casePrice', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, casePrice: -5 });
    expect(result).toEqual({ error: 'casePrice must be a positive number' });
  });

  it('rejects invalid vatRate', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, vatRate: 5 });
    expect(result).toEqual({ error: 'vatRate must be 0 or 2' });
  });

  it('accepts vatRate 2', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, vatRate: 2, vatPerCase: 2.33 });
    expect('error' in result).toBe(false);
    expect((result as Record<string, unknown>).vatRate).toBe(2);
  });

  it('rejects zero packSize', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, packSize: 0 });
    expect(result).toEqual({ error: 'packSize must be a positive number' });
  });

  it('rejects missing unit', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, unit: '' });
    expect(result).toEqual({ error: 'unit is required' });
  });

  it('accepts optional notes', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, notes: 'Get the green one' });
    expect((result as Record<string, unknown>).notes).toBe('Get the green one');
  });

  it('strips empty notes', () => {
    const result = validateAddItem({ ...VALID_SNAPSHOT, notes: '   ' });
    expect((result as Record<string, unknown>).notes).toBeUndefined();
  });

  it('handles null optional fields', () => {
    const result = validateAddItem({
      ...VALID_SNAPSHOT,
      brand: null,
      unitsPerCase: null,
      rrp: null,
      barcode: null,
    });
    expect('error' in result).toBe(false);
    const r = result as Record<string, unknown>;
    expect(r.brand).toBeNull();
    expect(r.unitsPerCase).toBeNull();
    expect(r.rrp).toBeNull();
    expect(r.barcode).toBeNull();
  });
});

describe('validateClaim', () => {
  it('accepts a valid amount with no flexibility', () => {
    const result = validateClaim({ amount: 2.5 });
    expect(result).toEqual({ amount: 2.5 });
  });

  it('accepts valid flexibility values', () => {
    for (const flexibility of ['+', '-', '+-', '*']) {
      const result = validateClaim({ amount: 1, flexibility });
      expect(result).toEqual({ amount: 1, flexibility });
    }
  });

  it('rejects zero amount', () => {
    const result = validateClaim({ amount: 0 });
    expect(result).toEqual({ error: 'amount must be a positive number' });
  });

  it('rejects negative amount', () => {
    const result = validateClaim({ amount: -1 });
    expect(result).toEqual({ error: 'amount must be a positive number' });
  });

  it('rejects non-numeric amount', () => {
    const result = validateClaim({ amount: 'lots' });
    expect(result).toEqual({ error: 'amount must be a positive number' });
  });

  it('rejects missing amount', () => {
    const result = validateClaim({});
    expect(result).toEqual({ error: 'amount must be a positive number' });
  });

  it('rejects invalid flexibility value', () => {
    const result = validateClaim({ amount: 1, flexibility: 'maybe' });
    expect(result).toEqual({ error: 'flexibility must be one of: +, -, +-, *' });
  });
});

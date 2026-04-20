import { describe, it, expect } from 'vitest';
import { calculateCasePriceGross, calculateUnitPriceGross, getCaseIncrement } from '../src/lib/format';

describe('calculateCasePriceGross', () => {
  it('returns case price with VAT included', () => {
    // casePrice=17.00, vatPerCase=3.40 (20%) → 20.40
    expect(calculateCasePriceGross(17.0, 3.4)).toBeCloseTo(20.4, 2);
  });

  it('returns case price unchanged when no VAT', () => {
    expect(calculateCasePriceGross(15.55, 0)).toBeCloseTo(15.55, 2);
  });
});

describe('calculateUnitPriceGross', () => {
  it('returns per-pack price for packaged items (unitsPerCase set)', () => {
    // 6×500g, casePrice=15.55, vat=0 → gross=15.55/6 = 2.5917
    const result = calculateUnitPriceGross(15.55, 0, 6, 500, 'g');
    expect(result.price).toBeCloseTo(2.59, 2);
    expect(result.perUnit).toBe('pack');
  });

  it('includes VAT in per-pack price', () => {
    // 5×1kg, casePrice=5.55, vat=1.11 → gross=(5.55+1.11)/5 = 1.332
    const result = calculateUnitPriceGross(5.55, 1.11, 5, 1, 'kg');
    expect(result.price).toBeCloseTo(1.33, 2);
    expect(result.perUnit).toBe('pack');
  });

  it('includes per-kg secondary price for packaged g items', () => {
    // 6×500g = 3000g total, gross=15.55 → per-kg = 15.55/3 = 5.1833
    const result = calculateUnitPriceGross(15.55, 0, 6, 500, 'g');
    expect(result.secondary?.price).toBeCloseTo(5.18, 2);
    expect(result.secondary?.perUnit).toBe('kg');
  });

  it('includes per-kg secondary price for packaged kg items', () => {
    // 5×1kg = 5kg total, gross=5.55+1.11=6.66 → per-kg = 6.66/5 = 1.332
    const result = calculateUnitPriceGross(5.55, 1.11, 5, 1, 'kg');
    expect(result.secondary?.price).toBeCloseTo(1.33, 2);
    expect(result.secondary?.perUnit).toBe('kg');
  });

  it('includes per-l secondary price for packaged ml items', () => {
    // 12×250ml = 3000ml total, gross=9 → per-l = 9/3 = 3
    const result = calculateUnitPriceGross(9, 0, 12, 250, 'ml');
    expect(result.secondary?.price).toBeCloseTo(3, 2);
    expect(result.secondary?.perUnit).toBe('l');
  });

  it('omits secondary price for packaged items with non-weight unit', () => {
    const result = calculateUnitPriceGross(10, 0, 6, 1, 'each');
    expect(result.secondary).toBeUndefined();
  });

  it('returns per-kg price for loose g items (no unitsPerCase)', () => {
    // loose 500g, casePrice=11.65, vat=2.33 → gross=13.98, per-kg=(13.98/500)*1000=27.96
    const result = calculateUnitPriceGross(11.65, 2.33, null, 500, 'g');
    expect(result.price).toBeCloseTo(27.96, 2);
    expect(result.perUnit).toBe('kg');
  });

  it('returns per-kg price for loose kg items', () => {
    // loose 1kg, casePrice=10, vat=0 → gross=10, per-kg=10/1=10
    const result = calculateUnitPriceGross(10, 0, null, 1, 'kg');
    expect(result.price).toBeCloseTo(10, 2);
    expect(result.perUnit).toBe('kg');
  });

  it('returns per-l price for loose ml items', () => {
    // loose 500ml, casePrice=8, vat=1.6 → gross=9.6, per-l=(9.6/500)*1000=19.2
    const result = calculateUnitPriceGross(8, 1.6, null, 500, 'ml');
    expect(result.price).toBeCloseTo(19.2, 2);
    expect(result.perUnit).toBe('l');
  });

  it('returns per-l price for loose l items', () => {
    // loose 2l, casePrice=6, vat=0 → gross=6, per-l=6/2=3
    const result = calculateUnitPriceGross(6, 0, null, 2, 'l');
    expect(result.price).toBeCloseTo(3, 2);
    expect(result.perUnit).toBe('l');
  });

  it('handles zero packSize gracefully', () => {
    const result = calculateUnitPriceGross(10, 0, null, 0, 'g');
    expect(result.price).toBe(0);
    expect(result.perUnit).toBe('kg');
  });
});

describe('getCaseIncrement', () => {
  it('returns unitsPerCase for packaged items (6×500g → 6 packs)', () => {
    // Input is in packs, one case = 6 packs
    expect(getCaseIncrement(6, 500)).toBe(6);
  });

  it('returns unitsPerCase for packaged items (12×1kg → 12 packs)', () => {
    expect(getCaseIncrement(12, 1)).toBe(12);
  });

  it('returns packSize for bulk kg items (25kg rice → 25)', () => {
    // Input is in kg, one case = 25kg
    expect(getCaseIncrement(null, 25)).toBe(25);
  });

  it('returns packSize for bulk g items (500g loose → 500)', () => {
    // Input is in g, one case = 500g
    expect(getCaseIncrement(null, 500)).toBe(500);
  });

  it('returns packSize for bulk l items (5l oil → 5)', () => {
    expect(getCaseIncrement(null, 5)).toBe(5);
  });

  it('returns undefined when both unitsPerCase and packSize are zero/null', () => {
    expect(getCaseIncrement(null, 0)).toBeUndefined();
  });

  it('returns unitsPerCase when unitsPerCase is set, regardless of packSize', () => {
    // 6×500g: should return 6, not 500
    expect(getCaseIncrement(6, 500)).toBe(6);
    // 4×250ml: should return 4, not 250
    expect(getCaseIncrement(4, 250)).toBe(4);
  });
});

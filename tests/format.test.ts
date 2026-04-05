import { describe, it, expect } from 'vitest';
import { calculateUnitPriceGross } from '../src/lib/format';

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

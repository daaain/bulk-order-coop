import { describe, it, expect } from 'vitest';
import { validateDeliveryUpdate, computeAllocations } from '../server/services/reconciliation';

describe('validateDeliveryUpdate', () => {
  it('accepts valid arrived status', () => {
    const result = validateDeliveryUpdate({ status: 'arrived' });
    expect(result).toEqual({ status: 'arrived' });
  });

  it('accepts valid missing status', () => {
    const result = validateDeliveryUpdate({ status: 'missing' });
    expect(result).toEqual({ status: 'missing' });
  });

  it('accepts partial with actualQuantity', () => {
    const result = validateDeliveryUpdate({ status: 'partial', actualQuantity: 500 });
    expect(result).toEqual({ status: 'partial', actualQuantity: 500 });
  });

  it('accepts different_price with actualPrice', () => {
    const result = validateDeliveryUpdate({ status: 'different_price', actualPrice: 16.5 });
    expect(result).toEqual({ status: 'different_price', actualPrice: 16.5 });
  });

  it('accepts optional notes', () => {
    const result = validateDeliveryUpdate({ status: 'arrived', notes: 'Slightly dented' });
    expect(result).toEqual({ status: 'arrived', notes: 'Slightly dented' });
  });

  it('rejects invalid status', () => {
    const result = validateDeliveryUpdate({ status: 'unknown' });
    expect(result).toEqual({ error: expect.stringContaining('status must be one of') });
  });

  it('rejects non-object body', () => {
    expect(validateDeliveryUpdate(null)).toEqual({ error: 'Request body must be an object' });
    expect(validateDeliveryUpdate('string')).toEqual({ error: 'Request body must be an object' });
  });

  it('rejects partial without actualQuantity', () => {
    const result = validateDeliveryUpdate({ status: 'partial' });
    expect(result).toEqual({ error: expect.stringContaining('actualQuantity is required') });
  });

  it('rejects partial with non-positive actualQuantity', () => {
    const result = validateDeliveryUpdate({ status: 'partial', actualQuantity: 0 });
    expect(result).toEqual({ error: expect.stringContaining('actualQuantity is required') });
  });

  it('rejects different_price without actualPrice', () => {
    const result = validateDeliveryUpdate({ status: 'different_price' });
    expect(result).toEqual({ error: expect.stringContaining('actualPrice is required') });
  });

  it('rejects different_price with non-positive actualPrice', () => {
    const result = validateDeliveryUpdate({ status: 'different_price', actualPrice: -5 });
    expect(result).toEqual({ error: expect.stringContaining('actualPrice is required') });
  });
});

describe('computeAllocations', () => {
  const singleClaim = [{ memberId: 'alice', amount: 500 }];
  const twoClaims = [
    { memberId: 'alice', amount: 500 },
    { memberId: 'bob', amount: 1000 },
  ];

  it('returns empty for missing delivery', () => {
    const result = computeAllocations(singleClaim, 'missing', 3000, 1, 15.0, 0);
    expect(result).toEqual([]);
  });

  it('returns empty for no claims', () => {
    const result = computeAllocations([], 'arrived', 3000, 1, 15.0, 0);
    expect(result).toEqual([]);
  });

  it('allocates full claimed amounts when arrived', () => {
    const result = computeAllocations(singleClaim, 'arrived', 3000, 1, 15.0, 0);
    expect(result).toHaveLength(1);
    expect(result[0].memberId).toBe('alice');
    expect(result[0].amount).toBe(500);
    // 500/3000 * 15.00 = 2.50
    expect(result[0].price).toBeCloseTo(2.5);
  });

  it('allocates proportionally for multiple members', () => {
    const result = computeAllocations(twoClaims, 'arrived', 3000, 1, 15.0, 0);
    expect(result).toHaveLength(2);
    // alice: 500/3000 * 15 = 2.50
    expect(result[0].amount).toBe(500);
    expect(result[0].price).toBeCloseTo(2.5);
    // bob: 1000/3000 * 15 = 5.00
    expect(result[1].amount).toBe(1000);
    expect(result[1].price).toBeCloseTo(5.0);
  });

  it('scales claims proportionally for partial delivery', () => {
    // Two claims totalling 1500, but only 750 actually delivered
    const result = computeAllocations(twoClaims, 'partial', 3000, 1, 15.0, 0, null, 750);
    expect(result).toHaveLength(2);
    // scaleFactor = 750/1500 = 0.5
    // alice: 500 * 0.5 = 250, price = 250/3000 * 15 = 1.25
    expect(result[0].amount).toBeCloseTo(250);
    expect(result[0].price).toBeCloseTo(1.25);
    // bob: 1000 * 0.5 = 500, price = 500/3000 * 15 = 2.50
    expect(result[1].amount).toBeCloseTo(500);
    expect(result[1].price).toBeCloseTo(2.5);
  });

  it('caps scale factor at 1.0 for partial with excess delivery', () => {
    // Claims total 1500 but 2000 delivered — don't over-allocate
    const result = computeAllocations(twoClaims, 'partial', 3000, 1, 15.0, 0, null, 2000);
    expect(result[0].amount).toBe(500);
    expect(result[1].amount).toBe(1000);
  });

  it('uses actual price for different_price status', () => {
    // Case price was 15.00 but actual is 18.00
    const result = computeAllocations(singleClaim, 'different_price', 3000, 1, 15.0, 0, 18.0);
    // 500/3000 * 18 = 3.00
    expect(result[0].price).toBeCloseTo(3.0);
  });

  it('handles VAT correctly in allocations (code 2 = 20%)', () => {
    // The price field is NET (pre-VAT), so VAT doesn't affect it
    // but the cost computation uses vatCode internally
    const result = computeAllocations(singleClaim, 'arrived', 3000, 1, 15.0, 2);
    // 500/3000 * 15 = 2.50 (net price, VAT is computed separately)
    expect(result[0].price).toBeCloseTo(2.5);
  });

  it('applies memberDiscountPct to the allocated price', () => {
    // 500/3000 * 15 = 2.50 net → with 4% member discount → 2.40
    const result = computeAllocations(
      singleClaim,
      'arrived',
      3000,
      1,
      15.0,
      0,
      null,
      null,
      4,
    );
    expect(result[0].amount).toBe(500);
    expect(result[0].price).toBeCloseTo(2.4);
  });

  it('applies memberDiscountPct combined with different_price', () => {
    // actual price 18.00 → 500/3000 * 18 = 3.00 → 4% off = 2.88
    const result = computeAllocations(
      singleClaim,
      'different_price',
      3000,
      1,
      15.0,
      0,
      18.0,
      null,
      4,
    );
    expect(result[0].price).toBeCloseTo(2.88);
  });

  it('applies memberDiscountPct combined with partial delivery', () => {
    // total claimed 1500, delivered 750 → scaleFactor 0.5
    // alice: 250 units, 250/3000 * 15 = 1.25 net → 4% off = 1.20
    const result = computeAllocations(
      twoClaims,
      'partial',
      3000,
      1,
      15.0,
      0,
      null,
      750,
      4,
    );
    expect(result[0].amount).toBeCloseTo(250);
    expect(result[0].price).toBeCloseTo(1.2);
    expect(result[1].amount).toBeCloseTo(500);
    expect(result[1].price).toBeCloseTo(2.4);
  });
});

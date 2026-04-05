import { describe, it, expect } from 'vitest';
import { calculateRounding } from '$shared/rounding';

describe('calculateRounding', () => {
  it('returns needs_more for zero claims', () => {
    const result = calculateRounding([], 6, 500);
    expect(result.status).toBe('needs_more');
    expect(result.totalClaimed).toBe(0);
    expect(result.casesNeeded).toBe(0);
  });

  it('returns ready when claims exactly fill cases', () => {
    // 6×500g = 3000g per case; 3000g claimed = exactly 1 case
    const claims = [
      { amount: 2000, flexibility: '+' as const },
      { amount: 1000, flexibility: '*' as const },
    ];
    const result = calculateRounding(claims, 6, 500);
    expect(result.status).toBe('ready');
    expect(result.casesNeeded).toBe(1);
    expect(result.gap).toBe(0);
  });

  it('returns nearly when gap is small and someone is flexible up', () => {
    // 6×500g = 3000g per case; 2800g claimed → gap = 200g (6.7% of 3000)
    const claims = [
      { amount: 1800, flexibility: '+' as const },
      { amount: 1000, flexibility: '*' as const },
    ];
    const result = calculateRounding(claims, 6, 500);
    expect(result.status).toBe('nearly');
    expect(result.casesNeeded).toBe(1);
    expect(result.gap).toBe(200);
  });

  it('returns needs_more when gap is large', () => {
    // 6×500g = 3000g per case; 1000g claimed → gap = 2000g (67%)
    const claims = [{ amount: 1000, flexibility: '*' as const }];
    const result = calculateRounding(claims, 6, 500);
    expect(result.status).toBe('needs_more');
    expect(result.casesNeeded).toBe(1);
    expect(result.gap).toBe(2000);
  });

  it('handles loose/bulk items (no units_per_case)', () => {
    // 5kg bag; 3kg claimed → 1 case needed, gap = 2kg
    const claims = [{ amount: 3, flexibility: '+-' as const }];
    const result = calculateRounding(claims, null, 5);
    expect(result.caseSize).toBe(5);
    expect(result.casesNeeded).toBe(1);
    expect(result.gap).toBe(2);
    expect(result.status).toBe('needs_more');
  });

  it('handles loose/bulk nearly status', () => {
    // 5kg bag; 4.5kg claimed → gap = 0.5kg (10% of 5kg)
    const claims = [
      { amount: 3, flexibility: '+' as const },
      { amount: 1.5, flexibility: '*' as const },
    ];
    const result = calculateRounding(claims, null, 5);
    expect(result.status).toBe('nearly');
    expect(result.gap).toBeCloseTo(0.5);
  });
});

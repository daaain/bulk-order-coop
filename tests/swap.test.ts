import { describe, it, expect } from 'vitest';
import { mergeClaimPair } from '$shared/swap';

describe('mergeClaimPair', () => {
  it('sums amounts when flexibilities agree', () => {
    const result = mergeClaimPair(
      { amount: 500, flexibility: '+' },
      { amount: 1000, flexibility: '+' },
    );
    expect(result).toEqual({ amount: 1500, flexibility: '+' });
  });

  it('collapses to * when flexibilities disagree', () => {
    const result = mergeClaimPair(
      { amount: 500, flexibility: '+' },
      { amount: 1000, flexibility: '-' },
    );
    expect(result).toEqual({ amount: 1500, flexibility: '*' });
  });

  it('treats null as * for comparison', () => {
    const result = mergeClaimPair(
      { amount: 500, flexibility: null },
      { amount: 1000, flexibility: '*' },
    );
    expect(result).toEqual({ amount: 1500, flexibility: '*' });
  });

  it('collapses to * when only one side is non-* flexible', () => {
    const result = mergeClaimPair(
      { amount: 500, flexibility: null },
      { amount: 1000, flexibility: '+-' },
    );
    expect(result).toEqual({ amount: 1500, flexibility: '*' });
  });

  it('preserves +- when both sides are +-', () => {
    const result = mergeClaimPair(
      { amount: 2, flexibility: '+-' },
      { amount: 3, flexibility: '+-' },
    );
    expect(result).toEqual({ amount: 5, flexibility: '+-' });
  });

  it('sums zero correctly', () => {
    const result = mergeClaimPair(
      { amount: 0, flexibility: '*' },
      { amount: 0, flexibility: '*' },
    );
    expect(result).toEqual({ amount: 0, flexibility: '*' });
  });
});

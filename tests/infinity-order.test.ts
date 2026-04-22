import { describe, expect, test } from 'vitest';
import { formatInfinityOrderCsv } from '../shared/infinity-order';

describe('formatInfinityOrderCsv', () => {
  test('formats header and rows', () => {
    const csv = formatInfinityOrderCsv([
      { productCode: '1005', cases: 1 },
      { productCode: '100510', cases: 2 },
    ]);
    expect(csv).toBe(['Item number, Quantity', '1005,1', '100510,2'].join('\n'));
  });

  test('returns just the header when there are no lines', () => {
    expect(formatInfinityOrderCsv([])).toBe('Item number, Quantity');
  });
});

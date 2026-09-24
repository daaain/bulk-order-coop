import { describe, expect, test } from 'vitest';
import {
  formatInfinityOrderCsv,
  parseInfinityOrderCsv,
  selectInfinityOrderLines,
  splitAmountRandomly,
} from '../shared/infinity-order';

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

describe('parseInfinityOrderCsv', () => {
  test('round-trips the output of formatInfinityOrderCsv', () => {
    const lines = [
      { productCode: '1005', cases: 1 },
      { productCode: '100510', cases: 2 },
    ];
    expect(parseInfinityOrderCsv(formatInfinityOrderCsv(lines))).toEqual(lines);
  });

  test('ignores the header row (case-insensitive, tolerant of spacing)', () => {
    const csv = ['Item number, Quantity', '1005,1'].join('\n');
    expect(parseInfinityOrderCsv(csv)).toEqual([{ productCode: '1005', cases: 1 }]);

    const csvNoHeader = '1005,1';
    expect(parseInfinityOrderCsv(csvNoHeader)).toEqual([{ productCode: '1005', cases: 1 }]);
  });

  test('skips blank lines and malformed rows', () => {
    const csv = [
      'Item number, Quantity',
      '',
      '1005,1',
      '   ',
      'not-a-row',
      '2001,not-a-number',
      '3001,0',
      '3002,-2',
      '4001,2',
    ].join('\n');
    expect(parseInfinityOrderCsv(csv)).toEqual([
      { productCode: '1005', cases: 1 },
      { productCode: '4001', cases: 2 },
    ]);
  });

  test('handles CRLF line endings and surrounding whitespace', () => {
    const csv = 'Item number, Quantity\r\n  1005 , 1 \r\n 4001 , 3 \r\n';
    expect(parseInfinityOrderCsv(csv)).toEqual([
      { productCode: '1005', cases: 1 },
      { productCode: '4001', cases: 3 },
    ]);
  });
});

describe('splitAmountRandomly', () => {
  // Deterministic RNG for reproducibility.
  function seededRng(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  test('returns a single entry when parts=1', () => {
    expect(splitAmountRandomly(12, 1)).toEqual([12]);
  });

  test('returns an empty array when parts=0', () => {
    expect(splitAmountRandomly(12, 0)).toEqual([]);
  });

  test('splits into the requested number of parts', () => {
    const rng = seededRng(42);
    expect(splitAmountRandomly(12, 3, rng)).toHaveLength(3);
  });

  test('produces positive amounts that sum exactly to the target', () => {
    const rng = seededRng(42);
    const total = 24;
    const parts = splitAmountRandomly(total, 4, rng);
    for (const p of parts) expect(p).toBeGreaterThan(0);
    const sum = parts.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(total, 6);
  });

  test('produces an exact sum across many random seeds (no drift)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seededRng(seed);
      const total = 15.5;
      const parts = splitAmountRandomly(total, 5, rng);
      const sum = parts.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(total, 6);
    }
  });
});

describe('selectInfinityOrderLines', () => {
  const item = (
    id: string,
    status: 'ready' | 'nearly' | 'needs_more' | 'over',
    casesNeeded = 1,
  ) => ({ orderItem: { id, productCode: `P${id}` }, rounding: { status, casesNeeded } });

  test('includes only ready items by default', () => {
    const items = [item('1', 'ready', 2), item('2', 'needs_more'), item('3', 'nearly')];
    expect(selectInfinityOrderLines(items)).toEqual([{ productCode: 'P1', cases: 2 }]);
  });

  test('includes ticked needs-more-takers items, rounded up to whole cases', () => {
    const items = [item('1', 'ready'), item('2', 'needs_more', 3), item('3', 'needs_more')];
    expect(selectInfinityOrderLines(items, new Set(['2']))).toEqual([
      { productCode: 'P1', cases: 1 },
      { productCode: 'P2', cases: 3 },
    ]);
  });

  test('ignores ticks on items with nothing claimed or in other statuses', () => {
    const items = [item('1', 'needs_more', 0), item('2', 'nearly')];
    expect(selectInfinityOrderLines(items, new Set(['1', '2']))).toEqual([]);
  });
});

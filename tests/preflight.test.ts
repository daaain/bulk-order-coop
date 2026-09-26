import { describe, it, expect } from 'vitest';
import * as schema from '../db/schema';
import {
  allowedLosses,
  compareData,
  fingerprintColumns,
  missingForCode,
  schemaColumns,
  type Fingerprint,
} from '../scripts/preflight';

const orders = (rows: Record<string, unknown>[]): Fingerprint => {
  const columns = Object.keys(rows[0] ?? { id: null });
  return {
    orders: {
      rows: rows.length,
      columns: Object.fromEntries(
        columns.map((c) => [c, rows.map((r) => JSON.stringify(r[c] ?? null)).sort()]),
      ),
    },
  };
};

const none = new Set<string>();

describe('compareData', () => {
  const before = orders([
    { id: 'a', status: 'open', total: 10 },
    { id: 'b', status: 'open', total: null },
  ]);

  it('passes an additive change and notes it', () => {
    const after = orders([
      { id: 'a', status: 'open', total: 10, note: null },
      { id: 'b', status: 'open', total: null, note: null },
    ]);
    expect(compareData(before, after, none)).toEqual({
      problems: [],
      notes: ['Column orders.note added'],
    });
  });

  it('flags lost rows', () => {
    const after = orders([{ id: 'a', status: 'open', total: 10 }]);
    expect(compareData(before, after, none).problems).toContain(
      'Table orders lost 1 of its 2 row(s)',
    );
  });

  it('flags a dropped column that held data, but not an empty one', () => {
    const withoutTotal = orders([
      { id: 'a', status: 'open' },
      { id: 'b', status: 'open' },
    ]);
    expect(compareData(before, withoutTotal, none).problems).toEqual([
      'Column orders.total is gone, with 1 value(s) in it',
    ]);

    const emptyTotal = orders([
      { id: 'a', status: 'open', total: null },
      { id: 'b', status: 'open', total: null },
    ]);
    const withoutEmpty = orders([
      { id: 'a', status: 'open' },
      { id: 'b', status: 'open' },
    ]);
    expect(compareData(emptyTotal, withoutEmpty, none)).toEqual({
      problems: [],
      notes: ['Column orders.total removed (it was empty)'],
    });
  });

  it('flags values set to NULL', () => {
    const after = orders([
      { id: 'a', status: 'open', total: null },
      { id: 'b', status: 'open', total: null },
    ]);
    expect(compareData(before, after, none).problems).toEqual([
      'Column orders.total lost 1 value(s) (now empty)',
    ]);
  });

  it('notes changed values without blocking', () => {
    const after = orders([
      { id: 'a', status: 'closed', total: 10 },
      { id: 'b', status: 'open', total: null },
    ]);
    expect(compareData(before, after, none)).toEqual({
      problems: [],
      notes: ['Column orders.status: 1 value(s) changed'],
    });
  });

  it('flags a dropped table with rows', () => {
    expect(compareData(before, {}, none).problems).toEqual([
      'Table orders is gone, with its 2 row(s)',
    ]);
  });

  it('lets through only the losses a migration names', () => {
    const after = orders([{ id: 'a', status: 'open' }]);
    const result = compareData(before, after, new Set(['orders.total']));
    expect(result.problems).toEqual(['Table orders lost 1 of its 2 row(s)']);
    expect(result.notes).toContain(
      'Column orders.total is gone, with 1 value(s) in it (allowed by the migration)',
    );
  });
});

describe('allowedLosses', () => {
  it('reads allow-loss markers from migration files', () => {
    const sql = [
      '-- deploy: allow-loss orders.invoice_total, claims\nALTER TABLE ...',
      'CREATE TABLE x (id text);',
    ];
    expect([...allowedLosses(sql)]).toEqual(['orders.invoice_total', 'claims']);
  });
});

describe('missingForCode', () => {
  const after = orders([{ id: 'a', status: 'open' }]);

  it('passes when the database has everything the code uses', () => {
    expect(missingForCode({ orders: ['id', 'status'] }, after, 'The new code')).toEqual([]);
  });

  it('names missing columns and tables', () => {
    expect(
      missingForCode({ orders: ['id', 'invoice_total'], claims: ['id'] }, after, 'The live code'),
    ).toEqual([
      "The live code uses orders.invoice_total, which the migrated database doesn't have",
      "The live code uses table claims, which the migrated database doesn't have",
    ]);
  });

  it('treats every existing column as used when the live code is unknown', () => {
    const before = orders([{ id: 'a', status: 'open', total: 1 }]);
    expect(missingForCode(fingerprintColumns(before), after, 'The live code (assumed)')).toEqual([
      "The live code (assumed) uses orders.total, which the migrated database doesn't have",
    ]);
  });
});

describe('schemaColumns', () => {
  it('reads the tables and columns from the Drizzle schema', () => {
    const columns = schemaColumns(schema);
    expect(columns.orders).toContain('invoice_total');
    expect(columns.allocations).toContain('split_confirmed');
  });
});

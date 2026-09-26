/**
 * Checks for a migration rehearsal: compare a copy of production before and
 * after the pending migrations, and check the result against the code.
 *
 * Kept free of I/O so it can be tested with plain objects; scripts/migrate.ts
 * does the exporting, rehearsing and reading.
 */
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

/** Every value in every column, as sortable strings, so changes can be counted. */
export interface TablePrint {
  rows: number;
  columns: Record<string, string[]>;
}
export type Fingerprint = Record<string, TablePrint>;

/** Table name → column names that a version of the code reads and writes. */
export type SchemaColumns = Record<string, string[]>;

export interface Diagnosis {
  /** Anything here stops the deploy. */
  problems: string[];
  /** Worth knowing, but expected: shown in the log. */
  notes: string[];
}

const ALLOW_LOSS = /^\s*--\s*deploy:\s*allow-loss\s+(.+)$/gim;

/**
 * `-- deploy: allow-loss orders.invoice_total` (or a bare table name) in a
 * migration says losing that data is intended.
 */
export function allowedLosses(migrationSql: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const sql of migrationSql) {
    for (const [, list] of sql.matchAll(ALLOW_LOSS)) {
      for (const name of list.split(/[\s,]+/)) if (name) allowed.add(name);
    }
  }
  return allowed;
}

/** Values in `before` that are no longer in `after`, treating both as multisets. */
function removedValues(before: string[], after: string[]): number {
  const remaining = new Map<string, number>();
  for (const v of after) remaining.set(v, (remaining.get(v) ?? 0) + 1);
  let removed = 0;
  for (const v of before) {
    const left = remaining.get(v) ?? 0;
    if (left > 0) remaining.set(v, left - 1);
    else removed++;
  }
  return removed;
}

const nonNull = (values: string[]) => values.filter((v) => v !== 'null').length;

export function compareData(
  before: Fingerprint,
  after: Fingerprint,
  allowed: Set<string>,
): Diagnosis {
  const problems: string[] = [];
  const notes: string[] = [];
  const isAllowed = (table: string, column?: string) =>
    allowed.has(table) || (column !== undefined && allowed.has(`${table}.${column}`));
  const lose = (message: string, table: string, column?: string) =>
    (isAllowed(table, column) ? notes : problems).push(
      isAllowed(table, column) ? `${message} (allowed by the migration)` : message,
    );

  for (const [table, was] of Object.entries(before)) {
    const now = after[table];
    if (!now) {
      if (was.rows > 0) lose(`Table ${table} is gone, with its ${was.rows} row(s)`, table);
      else notes.push(`Table ${table} removed (it was empty)`);
      continue;
    }
    // Values that went with deleted rows are reported once, as lost rows.
    const rowsLost = Math.max(0, was.rows - now.rows);
    if (rowsLost > 0) {
      lose(`Table ${table} lost ${rowsLost} of its ${was.rows} row(s)`, table);
    }
    for (const [column, values] of Object.entries(was.columns)) {
      const current = now.columns[column];
      const filled = nonNull(values);
      if (!current) {
        if (filled > 0)
          lose(`Column ${table}.${column} is gone, with ${filled} value(s) in it`, table, column);
        else notes.push(`Column ${table}.${column} removed (it was empty)`);
        continue;
      }
      const emptied = filled - nonNull(current) - rowsLost;
      if (emptied > 0) {
        lose(`Column ${table}.${column} lost ${emptied} value(s) (now empty)`, table, column);
      }
      const changed = removedValues(values, current) - rowsLost - Math.max(0, emptied);
      if (changed > 0) notes.push(`Column ${table}.${column}: ${changed} value(s) changed`);
    }
  }
  for (const [table, now] of Object.entries(after)) {
    const was = before[table];
    if (!was) {
      notes.push(`Table ${table} added`);
      continue;
    }
    for (const column of Object.keys(now.columns)) {
      if (!(column in was.columns)) notes.push(`Column ${table}.${column} added`);
    }
    if (now.rows > was.rows) notes.push(`Table ${table} gained ${now.rows - was.rows} row(s)`);
  }
  return { problems, notes };
}

/** Tables and columns the code expects that the migrated database lacks. */
export function missingForCode(
  expected: SchemaColumns,
  after: Fingerprint,
  whose: string,
): string[] {
  const problems: string[] = [];
  for (const [table, columns] of Object.entries(expected)) {
    const now = after[table];
    if (!now) {
      problems.push(`${whose} uses table ${table}, which the migrated database doesn't have`);
      continue;
    }
    const missing = columns.filter((c) => !(c in now.columns));
    if (missing.length) {
      problems.push(
        `${whose} uses ${missing.map((c) => `${table}.${c}`).join(', ')}, which the migrated database doesn't have`,
      );
    }
  }
  return problems;
}

/** What a Drizzle schema module expects the database to contain. */
export function schemaColumns(schemaModule: Record<string, unknown>): SchemaColumns {
  const out: SchemaColumns = {};
  for (const value of Object.values(schemaModule)) {
    if (is(value, SQLiteTable)) {
      const config = getTableConfig(value);
      out[config.name] = config.columns.map((c) => c.name);
    }
  }
  return out;
}

/** The columns of a database, as though some code used all of them. */
export function fingerprintColumns(print: Fingerprint): SchemaColumns {
  return Object.fromEntries(Object.entries(print).map(([t, p]) => [t, Object.keys(p.columns)]));
}

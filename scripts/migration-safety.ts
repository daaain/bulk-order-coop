/**
 * Decides whether pending D1 migrations are safe to apply automatically
 * during a deploy.
 *
 * Additive changes (new tables, indexes and columns) can't lose data and
 * don't break the code that's already running, so they're applied. Dropping
 * a table or column is allowed only when production holds no data in it.
 * Anything else — UPDATE, DELETE, renames, Drizzle's table rebuilds — needs a
 * person to read it first, and passes once the file carries a
 * `-- deploy: reviewed` line.
 */

export const REVIEWED_MARKER = /^\s*--\s*deploy:\s*reviewed\b/im;

export type Check =
  | { kind: 'safe' }
  | { kind: 'needs-review'; reason: string }
  // Safe only if the query returns 0 — it counts the data a drop would lose.
  | { kind: 'must-be-empty'; reason: string; countSql: string };

export interface StatementVerdict {
  sql: string;
  check: Check;
}

const IDENT = '[`"\\[]?(\\w+)[`"\\]]?';

/** Split a Drizzle migration into statements, dropping comments. */
export function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .flatMap((chunk) => chunk.split(/;\s*(?:\n|$)/))
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

export function classifyStatement(sql: string): Check {
  const s = sql.replace(/\s+/g, ' ').trim();

  // Drizzle rebuilds a table (to change a column) through a `__new_` copy.
  if (/__new_/i.test(s)) {
    return { kind: 'needs-review', reason: 'rebuilds a table, copying its rows across' };
  }
  if (/^CREATE TABLE /i.test(s) || /^CREATE (UNIQUE )?INDEX /i.test(s)) {
    return { kind: 'safe' };
  }
  // SQLite refuses ADD COLUMN ... NOT NULL without a default, so this can
  // only add a column; it never rewrites existing rows.
  if (/^ALTER TABLE \S+ ADD (COLUMN )?/i.test(s)) {
    return { kind: 'safe' };
  }

  const dropColumn = s.match(new RegExp(`^ALTER TABLE ${IDENT} DROP (?:COLUMN )?${IDENT}$`, 'i'));
  if (dropColumn) {
    const [, table, column] = dropColumn;
    return {
      kind: 'must-be-empty',
      reason: `drops column ${table}.${column}`,
      countSql: `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NOT NULL`,
    };
  }
  const dropTable = s.match(new RegExp(`^DROP TABLE (?:IF EXISTS )?${IDENT}$`, 'i'));
  if (dropTable) {
    const [, table] = dropTable;
    return {
      kind: 'must-be-empty',
      reason: `drops table ${table}`,
      countSql: `SELECT COUNT(*) AS n FROM "${table}"`,
    };
  }
  if (/^DROP INDEX /i.test(s)) {
    return { kind: 'safe' };
  }

  const verb = s.split(' ').slice(0, 3).join(' ');
  return { kind: 'needs-review', reason: `runs "${verb} …", which can change existing data` };
}

export function classifyMigration(sql: string): StatementVerdict[] {
  return splitStatements(sql).map((statement) => ({
    sql: statement,
    check: classifyStatement(statement),
  }));
}

export interface MigrationReport {
  name: string;
  reviewed: boolean;
  blockers: string[];
}

/**
 * Work out which pending migrations would block the deploy. `count` runs a
 * counting query against the target database; a missing table counts as
 * empty, since a drop of it can't lose anything.
 */
export async function assessMigrations(
  pending: { name: string; sql: string }[],
  count: (sql: string) => Promise<number>,
): Promise<MigrationReport[]> {
  const reports: MigrationReport[] = [];
  for (const { name, sql } of pending) {
    const reviewed = REVIEWED_MARKER.test(sql);
    const blockers: string[] = [];
    if (!reviewed) {
      for (const { check } of classifyMigration(sql)) {
        if (check.kind === 'needs-review') blockers.push(check.reason);
        if (check.kind === 'must-be-empty') {
          const n = await count(check.countSql);
          if (n > 0) blockers.push(`${check.reason}, which holds data in ${n} row(s)`);
        }
      }
    }
    reports.push({ name, reviewed, blockers });
  }
  return reports;
}

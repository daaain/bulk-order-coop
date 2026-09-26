/**
 * Deploy step: rehearse pending D1 migrations on a copy of production, and
 * apply them to production only if the rehearsal passes every check.
 *
 *   bun scripts/migrate.ts            # rehearse, then apply to production
 *   bun scripts/migrate.ts --check    # rehearse only
 *   bun scripts/migrate.ts --local    # use the local dev database instead
 *   bun scripts/migrate.ts --live <sha>  # the commit serving traffic, if known
 *
 * The copy holds members' data, so it lives in a temporary directory that is
 * deleted on exit and is never uploaded anywhere.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import {
  allowedLosses,
  compareData,
  fingerprintColumns,
  missingForCode,
  schemaColumns,
  type Fingerprint,
  type SchemaColumns,
} from './preflight';

const MIGRATIONS_DIR = 'db/migrations';
const DB = 'DB';
const PAGES_PROJECT = 'bulk-order-coop';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const source = args.includes('--local') ? ['--local'] : ['--remote'];
const isRemote = source[0] === '--remote';
const liveArg = args.includes('--live') ? args[args.indexOf('--live') + 1] : undefined;

const env = { ...process.env, CI: 'true' };

function run(cmd: string[], opts: { quiet?: boolean } = {}) {
  const res = spawnSync('bunx', ['wrangler', ...cmd], {
    encoding: 'utf8',
    env,
    stdio: opts.quiet ? 'pipe' : 'inherit',
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/** Run quietly, showing wrangler's output only if it fails. */
function mustRun(cmd: string[]) {
  const res = run(cmd, { quiet: true });
  if (!res.ok) {
    console.error(res.output);
    throw new Error(`wrangler ${cmd.slice(0, 3).join(' ')} failed`);
  }
}

/** Wrangler can print notices before its JSON, so parse from the first bracket. */
function parseJson<T>(output: string): T {
  const start = output.search(/^[[{]/m);
  if (start === -1) throw new Error(`No JSON in wrangler output:\n${output}`);
  return JSON.parse(output.slice(start)) as T;
}

function pendingMigrations(): { name: string; sql: string }[] {
  const res = run(
    ['d1', 'execute', DB, ...source, '--json', '--command', 'SELECT name FROM d1_migrations'],
    { quiet: true },
  );
  const parsed = parseJson<{ results: { name: string }[] }[] | { error?: { text?: string } }>(
    res.output,
  );
  let applied = new Set<string>();
  if (Array.isArray(parsed)) {
    applied = new Set(parsed.flatMap((r) => r.results).map((r) => r.name));
  } else if (!/no such table/i.test(parsed.error?.text ?? '')) {
    throw new Error(`Could not read applied migrations: ${parsed.error?.text ?? res.output}`);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !applied.has(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

function sqliteFile(persistDir: string): string {
  const walk = (dir: string): string | undefined => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') {
        return path;
      }
    }
  };
  const found = walk(persistDir);
  if (!found) throw new Error(`No SQLite database under ${persistDir}`);
  return found;
}

const INTERNAL = /^(sqlite_|_cf_|d1_migrations$)/;

/**
 * Read every table. `keyColumns` fixes which columns identify a row (the
 * key from before the migration), so a changed key is still checked against
 * the old one; without it, each table's own primary key is used.
 */
function fingerprint(file: string, keyColumns?: Record<string, string[] | null>): Fingerprint {
  const db = new Database(file);
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    const print: Fingerprint = {};
    for (const { name } of tables) {
      if (INTERNAL.test(name)) continue;
      const rows = db.query(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
      const info = db.query(`PRAGMA table_info("${name}")`).all() as { name: string; pk: number }[];
      const columns = info.map((c) => c.name);
      // `pk` is the column's position in the primary key (0 if not part of it).
      const ownKey = info
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      const primaryKey =
        keyColumns && name in keyColumns ? keyColumns[name] : ownKey.length ? ownKey : null;
      const keyReadable = primaryKey !== null && primaryKey.every((c) => columns.includes(c));
      print[name] = {
        rows: rows.length,
        columns: Object.fromEntries(
          columns.map((c) => [c, rows.map((r) => JSON.stringify(r[c] ?? null)).sort()]),
        ),
        primaryKey,
        keys:
          keyReadable && primaryKey
            ? rows.map((r) => JSON.stringify(primaryKey.map((c) => r[c] ?? null)))
            : null,
      };
    }
    return print;
  } finally {
    db.close();
  }
}

function integrityProblems(file: string): string[] {
  const db = new Database(file);
  try {
    const problems: string[] = [];
    const integrity = db.query('PRAGMA integrity_check').all() as { integrity_check: string }[];
    if (integrity.some((r) => r.integrity_check !== 'ok')) {
      problems.push(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
    }
    const orphans = db.query('PRAGMA foreign_key_check').all() as {
      table: string;
      parent: string;
    }[];
    for (const o of orphans.slice(0, 10)) {
      problems.push(`Row in ${o.table} points at a missing row in ${o.parent}`);
    }
    if (orphans.length > 10) problems.push(`…and ${orphans.length - 10} more broken references`);
    return problems;
  } finally {
    db.close();
  }
}

async function loadSchema(path: string): Promise<SchemaColumns> {
  return schemaColumns(await import(resolve(path)));
}

/** The commit behind the production deployment serving traffic now. */
function liveCommit(): string | null {
  if (liveArg) return liveArg;
  if (!isRemote) return null;
  const res = run(
    [
      'pages',
      'deployment',
      'list',
      '--project-name',
      PAGES_PROJECT,
      '--environment',
      'production',
      '--json',
    ],
    { quiet: true },
  );
  if (!res.ok) return null;
  try {
    const deployments = parseJson<{ Source: string; Status: string }[]>(res.output);
    // Newest first; a successful deployment's status is its finish time.
    const live = deployments.find(
      (d) => d.Source && !/^(Failure|Canceled|Active|Idle|Skipped)$/i.test(d.Status),
    );
    return live?.Source ?? null;
  } catch {
    return null;
  }
}

async function liveSchema(): Promise<{ label: string; columns: SchemaColumns } | null> {
  const sha = liveCommit();
  if (!sha) return null;
  const show = spawnSync('git', ['show', `${sha}:db/schema.ts`], { encoding: 'utf8' });
  if (show.status !== 0) return null;
  // Inside the repo so its drizzle-orm import resolves; removed with the rest.
  const path = join('db', `.live-schema-${sha}.ts`);
  writeFileSync(path, show.stdout);
  try {
    return { label: `The live code (${sha})`, columns: await loadSchema(path) };
  } finally {
    rmSync(path, { force: true });
  }
}

async function main() {
  const pending = pendingMigrations();
  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }
  console.log(`Pending: ${pending.map((m) => m.name).join(', ')}`);

  const work = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'd1-rehearsal-'));
  const cleanup = () => rmSync(work, { recursive: true, force: true });
  process.on('exit', cleanup);

  try {
    // 1. Copy production into a throwaway local D1. A single export writes
    // each table's rows right after its CREATE TABLE, so rows can arrive
    // before the tables they reference exist; load the schema first.
    const rehearsal = ['--local', '--persist-to', join(work, 'state')];
    for (const part of ['--no-data', '--no-schema']) {
      const dump = join(work, `copy${part}.sql`);
      mustRun(['d1', 'export', DB, ...source, part, '--output', dump]);
      mustRun(['d1', 'execute', DB, ...rehearsal, '--file', dump]);
    }
    const file = sqliteFile(join(work, 'state'));
    const before = fingerprint(file);

    // 2. Rehearse the migrations on the copy.
    const problems: string[] = [];
    const notes: string[] = [];
    const applied = run(['d1', 'migrations', 'apply', DB, ...rehearsal], { quiet: true });
    if (!applied.ok) {
      problems.push(
        `The migrations failed on a copy of production:\n${applied.output
          .split('\n')
          .filter((l) => /error|fail|constraint/i.test(l))
          .join('\n')}`,
      );
    } else {
      // 3. Check the result.
      const after = fingerprint(
        file,
        Object.fromEntries(Object.entries(before).map(([t, p]) => [t, p.primaryKey])),
      );
      const data = compareData(before, after, allowedLosses(pending.map((m) => m.sql)));
      problems.push(...data.problems, ...integrityProblems(file));
      notes.push(...data.notes);

      problems.push(...missingForCode(await loadSchema('db/schema.ts'), after, 'The new code'));

      // Between migrating and the new code going live, the old code is still
      // serving. Without knowing its schema, assume it uses everything there.
      const live = await liveSchema();
      if (live) {
        problems.push(...missingForCode(live.columns, after, live.label));
      } else {
        if (isRemote)
          notes.push("Couldn't tell which commit is live; assuming it uses every column");
        problems.push(
          ...missingForCode(fingerprintColumns(before), after, 'The live code (assumed)').map(
            (p) => `${p} — ship the code change first, then the migration`,
          ),
        );
      }
    }

    for (const n of notes) console.log(`  · ${n}`);
    if (problems.length) {
      console.error('\nNot deploying. The rehearsal on a copy of production found:');
      for (const p of problems) console.error(`  ✗ ${p}`);
      console.error('\nNothing has been applied to production.');
      process.exit(1);
    }
    console.log('Rehearsal passed.');
    if (checkOnly) return;

    // 4. Apply for real, recording where to roll back to first.
    if (isRemote) {
      const info = run(['d1', 'time-travel', 'info', DB], { quiet: true });
      console.log(info.ok ? info.output.trim() : 'Could not read the Time Travel bookmark.');
    }
    const final = run(['d1', 'migrations', 'apply', DB, ...source]);
    if (!final.ok) throw new Error('Applying the migrations to production failed');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

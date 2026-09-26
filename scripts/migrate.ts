/**
 * Apply pending D1 migrations as part of a deploy, but only when they're safe
 * (see migration-safety.ts). Exits non-zero, having applied nothing, when a
 * migration needs a person to look at it.
 *
 *   bun scripts/migrate.ts                 # production (--remote)
 *   bun scripts/migrate.ts --check         # report only, apply nothing
 *   bun scripts/migrate.ts --local --persist-to .wrangler/state
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assessMigrations } from './migration-safety';

const MIGRATIONS_DIR = 'db/migrations';
const DB = 'DB';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const target = args.filter((a) => a !== '--check');
if (!target.includes('--local')) target.unshift('--remote');
const isRemote = target.includes('--remote');

function wrangler(cmd: string[]): void {
  const res = spawnSync('bunx', ['wrangler', ...cmd], {
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
  if (res.status !== 0) {
    throw new Error(`wrangler ${cmd.join(' ')} exited with ${res.status}`);
  }
}

// A table or column that doesn't exist yet: the only query failure that's
// safe to read as "nothing there".
const MISSING = /no such (table|column)/i;

function query<T>(sql: string): T[] {
  const res = spawnSync(
    'bunx',
    ['wrangler', 'd1', 'execute', DB, ...target, '--json', '--command', sql],
    { encoding: 'utf8', env: { ...process.env, CI: 'true' } },
  );
  // Wrangler can print notices before the JSON, and reports SQL errors as
  // JSON on stdout, so parse from the first bracket whatever the exit code.
  const out = res.stdout ?? '';
  const start = out.search(/^[[{]/m);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out.slice(start));
  } catch {
    throw new Error(`Could not read wrangler output for "${sql}":\n${out}${res.stderr ?? ''}`);
  }
  if (!Array.isArray(parsed)) {
    const message = (parsed as { error?: { text?: string } }).error?.text ?? JSON.stringify(parsed);
    throw new Error(message);
  }
  return (parsed as { results: T[] }[]).flatMap((r) => r.results);
}

function appliedMigrations(): Set<string> {
  try {
    return new Set(query<{ name: string }>('SELECT name FROM d1_migrations').map((r) => r.name));
  } catch (err) {
    // No migrations table yet: nothing has been applied.
    if (MISSING.test(String(err))) return new Set();
    throw err;
  }
}

async function main() {
  const applied = appliedMigrations();
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !applied.has(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  const reports = await assessMigrations(pending, async (sql) => {
    try {
      return Number(query<{ n: number }>(sql)[0]?.n ?? 0);
    } catch (err) {
      // The table or column doesn't exist, so dropping it loses nothing. Any
      // other failure stops the deploy rather than guessing.
      if (MISSING.test(String(err))) return 0;
      throw err;
    }
  });

  for (const r of reports) {
    const status = r.blockers.length ? 'NEEDS REVIEW' : r.reviewed ? 'reviewed' : 'safe';
    console.log(`  ${r.name}: ${status}`);
    for (const b of r.blockers) console.log(`    - ${b}`);
  }

  const blocked = reports.filter((r) => r.blockers.length);
  if (blocked.length) {
    console.error(
      [
        '',
        `Not deploying: ${blocked.length} migration(s) could change or lose existing data, and nothing has been applied.`,
        `Read the SQL, then either apply it by hand (bunx wrangler d1 migrations apply ${DB} --remote)`,
        'and re-run the deploy, or add a "-- deploy: reviewed" line to the file and push again.',
        'If the running code still reads what the migration removes, ship the code change first',
        'and the migration after it.',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (checkOnly) return;

  if (isRemote) {
    // D1 keeps 30 days of point-in-time history; log where we are so a bad
    // migration can be undone with `wrangler d1 time-travel restore`.
    try {
      wrangler(['d1', 'time-travel', 'info', DB]);
    } catch {
      console.warn('Could not read the Time Travel bookmark; continuing.');
    }
  }
  wrangler(['d1', 'migrations', 'apply', DB, ...target]);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import {
  assessMigrations,
  classifyMigration,
  classifyStatement,
  splitStatements,
} from '../scripts/migration-safety';

const noData = async () => 0;

describe('splitStatements', () => {
  it('splits on Drizzle breakpoints and semicolons, dropping comments', () => {
    const sql = [
      '-- a comment',
      'ALTER TABLE `orders` ADD `a` text;--> statement-breakpoint',
      'ALTER TABLE `orders` ADD `b` real;',
      'CREATE INDEX `x` ON `orders` (`a`);',
    ].join('\n');
    expect(splitStatements(sql)).toEqual([
      'ALTER TABLE `orders` ADD `a` text',
      'ALTER TABLE `orders` ADD `b` real',
      'CREATE INDEX `x` ON `orders` (`a`)',
    ]);
  });
});

describe('classifyStatement', () => {
  it.each([
    'CREATE TABLE `things` (`id` text PRIMARY KEY NOT NULL)',
    'CREATE UNIQUE INDEX `u` ON `things` (`id`)',
    'ALTER TABLE `orders` ADD `invoice_total` real',
    'ALTER TABLE `allocations` ADD `split_confirmed` integer DEFAULT 0 NOT NULL',
    'DROP INDEX `u`',
  ])('treats %s as safe', (sql) => {
    expect(classifyStatement(sql).kind).toBe('safe');
  });

  it.each([
    "UPDATE `orders` SET `status` = 'open'",
    'DELETE FROM `claims`',
    'ALTER TABLE `orders` RENAME TO `order_events`',
    'ALTER TABLE `orders` RENAME COLUMN `name` TO `title`',
    'PRAGMA foreign_keys=OFF',
    'INSERT INTO `__new_orders`("id") SELECT "id" FROM `orders`',
    'CREATE TABLE `__new_orders` (`id` text PRIMARY KEY NOT NULL)',
  ])('asks for review of %s', (sql) => {
    expect(classifyStatement(sql).kind).toBe('needs-review');
  });

  it('checks a dropped column for data', () => {
    expect(classifyStatement('ALTER TABLE `orders` DROP COLUMN `invoice_total`')).toEqual({
      kind: 'must-be-empty',
      reason: 'drops column orders.invoice_total',
      countSql: 'SELECT COUNT(*) AS n FROM "orders" WHERE "invoice_total" IS NOT NULL',
    });
  });

  it('checks a dropped table for rows', () => {
    expect(classifyStatement('DROP TABLE IF EXISTS `old_things`')).toMatchObject({
      kind: 'must-be-empty',
      countSql: 'SELECT COUNT(*) AS n FROM "old_things"',
    });
  });
});

describe('assessMigrations', () => {
  it('passes every migration already in the repo', async () => {
    const dir = 'db/migrations';
    const pending = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }));
    const reports = await assessMigrations(pending, noData);
    expect(reports.flatMap((r) => r.blockers)).toEqual([]);
  });

  it('blocks a Drizzle table rebuild', async () => {
    const rebuild = [
      'PRAGMA foreign_keys=OFF;--> statement-breakpoint',
      'CREATE TABLE `__new_orders` (`id` text PRIMARY KEY NOT NULL);--> statement-breakpoint',
      'INSERT INTO `__new_orders`("id") SELECT "id" FROM `orders`;--> statement-breakpoint',
      'DROP TABLE `orders`;--> statement-breakpoint',
      'ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint',
      'PRAGMA foreign_keys=ON;',
    ].join('\n');
    const [report] = await assessMigrations([{ name: '0004.sql', sql: rebuild }], noData);
    expect(report.blockers.length).toBeGreaterThan(0);
  });

  it('allows dropping an empty column but blocks one holding data', async () => {
    const sql = 'ALTER TABLE `orders` DROP COLUMN `invoice_total`;';
    const [empty] = await assessMigrations([{ name: 'a.sql', sql }], noData);
    expect(empty.blockers).toEqual([]);

    const [full] = await assessMigrations([{ name: 'a.sql', sql }], async () => 3);
    expect(full.blockers).toEqual([
      'drops column orders.invoice_total, which holds data in 3 row(s)',
    ]);
  });

  it('lets a reviewed migration through without querying', async () => {
    const sql = "-- deploy: reviewed\nUPDATE `orders` SET `status` = 'closed';";
    const count = async () => {
      throw new Error('should not query');
    };
    const [report] = await assessMigrations([{ name: 'a.sql', sql }], count);
    expect(report).toEqual({ name: 'a.sql', reviewed: true, blockers: [] });
  });
});

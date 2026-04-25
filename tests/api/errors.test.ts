import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupMiniflare,
  teardownMiniflare,
  resetDatabase,
  authFetch,
  seedMember,
  seedCatalogue,
  getDb,
} from './helpers';

beforeAll(setupMiniflare);
afterAll(teardownMiniflare);
beforeEach(resetDatabase);

describe('Global error handler', () => {
  it('returns a JSON 500 with the error message when a route throws', async () => {
    // Simulate the prod schema-drift bug: a migration that adds columns to
    // orders is merged in code but not applied to the deployed D1, so any
    // route that references those columns fails with "no such column".
    // Dropping the column here reproduces that condition in-test — Drizzle's
    // INSERT lists every column in the schema, so even POST /orders trips it.
    await getDb().exec('ALTER TABLE orders DROP COLUMN discount_percentage');

    const organiser = await seedMember('org@test.local', 'Org', 'ORG');
    const { catalogueKey } = await seedCatalogue();

    const res = await authFetch('/orders', organiser.id, 'org@test.local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Schema-drift Order', catalogueKey }),
    });

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');

    const body = (await res.json()) as { error: string; name: string };
    // Without the onError handler the response body would be Cloudflare's
    // opaque "Internal Server Error" string; with it, the DB error message
    // comes through so the client (and `wrangler tail`) can diagnose.
    expect(body.error).toMatch(/discount_percentage|no such column/i);
    expect(typeof body.name).toBe('string');
  });
});

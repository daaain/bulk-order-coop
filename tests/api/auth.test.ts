import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupMiniflare,
  teardownMiniflare,
  resetDatabase,
  appFetch,
  seedMember,
  getDb,
} from './helpers';

describe('Auth API', () => {
  beforeAll(setupMiniflare);
  afterAll(teardownMiniflare);
  beforeEach(resetDatabase);

  // ── POST /auth/magic-link ─────────────────────────────────────────────────

  describe('POST /api/auth/magic-link', () => {
    it('returns 200 with success message for a valid email', async () => {
      const res = await appFetch('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'alice@example.com' }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ message: 'Magic link sent' });
    });

    it('returns 400 for an invalid email (no @)', async () => {
      const res = await appFetch('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    });

    it('creates an auth_token row in the database', async () => {
      await appFetch('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'bob@example.com' }),
      });

      const db = getDb();
      const { results } = await db
        .prepare('SELECT * FROM auth_tokens WHERE email = ?')
        .bind('bob@example.com')
        .all();

      expect(results).toHaveLength(1);
      expect(results[0].token).toBeDefined();
      expect(results[0].expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(results[0].used_at).toBeNull();
    });
  });

  // ── GET /auth/verify ──────────────────────────────────────────────────────

  describe('GET /api/auth/verify', () => {
    async function requestMagicLink(email: string): Promise<string> {
      await appFetch('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const db = getDb();
      const { results } = await db
        .prepare('SELECT token FROM auth_tokens WHERE email = ?')
        .bind(email)
        .all();

      return results[0].token as string;
    }

    it('returns 200 with JWT and isNewUser:true for a new user', async () => {
      const token = await requestMagicLink('newuser@example.com');

      const res = await appFetch(`/auth/verify?token=${token}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        token: string;
        user: { id: string; email: string; name: string | null; initials: string | null };
        isNewUser: boolean;
      };
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe('newuser@example.com');
      expect(body.user.id).toBeDefined();
      expect(body.isNewUser).toBe(true);
    });

    it('returns isNewUser:false for a returning user', async () => {
      // Seed an existing member with the same email
      await seedMember('returning@example.com', 'Return User', 'RU');
      const token = await requestMagicLink('returning@example.com');

      const res = await appFetch(`/auth/verify?token=${token}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { isNewUser: boolean; user: { name: string } };
      expect(body.isNewUser).toBe(false);
      expect(body.user.name).toBe('Return User');
    });

    it('returns 401 for an already-used token', async () => {
      const token = await requestMagicLink('used@example.com');

      // First verification — should succeed
      const first = await appFetch(`/auth/verify?token=${token}`);
      expect(first.status).toBe(200);

      // Second verification — token already used
      const second = await appFetch(`/auth/verify?token=${token}`);
      expect(second.status).toBe(401);

      const body = (await second.json()) as { error: string };
      expect(body.error).toMatch(/already used/i);
    });

    it('returns 401 for an expired token', async () => {
      const db = getDb();
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      await db
        .prepare('INSERT INTO auth_tokens (id, email, token, expires_at) VALUES (?, ?, ?, ?)')
        .bind('tok-expired', 'expired@example.com', 'expired-token-abc', pastExpiry)
        .run();

      const res = await appFetch('/auth/verify?token=expired-token-abc');
      expect(res.status).toBe(401);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/expired/i);
    });
  });

  // ── PUT /auth/profile ─────────────────────────────────────────────────────

  describe('PUT /api/auth/profile', () => {
    it('updates name and initials for an existing member', async () => {
      const { id: memberId } = await seedMember('profile@example.com');

      const res = await appFetch('/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, name: 'Alice Smith', initials: 'AS' }),
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        user: { id: string; email: string; name: string; initials: string };
      };
      expect(body.user.name).toBe('Alice Smith');
      expect(body.user.initials).toBe('AS');
      expect(body.user.email).toBe('profile@example.com');
    });

    it('returns 400 when initials are too short (1 char)', async () => {
      const { id: memberId } = await seedMember('short@example.com');

      const res = await appFetch('/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, name: 'Bob', initials: 'B' }),
      });

      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/initials/i);
    });
  });
});

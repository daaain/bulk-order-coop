import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupMiniflare,
  teardownMiniflare,
  resetDatabase,
  appFetch,
  authFetch,
  seedMember,
  seedCatalogue,
} from './helpers';

describe('Order routes', () => {
  beforeAll(setupMiniflare);
  afterAll(teardownMiniflare);
  beforeEach(resetDatabase);

  /** Seed a member + catalogue in R2, return both. */
  async function seedDeps() {
    const member = await seedMember('alice@test.local', 'Alice', 'AL');
    const { catalogueKey } = await seedCatalogue();
    return { member, catalogueKey };
  }

  /** Create an order via the API and return the response body. */
  async function createOrder(
    memberId: string,
    email: string,
    catalogueKey: string,
    name = 'Weekly Order',
  ) {
    const res = await authFetch(`/orders`, memberId, email, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, catalogueKey }),
    });
    return {
      res,
      body: (await res.json()) as {
        id: string;
        name: string;
        inviteCode: string;
        status: string;
        catalogueKey: string;
        createdBy: string;
      },
    };
  }

  // ----------------------------------------------------------------
  // POST /orders
  // ----------------------------------------------------------------
  describe('POST /orders', () => {
    it('creates an order and auto-adds the organiser', async () => {
      const { member, catalogueKey } = await seedDeps();

      const { res, body } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Weekly Order');
      expect(body.catalogueKey).toBe(catalogueKey);
      expect(body.inviteCode).toBeDefined();
      expect(body.status).toBe('open');
      expect(body.createdBy).toBe(member.id);
    });

    it('rejects a missing name with 400', async () => {
      const { member, catalogueKey } = await seedDeps();

      const res = await authFetch(`/orders`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogueKey }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/name/i);
    });

    it('returns 401 without auth', async () => {
      const res = await appFetch('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'No Auth Order', catalogueKey: 'fake' }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------------
  // GET /orders
  // ----------------------------------------------------------------
  describe('GET /orders', () => {
    it("returns the member's orders", async () => {
      const { member, catalogueKey } = await seedDeps();
      await createOrder(member.id, 'alice@test.local', catalogueKey);

      const res = await authFetch('/orders', member.id, 'alice@test.local');
      expect(res.status).toBe(200);

      const body = (await res.json()) as Array<{ id: string; name: string; memberCount: number }>;
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Weekly Order');
      expect(body[0].memberCount).toBe(1);
    });

    it('returns an empty array for a member with no orders', async () => {
      const member = await seedMember('lonely@test.local', 'Lonely', 'LN');

      const res = await authFetch('/orders', member.id, 'lonely@test.local');
      expect(res.status).toBe(200);

      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // GET /orders/:id
  // ----------------------------------------------------------------
  describe('GET /orders/:id', () => {
    it('returns the order with a members array', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const res = await authFetch(`/orders/${order.id}`, member.id, 'alice@test.local');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        id: string;
        members: Array<{ memberId: string; role: string }>;
      };
      expect(body.id).toBe(order.id);
      expect(body.members).toHaveLength(1);
      expect(body.members[0].memberId).toBe(member.id);
      expect(body.members[0].role).toBe('organiser');
    });

    it('returns 403 for a non-member', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const outsider = await seedMember('outsider@test.local', 'Outsider', 'OU');
      const res = await authFetch(`/orders/${order.id}`, outsider.id, 'outsider@test.local');

      expect(res.status).toBe(403);
    });
  });

  // ----------------------------------------------------------------
  // PUT /orders/:id
  // ----------------------------------------------------------------
  describe('PUT /orders/:id', () => {
    it('allows the organiser to update the name', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const res = await authFetch(`/orders/${order.id}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string };
      expect(body.name).toBe('New Name');
    });

    it('rejects updates from a regular member with 403', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      // Join as a regular member
      const joiner = await seedMember('bob@test.local', 'Bob', 'BO');
      await authFetch(`/orders/${order.id}/join`, joiner.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: order.inviteCode }),
      });

      const res = await authFetch(`/orders/${order.id}`, joiner.id, 'bob@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Hijacked' }),
      });

      expect(res.status).toBe(403);
    });

    it('transitions open to closed', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const res = await authFetch(`/orders/${order.id}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('closed');
    });

    it('rejects an invalid status transition (open to complete) with 400', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const res = await authFetch(`/orders/${order.id}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'complete' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/cannot transition/i);
    });
  });

  // ----------------------------------------------------------------
  // POST /orders/:id/join
  // ----------------------------------------------------------------
  describe('POST /orders/:id/join', () => {
    it('allows a member to join with the correct invite code', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const joiner = await seedMember('bob@test.local', 'Bob', 'BO');
      const res = await authFetch(`/orders/${order.id}/join`, joiner.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: order.inviteCode }),
      });

      expect(res.status).toBe(200);

      // Verify by listing the order's members
      const detailRes = await authFetch(`/orders/${order.id}`, joiner.id, 'bob@test.local');
      const detail = (await detailRes.json()) as {
        members: Array<{ memberId: string; role: string }>;
      };
      expect(detail.members).toHaveLength(2);
    });

    it('rejects a wrong invite code with 400', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const joiner = await seedMember('bob@test.local', 'Bob', 'BO');
      const res = await authFetch(`/orders/${order.id}/join`, joiner.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: 'wrong-code' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invalid invite code/i);
    });

    it('rejects a duplicate join with 409', async () => {
      const { member, catalogueKey } = await seedDeps();
      const { body: order } = await createOrder(member.id, 'alice@test.local', catalogueKey);

      const joiner = await seedMember('bob@test.local', 'Bob', 'BO');
      // First join succeeds
      await authFetch(`/orders/${order.id}/join`, joiner.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: order.inviteCode }),
      });

      // Second join should be rejected
      const res = await authFetch(`/orders/${order.id}/join`, joiner.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: order.inviteCode }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already a member/i);
    });
  });
});

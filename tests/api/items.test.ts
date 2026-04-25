import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupMiniflare,
  teardownMiniflare,
  resetDatabase,
  authFetch,
  seedMember,
  seedCatalogue,
  seedOrderItem,
  getDb,
  TEST_ITEMS,
} from './helpers';

async function addOrderMember(orderId: string, memberId: string, role: 'member' | 'organiser' = 'member') {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      'INSERT INTO order_members (order_id, member_id, role, joined_at) VALUES (?, ?, ?, ?)',
    )
    .bind(orderId, memberId, role, now)
    .run();
}

describe('Item routes', () => {
  beforeAll(setupMiniflare);
  afterAll(teardownMiniflare);
  beforeEach(resetDatabase);

  /** Seed a member + catalogue in R2 + open order, return all IDs. */
  async function seedOrder() {
    const member = await seedMember('alice@test.local', 'Alice', 'AL');
    const { catalogueKey } = await seedCatalogue();

    const res = await authFetch('/orders', member.id, 'alice@test.local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Order', catalogueKey }),
    });

    const order = (await res.json()) as { id: string; catalogueKey: string };
    return { member, catalogueKey, orderId: order.id };
  }

  // ----------------------------------------------------------------
  // POST /orders/:id/items
  // ----------------------------------------------------------------
  describe('POST /orders/:id/items', () => {
    it('adds an item with full product snapshot', async () => {
      const { member, orderId } = await seedOrder();

      const { id } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      expect(id).toBeDefined();
    });

    it('returns the snapshot fields in the response', async () => {
      const { member, orderId } = await seedOrder();

      const res = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_ITEMS['1001']),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.id).toBeDefined();
      expect(body.orderId).toBe(orderId);
      expect(body.productCode).toBe('1001');
      expect(body.description).toBe('Arborio Rice - white - Italy');
      expect(body.casePrice).toBe(15.55);
      expect(body.addedBy).toBe(member.id);
    });

    it('rejects a duplicate product code with 409', async () => {
      const { member, orderId } = await seedOrder();

      await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      const res = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_ITEMS['1001']),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already/i);
    });

    it('rejects missing description with 400', async () => {
      const { member, orderId } = await seedOrder();

      const res = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productCode: '1001',
          casePrice: 10,
          vatRate: 0,
          packSize: 500,
          unit: 'g',
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/description/i);
    });

    it('rejects adding to a closed order with 400', async () => {
      const { member, orderId } = await seedOrder();

      // Close the order
      await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });

      const res = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_ITEMS['1001']),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not open/i);
    });
  });

  // ----------------------------------------------------------------
  // GET /orders/:id/items
  // ----------------------------------------------------------------
  describe('GET /orders/:id/items', () => {
    it('returns items with catalogue data and rounding info', async () => {
      const { member, orderId } = await seedOrder();
      await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');
      await seedOrderItem(orderId, member.id, 'alice@test.local', '1002');

      const res = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local');

      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        orderItem: { id: string; productCode: string; description: string };
        catalogueItem: { productCode: string; description: string };
        claims: unknown[];
        rounding: { totalClaimed: number; caseSize: number; casesNeeded: number };
      }>;

      expect(body).toHaveLength(2);
      expect(body[0].orderItem).toBeDefined();
      expect(body[0].orderItem.description).toBeDefined();
      expect(body[0].catalogueItem).toBeDefined();
      expect(body[0].catalogueItem.description).toBeDefined();
      expect(body[0].claims).toBeDefined();
      expect(body[0].rounding).toBeDefined();
      expect(body[0].rounding.totalClaimed).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // PUT /orders/:id/items/:itemId/swap
  // ----------------------------------------------------------------
  describe('PUT /orders/:id/items/:itemId/swap', () => {
    it('swaps the snapshot on an item with no claims', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        orderItem: { id: string; productCode: string; description: string };
        claims: unknown[];
      };
      expect(body.orderItem.id).toBe(itemId);
      expect(body.orderItem.productCode).toBe('1002');
      expect(body.orderItem.description).toBe('Black Rice - Italy');
      expect(body.claims).toEqual([]);
    });

    it('preserves claims across a straight swap', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      await authFetch(`/orders/${orderId}/items/${itemId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000, flexibility: '+' }),
      });

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        orderItem: { id: string; productCode: string };
        claims: Array<{ memberId: string; amount: number; flexibility: string | null }>;
      };
      expect(body.orderItem.id).toBe(itemId);
      expect(body.orderItem.productCode).toBe('1002');
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0].memberId).toBe(member.id);
      expect(body.claims[0].amount).toBe(1000);
      expect(body.claims[0].flexibility).toBe('+');
    });

    it('merges into an existing target item with non-overlapping members', async () => {
      const { member, orderId } = await seedOrder();
      // Seed a second member and add them to the order
      const bob = await seedMember('bob@test.local', 'Bob', 'BO');
      await addOrderMember(orderId, bob.id);

      const { id: sourceId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');
      const { id: targetId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1002');

      // Alice claims on source
      await authFetch(`/orders/${orderId}/items/${sourceId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500, flexibility: '+' }),
      });
      // Bob claims on target
      await authFetch(`/orders/${orderId}/items/${targetId}/claims`, bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000, flexibility: '-' }),
      });

      // Swap source → target's productCode ⇒ merge
      const res = await authFetch(
        `/orders/${orderId}/items/${sourceId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        orderItem: { id: string; productCode: string };
        claims: Array<{ memberId: string; amount: number; flexibility: string | null }>;
      };
      expect(body.orderItem.id).toBe(targetId);
      expect(body.orderItem.productCode).toBe('1002');
      expect(body.claims).toHaveLength(2);

      const listRes = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local');
      const items = (await listRes.json()) as Array<{ orderItem: { id: string } }>;
      expect(items).toHaveLength(1);
      expect(items[0].orderItem.id).toBe(targetId);
    });

    it('sums claims and keeps flexibility when merging and both sides agree', async () => {
      const { member, orderId } = await seedOrder();
      const { id: sourceId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');
      const { id: targetId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1002');

      await authFetch(`/orders/${orderId}/items/${sourceId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500, flexibility: '+' }),
      });
      await authFetch(`/orders/${orderId}/items/${targetId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000, flexibility: '+' }),
      });

      const res = await authFetch(
        `/orders/${orderId}/items/${sourceId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        orderItem: { id: string };
        claims: Array<{ memberId: string; amount: number; flexibility: string | null }>;
      };
      expect(body.orderItem.id).toBe(targetId);
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0].amount).toBe(1500);
      expect(body.claims[0].flexibility).toBe('+');
    });

    it('collapses flexibility to * when merging and sides disagree', async () => {
      const { member, orderId } = await seedOrder();
      const { id: sourceId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');
      const { id: targetId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1002');

      await authFetch(`/orders/${orderId}/items/${sourceId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500, flexibility: '+' }),
      });
      await authFetch(`/orders/${orderId}/items/${targetId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000, flexibility: '-' }),
      });

      const res = await authFetch(
        `/orders/${orderId}/items/${sourceId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      const body = (await res.json()) as {
        claims: Array<{ amount: number; flexibility: string | null }>;
      };
      expect(body.claims).toHaveLength(1);
      expect(body.claims[0].amount).toBe(1500);
      expect(body.claims[0].flexibility).toBe('*');
    });

    it('works while the order is reconciling', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      await authFetch(`/orders/${orderId}/items/${itemId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      // Advance order through its lifecycle
      await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reconciling' }),
      });

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        orderItem: { productCode: string };
        claims: unknown[];
      };
      expect(body.orderItem.productCode).toBe('1002');
      expect(body.claims).toHaveLength(1);
    });

    it('rejects swap once any delivery row exists for the order', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');
      // A second item that we'll set delivery on, simulating "invoice processed".
      const { id: otherItemId } = await seedOrderItem(
        orderId,
        member.id,
        'alice@test.local',
        '1002',
      );

      await authFetch(`/orders/${orderId}/items/${itemId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reconciling' }),
      });

      // Record a delivery on a different item — proves the gate is order-wide.
      await authFetch(
        `/orders/${orderId}/items/${otherItemId}/delivery`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1003']),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/invoice has been processed/i);
    });

    it('rejects swap from a non-member with 403', async () => {
      const { member, orderId } = await seedOrder();
      const intruder = await seedMember('eve@test.local', 'Eve', 'EV');
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/swap`,
        intruder.id,
        'eve@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(403);
    });

    it('returns 404 for a missing item', async () => {
      const { member, orderId } = await seedOrder();

      const res = await authFetch(
        `/orders/${orderId}/items/nonexistent/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(TEST_ITEMS['1002']),
        },
      );

      expect(res.status).toBe(404);
    });

    it('rejects an invalid target snapshot with 400', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/swap`,
        member.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...TEST_ITEMS['1002'], casePrice: -1 }),
        },
      );

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------------
  // DELETE /orders/:id/items/:itemId
  // ----------------------------------------------------------------
  describe('DELETE /orders/:id/items/:itemId', () => {
    it('removes an item with no claims', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}`,
        member.id,
        'alice@test.local',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify the item is gone
      const listRes = await authFetch(`/orders/${orderId}/items`, member.id, 'alice@test.local');
      const items = (await listRes.json()) as unknown[];
      expect(items).toHaveLength(0);
    });

    it('rejects deletion when item has claims', async () => {
      const { member, orderId } = await seedOrder();
      const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

      // Add a claim on this item
      await authFetch(`/orders/${orderId}/items/${itemId}/claims`, member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}`,
        member.id,
        'alice@test.local',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/claims/i);
    });
  });
});

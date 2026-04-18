import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupMiniflare,
  teardownMiniflare,
  resetDatabase,
  authFetch,
  seedMember,
  seedCatalogue,
  seedOrderItem,
} from './helpers';

describe('Claim routes', () => {
  beforeAll(setupMiniflare);
  afterAll(teardownMiniflare);
  beforeEach(resetDatabase);

  /** Seed member + catalogue + order + one item; return all IDs. */
  async function seedOrderWithItem(productCode = '1001') {
    const member = await seedMember('alice@test.local', 'Alice', 'AL');
    const { catalogueKey } = await seedCatalogue();

    const orderRes = await authFetch('/orders', member.id, 'alice@test.local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Order', catalogueKey }),
    });
    const order = (await orderRes.json()) as { id: string };

    const { id: itemId } = await seedOrderItem(
      order.id,
      member.id,
      'alice@test.local',
      productCode,
    );

    return { member, catalogueKey, orderId: order.id, itemId };
  }

  /** Helper to build the claims path. */
  function claimsPath(orderId: string, itemId: string) {
    return `/orders/${orderId}/items/${itemId}/claims`;
  }

  // ----------------------------------------------------------------
  // POST /orders/:id/items/:itemId/claims
  // ----------------------------------------------------------------
  describe('POST claims', () => {
    it('creates a claim and returns rounding info', async () => {
      const { member, orderId, itemId } = await seedOrderWithItem();

      const res = await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        claim: { id: string; amount: number; orderItemId: string; memberId: string };
        rounding: {
          totalClaimed: number;
          caseSize: number;
          casesNeeded: number;
          gap: number;
          status: string;
        };
      };

      expect(body.claim.id).toBeDefined();
      expect(body.claim.amount).toBe(500);
      expect(body.claim.orderItemId).toBe(itemId);
      expect(body.claim.memberId).toBe(member.id);
      expect(body.rounding).toBeDefined();
      expect(body.rounding.totalClaimed).toBe(500);
    });

    it('rejects a duplicate claim with 409', async () => {
      const { member, orderId, itemId } = await seedOrderWithItem();

      await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      const res = await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 250 }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already/i);
    });

    it('rejects a claim from a regular member when the order is not open', async () => {
      const { member, orderId, itemId } = await seedOrderWithItem();

      // Add a regular member
      const orderRes = await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local');
      const order = (await orderRes.json()) as { inviteCode: string };
      const bob = await seedMember('bob@test.local', 'Bob', 'BO');
      await authFetch(`/orders/${orderId}/join`, bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: order.inviteCode }),
      });

      // Close the order
      await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });

      // Bob (regular member) tries to claim — should fail
      const res = await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not open/i);
    });
  });

  // ----------------------------------------------------------------
  // PUT /orders/:id/items/:itemId/claims
  // ----------------------------------------------------------------
  describe('PUT claims', () => {
    it('updates the claim amount and returns new rounding', async () => {
      const { member, orderId, itemId } = await seedOrderWithItem();

      // Create the initial claim
      await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      // Update to a larger amount
      const res = await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 1000 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        claim: { amount: number };
        rounding: { totalClaimed: number };
      };

      expect(body.claim.amount).toBe(1000);
      expect(body.rounding.totalClaimed).toBe(1000);
    });
  });

  // ----------------------------------------------------------------
  // DELETE /orders/:id/items/:itemId/claims
  // ----------------------------------------------------------------
  describe('DELETE claims', () => {
    it('removes the claim and returns updated rounding', async () => {
      const { member, orderId, itemId } = await seedOrderWithItem();

      // Create a claim first
      await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      // Delete it
      const res = await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        rounding: { totalClaimed: number; casesNeeded: number };
      };

      expect(body.rounding).toBeDefined();
      expect(body.rounding.totalClaimed).toBe(0);
      expect(body.rounding.casesNeeded).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // Organiser claim management
  // ----------------------------------------------------------------
  describe('Organiser claim management', () => {
    /** Seed order with two members (Alice = organiser, Bob = member) and one item. */
    async function seedOrderWithTwoMembersAndItem(productCode = '1001') {
      const alice = await seedMember('alice@test.local', 'Alice', 'AL');
      const { catalogueKey } = await seedCatalogue();

      const orderRes = await authFetch('/orders', alice.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Order', catalogueKey }),
      });
      const order = (await orderRes.json()) as { id: string; inviteCode: string };

      const bob = await seedMember('bob@test.local', 'Bob', 'BO');
      await authFetch(`/orders/${order.id}/join`, bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: order.inviteCode }),
      });

      const { id: itemId } = await seedOrderItem(
        order.id,
        alice.id,
        'alice@test.local',
        productCode,
      );

      return { alice, bob, orderId: order.id, itemId };
    }

    /** Advance order status through the given transitions. */
    async function advanceOrder(
      orderId: string,
      memberId: string,
      email: string,
      ...statuses: string[]
    ) {
      for (const status of statuses) {
        await authFetch(`/orders/${orderId}`, memberId, email, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
      }
    }

    it('organiser creates claim for another member', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 500, memberId: bob.id }),
        },
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as { claim: { memberId: string; amount: number } };
      expect(body.claim.memberId).toBe(bob.id);
      expect(body.claim.amount).toBe(500);
    });

    it('organiser updates another member\'s claim', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      // Bob creates his own claim first
      await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      // Alice (organiser) updates it
      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1000, memberId: bob.id }),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { claim: { amount: number } };
      expect(body.claim.amount).toBe(1000);
    });

    it('organiser deletes another member\'s claim', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      // Bob creates a claim
      await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      // Alice deletes it via query param
      const res = await authFetch(
        `${claimsPath(orderId, itemId)}?memberId=${bob.id}`,
        alice.id,
        'alice@test.local',
        { method: 'DELETE' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { rounding: { totalClaimed: number } };
      expect(body.rounding.totalClaimed).toBe(0);
    });

    it('non-organiser cannot create claim for another member (403)', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      const res = await authFetch(
        claimsPath(orderId, itemId),
        bob.id,
        'bob@test.local',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 500, memberId: alice.id }),
        },
      );

      expect(res.status).toBe(403);
    });

    it('organiser can edit claims when order is closed', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      // Bob claims while open
      await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      // Close the order
      await advanceOrder(orderId, alice.id, 'alice@test.local', 'closed');

      // Organiser updates Bob's claim
      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1000, memberId: bob.id }),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { claim: { amount: number } };
      expect(body.claim.amount).toBe(1000);
    });

    it('organiser can edit claims when order is reconciling', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      await advanceOrder(orderId, alice.id, 'alice@test.local', 'closed', 'reconciling');

      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1000, memberId: bob.id }),
        },
      );

      expect(res.status).toBe(200);
    });

    it('organiser cannot edit claims when order is complete', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      await advanceOrder(orderId, alice.id, 'alice@test.local', 'closed', 'reconciling', 'complete');

      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1000, memberId: bob.id }),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/complete/i);
    });

    it('regular member still blocked when order is closed', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      await authFetch(claimsPath(orderId, itemId), bob.id, 'bob@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      await advanceOrder(orderId, alice.id, 'alice@test.local', 'closed');

      // Bob tries to update his own claim — should be blocked
      const res = await authFetch(
        claimsPath(orderId, itemId),
        bob.id,
        'bob@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 1000 }),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not open/i);
    });

    it('organiser cannot create claim for non-member of order (400)', async () => {
      const { alice, orderId, itemId } = await seedOrderWithTwoMembersAndItem();
      const outsider = await seedMember('outsider@test.local', 'Outsider', 'OU');

      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 500, memberId: outsider.id }),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not a member/i);
    });

    it('duplicate claim for member via organiser returns 409', async () => {
      const { alice, bob, orderId, itemId } = await seedOrderWithTwoMembersAndItem();

      // Create a claim for Bob
      await authFetch(claimsPath(orderId, itemId), alice.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500, memberId: bob.id }),
      });

      // Try to create another
      const res = await authFetch(
        claimsPath(orderId, itemId),
        alice.id,
        'alice@test.local',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 250, memberId: bob.id }),
        },
      );

      expect(res.status).toBe(409);
    });
  });

  // ----------------------------------------------------------------
  // GET /orders/:id/claims/mine
  // ----------------------------------------------------------------
  describe('GET /orders/:id/claims/mine', () => {
    it('returns claims with cost totals', async () => {
      const { member, orderId, itemId } = await seedOrderWithItem();

      // Create a claim
      await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 500 }),
      });

      const res = await authFetch(`/orders/${orderId}/claims/mine`, member.id, 'alice@test.local');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        claims: Array<{
          claim: { id: string; amount: number };
          orderItem: { id: string };
          catalogueItem: { productCode: string };
          estimatedCost: { net: number; vat: number; gross: number };
        }>;
        totals: { net: number; vat: number; gross: number };
      };

      expect(body.claims).toHaveLength(1);
      expect(body.claims[0].claim.amount).toBe(500);
      expect(body.claims[0].estimatedCost).toBeDefined();
      expect(body.claims[0].estimatedCost.gross).toBeGreaterThan(0);
      expect(body.totals).toBeDefined();
      expect(body.totals.gross).toBeGreaterThan(0);
    });

    it('returns empty claims and zero totals when member has no claims', async () => {
      const { member, orderId } = await seedOrderWithItem();

      const res = await authFetch(`/orders/${orderId}/claims/mine`, member.id, 'alice@test.local');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        claims: unknown[];
        totals: { net: number; vat: number; gross: number };
      };

      expect(body.claims).toHaveLength(0);
      expect(body.totals).toEqual({ net: 0, vat: 0, gross: 0 });
    });
  });
});

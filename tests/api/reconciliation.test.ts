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

beforeAll(setupMiniflare);
afterAll(teardownMiniflare);
beforeEach(resetDatabase);

/**
 * Sets up a fully reconciling order with one item and one claim.
 * Returns all the IDs needed for reconciliation tests.
 */
async function setupReconcilingOrder(opts?: { secondMember?: boolean }) {
  const organiser = await seedMember('organiser@test.local', 'Organiser', 'ORG');
  const { catalogueKey } = await seedCatalogue();

  // Create order
  const createRes = await authFetch('/orders', organiser.id, 'organiser@test.local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Recon Order', catalogueKey }),
  });
  const order = (await createRes.json()) as { id: string; inviteCode: string };

  // Add item (product code 1001: casePrice 15.55, 6 units, 500g, vatRate 0)
  const { id: itemId } = await seedOrderItem(
    order.id,
    organiser.id,
    'organiser@test.local',
    '1001',
  );

  // Create claim (organiser claims 500g)
  await authFetch(
    `/orders/${order.id}/items/${itemId}/claims`,
    organiser.id,
    'organiser@test.local',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500 }),
    },
  );

  // Optionally add a second member who joins and claims
  let member: { id: string; jwt: string } | undefined;
  if (opts?.secondMember) {
    member = await seedMember('member@test.local', 'Member', 'MEM');
    // Join order
    await authFetch(`/orders/${order.id}/join`, member.id, 'member@test.local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: order.inviteCode }),
    });
    // Claim 500g
    await authFetch(`/orders/${order.id}/items/${itemId}/claims`, member.id, 'member@test.local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500 }),
    });
  }

  // Close order: open → closed
  await authFetch(`/orders/${order.id}`, organiser.id, 'organiser@test.local', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'closed' }),
  });

  // Move to reconciling: closed → reconciling
  await authFetch(`/orders/${order.id}`, organiser.id, 'organiser@test.local', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'reconciling' }),
  });

  return { organiser, member, catalogueKey, orderId: order.id, itemId };
}

describe('Reconciliation API', () => {
  describe('PUT /orders/:id/items/:itemId/delivery', () => {
    it('creates a delivery record', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { delivery: { orderItemId: string; status: string } };
      expect(body.delivery).toBeDefined();
      expect(body.delivery.orderItemId).toBe(itemId);
      expect(body.delivery.status).toBe('arrived');
    });

    it('updates an existing delivery record', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      // Create initial delivery
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      // Update to different status
      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'partial', actualQuantity: 3 }),
        },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { delivery: { status: string; actualQuantity: number } };
      expect(body.delivery.status).toBe('partial');
      expect(body.delivery.actualQuantity).toBe(3);
    });

    it('rejects members who are not organisers', async () => {
      const { member, orderId, itemId } = await setupReconcilingOrder({ secondMember: true });

      const res = await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        member!.id,
        'member@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'missing' }),
        },
      );

      expect(res.status).toBe(403);
    });

    it('rejects when order is not reconciling', async () => {
      const organiser = await seedMember('organiser@test.local', 'Organiser', 'ORG');
      const { catalogueKey } = await seedCatalogue();

      // Create order (stays open)
      const createRes = await authFetch('/orders', organiser.id, 'organiser@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Open Order', catalogueKey }),
      });
      const order = (await createRes.json()) as { id: string };

      // Add item
      const { id: itemId } = await seedOrderItem(
        order.id,
        organiser.id,
        'organiser@test.local',
        '1001',
      );

      const res = await authFetch(
        `/orders/${order.id}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/reconciling/);
    });
  });

  describe('GET /orders/:id/reconciliation', () => {
    it('returns full reconciliation summary', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      // Set delivery status (required for meaningful data)
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      const res = await authFetch(
        `/orders/${orderId}/reconciliation`,
        organiser.id,
        'organiser@test.local',
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: unknown[];
        memberSummaries: unknown[];
        orderTotals: { net: number; vat: number; gross: number };
        allConfirmed: boolean;
      };
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBe(1);
      expect(body.memberSummaries).toBeInstanceOf(Array);
      expect(body.orderTotals).toBeDefined();
      expect(typeof body.orderTotals.net).toBe('number');
      expect(typeof body.orderTotals.vat).toBe('number');
      expect(typeof body.orderTotals.gross).toBe('number');
      expect(typeof body.allConfirmed).toBe('boolean');
    });

    it('applies a percentage-points discount split to member allocations', async () => {
      // Order setup: one item (productCode 1001, casePrice 15.55, 6×500g = 3000g case,
      // vatRate 0). Organiser claims 500g. With a 6% wholesale discount and a
      // 2% admin fee, members see 4% off: (500/3000) × 15.55 × (1 − 0.04).
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      // Apply the discount at the order level.
      const patchRes = await authFetch(`/orders/${orderId}`, organiser.id, 'organiser@test.local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountPercentage: 6, adminFeePercentage: 2 }),
      });
      expect(patchRes.status).toBe(200);

      // Mark the item as arrived so there's a delivery status.
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      // Generate allocations so the summary reflects the post-discount price.
      await authFetch(`/orders/${orderId}/allocate`, organiser.id, 'organiser@test.local', {
        method: 'POST',
      });

      const res = await authFetch(
        `/orders/${orderId}/reconciliation`,
        organiser.id,
        'organiser@test.local',
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        orderTotals: { net: number; vat: number; gross: number };
        memberSummaries: { totals: { net: number } }[];
        discount: {
          discountPercentage: number;
          adminFeePercentage: number;
          memberDiscountPercentage: number;
          subtotalBeforeDiscount: number;
          discountAmount: number;
          adminFeeAmount: number;
          memberDiscountAmount: number;
        } | null;
      };

      // Raw: 500/3000 × 15.55 = 2.5916…; with 4% off → 2.488
      const expectedNet = (500 / 3000) * 15.55 * 0.96;
      expect(body.memberSummaries).toHaveLength(1);
      expect(body.memberSummaries[0].totals.net).toBeCloseTo(expectedNet, 2);
      expect(body.orderTotals.net).toBeCloseTo(expectedNet, 2);

      expect(body.discount).not.toBeNull();
      expect(body.discount!.discountPercentage).toBe(6);
      expect(body.discount!.adminFeePercentage).toBe(2);
      expect(body.discount!.memberDiscountPercentage).toBe(4);
      // The pre-discount subtotal should recover the raw net (2.5916…).
      expect(body.discount!.subtotalBeforeDiscount).toBeCloseTo((500 / 3000) * 15.55, 2);
    });

    it('returns discount: null when no invoice discount is applied', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );
      const res = await authFetch(
        `/orders/${orderId}/reconciliation`,
        organiser.id,
        'organiser@test.local',
      );
      const body = (await res.json()) as { discount: unknown };
      expect(body.discount).toBeNull();
    });

    it('returns an empty summary when order is open', async () => {
      const organiser = await seedMember('organiser@test.local', 'Organiser', 'ORG');
      const { catalogueKey } = await seedCatalogue();

      const createRes = await authFetch('/orders', organiser.id, 'organiser@test.local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Open Order', catalogueKey }),
      });
      const order = (await createRes.json()) as { id: string };

      const res = await authFetch(
        `/orders/${order.id}/reconciliation`,
        organiser.id,
        'organiser@test.local',
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: unknown[];
        memberSummaries: unknown[];
        orderTotals: { net: number; vat: number; gross: number };
      };
      expect(body.items).toEqual([]);
      expect(body.memberSummaries).toEqual([]);
      expect(body.orderTotals).toEqual({ net: 0, vat: 0, gross: 0 });
    });
  });

  describe('POST /orders/:id/allocate', () => {
    it('generates allocations when all items have delivery status', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      // Set delivery status for item
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );

      const res = await authFetch(
        `/orders/${orderId}/allocate`,
        organiser.id,
        'organiser@test.local',
        { method: 'POST' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { count: number };
      expect(body.count).toBeGreaterThan(0);
    });

    it('reprices existing allocations when the order discount changes', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();
      const put = (path: string, body: object) =>
        authFetch(path, organiser.id, 'organiser@test.local', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const allocationPrice = async () => {
        const res = await authFetch(
          `/orders/${orderId}/reconciliation`,
          organiser.id,
          'organiser@test.local',
        );
        const body = (await res.json()) as { items: { allocations: { price: number }[] }[] };
        return body.items[0].allocations[0].price;
      };

      await put(`/orders/${orderId}/items/${itemId}/delivery`, { status: 'arrived' });
      await authFetch(`/orders/${orderId}/allocate`, organiser.id, 'organiser@test.local', {
        method: 'POST',
      });
      const fullPrice = await allocationPrice();

      // 6% discount with 2% admin → members get 4% off.
      await put(`/orders/${orderId}`, { discountPercentage: 6, adminFeePercentage: 2 });
      expect(await allocationPrice()).toBeCloseTo(fullPrice * 0.96, 2);

      await put(`/orders/${orderId}`, { discountPercentage: null });
      expect(await allocationPrice()).toBeCloseTo(fullPrice, 2);
    });

    it('rejects when delivery status is missing', async () => {
      const { organiser, orderId } = await setupReconcilingOrder();

      // Do NOT set delivery status
      const res = await authFetch(
        `/orders/${orderId}/allocate`,
        organiser.id,
        'organiser@test.local',
        { method: 'POST' },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/missing delivery status/i);
    });

    it('rejects non-organiser', async () => {
      const { orderId, member } = await setupReconcilingOrder({ secondMember: true });

      const res = await authFetch(`/orders/${orderId}/allocate`, member!.id, 'member@test.local', {
        method: 'POST',
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/organiser/i);
    });
  });

  describe('PUT /orders/:id/allocations/:allocationId/confirm', () => {
    it('confirms own allocation', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      // Set delivery + allocate
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );
      await authFetch(`/orders/${orderId}/allocate`, organiser.id, 'organiser@test.local', {
        method: 'POST',
      });

      // Get reconciliation to find allocation ID
      const reconRes = await authFetch(
        `/orders/${orderId}/reconciliation`,
        organiser.id,
        'organiser@test.local',
      );
      const reconBody = (await reconRes.json()) as {
        items: Array<{ allocations: Array<{ id: string; memberId: string; confirmed: boolean }> }>;
      };
      const allocation = reconBody.items[0].allocations.find((a) => a.memberId === organiser.id);
      expect(allocation).toBeDefined();

      const res = await authFetch(
        `/orders/${orderId}/allocations/${allocation!.id}/confirm`,
        organiser.id,
        'organiser@test.local',
        { method: 'PUT' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { confirmed: boolean };
      expect(body.confirmed).toBe(true);
    });
  });

  describe('PUT /orders/:id/confirm-all', () => {
    it('confirms all own allocations', async () => {
      const { organiser, orderId, itemId } = await setupReconcilingOrder();

      // Set delivery + allocate
      await authFetch(
        `/orders/${orderId}/items/${itemId}/delivery`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );
      await authFetch(`/orders/${orderId}/allocate`, organiser.id, 'organiser@test.local', {
        method: 'POST',
      });

      const res = await authFetch(
        `/orders/${orderId}/confirm-all`,
        organiser.id,
        'organiser@test.local',
        { method: 'PUT' },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { count: number };
      expect(body.count).toBeGreaterThan(0);

      // Verify via reconciliation that allConfirmed is now true
      const reconRes = await authFetch(
        `/orders/${orderId}/reconciliation`,
        organiser.id,
        'organiser@test.local',
      );
      const reconBody = (await reconRes.json()) as { allConfirmed: boolean };
      expect(reconBody.allConfirmed).toBe(true);
    });
  });

  describe('PUT /orders/:id/allocations/:allocationId/checks', () => {
    /** Set up a reconciling order with allocations, return relevant IDs. */
    async function setupWithAllocations(opts?: { secondMember?: boolean }) {
      const ctx = await setupReconcilingOrder(opts);
      await authFetch(
        `/orders/${ctx.orderId}/items/${ctx.itemId}/delivery`,
        ctx.organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'arrived' }),
        },
      );
      await authFetch(`/orders/${ctx.orderId}/allocate`, ctx.organiser.id, 'organiser@test.local', {
        method: 'POST',
      });

      const reconRes = await authFetch(
        `/orders/${ctx.orderId}/reconciliation`,
        ctx.organiser.id,
        'organiser@test.local',
      );
      const reconBody = (await reconRes.json()) as {
        items: Array<{
          allocations: Array<{
            id: string;
            memberId: string;
            confirmed: boolean;
            splitConfirmed: boolean;
          }>;
        }>;
      };
      return { ...ctx, allocations: reconBody.items[0].allocations };
    }

    it('toggles split flag, callable by any order member', async () => {
      const {
        member,
        orderId,
        allocations: allocs,
      } = await setupWithAllocations({ secondMember: true });
      // The organiser owns the allocation; the other member toggles split.
      const ownerAlloc = allocs.find((a) => a.memberId !== member!.id)!;

      const onRes = await authFetch(
        `/orders/${orderId}/allocations/${ownerAlloc.id}/checks`,
        member!.id,
        'member@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: true }),
        },
      );
      expect(onRes.status).toBe(200);
      const onBody = (await onRes.json()) as { splitConfirmed: boolean; confirmed: boolean };
      expect(onBody.splitConfirmed).toBe(true);
      expect(onBody.confirmed).toBe(false);

      const offRes = await authFetch(
        `/orders/${orderId}/allocations/${ownerAlloc.id}/checks`,
        member!.id,
        'member@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: false }),
        },
      );
      expect(offRes.status).toBe(200);
      const offBody = (await offRes.json()) as { splitConfirmed: boolean };
      expect(offBody.splitConfirmed).toBe(false);
    });

    it('toggles pickedUp by the allocation owner', async () => {
      const { organiser, orderId, allocations: allocs } = await setupWithAllocations();
      const own = allocs[0];

      const res = await authFetch(
        `/orders/${orderId}/allocations/${own.id}/checks`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pickedUp: true }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { confirmed: boolean };
      expect(body.confirmed).toBe(true);
    });

    it('updates both split and pickedUp in one request', async () => {
      const { organiser, orderId, allocations: allocs } = await setupWithAllocations();
      const own = allocs[0];

      const res = await authFetch(
        `/orders/${orderId}/allocations/${own.id}/checks`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: true, pickedUp: true }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { splitConfirmed: boolean; confirmed: boolean };
      expect(body.splitConfirmed).toBe(true);
      expect(body.confirmed).toBe(true);
    });

    it('rejects an empty body with 400', async () => {
      const { organiser, orderId, allocations: allocs } = await setupWithAllocations();

      const res = await authFetch(
        `/orders/${orderId}/allocations/${allocs[0].id}/checks`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(res.status).toBe(400);
    });

    it('rejects non-boolean values with 400', async () => {
      const { organiser, orderId, allocations: allocs } = await setupWithAllocations();

      const res = await authFetch(
        `/orders/${orderId}/allocations/${allocs[0].id}/checks`,
        organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: 'yes' }),
        },
      );
      expect(res.status).toBe(400);
    });

    it('rejects non-members with 403', async () => {
      const { orderId, allocations: allocs } = await setupWithAllocations();
      const intruder = await seedMember('eve@test.local', 'Eve', 'EV');

      const res = await authFetch(
        `/orders/${orderId}/allocations/${allocs[0].id}/checks`,
        intruder.id,
        'eve@test.local',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: true }),
        },
      );
      expect(res.status).toBe(403);
    });
  });

  describe('Claim edits after the invoice', () => {
    type Alloc = {
      id: string;
      memberId: string;
      amount: number;
      confirmed: boolean;
      splitConfirmed: boolean;
    };
    const json = { 'Content-Type': 'application/json' };

    /**
     * Two members each claim 500g; the invoice delivers `delivery`, and
     * allocations are generated.
     */
    async function setupDelivered(delivery: { status: string; actualQuantity?: number }) {
      const ctx = await setupReconcilingOrder({ secondMember: true });
      await authFetch(
        `/orders/${ctx.orderId}/items/${ctx.itemId}/delivery`,
        ctx.organiser.id,
        'organiser@test.local',
        { method: 'PUT', headers: json, body: JSON.stringify(delivery) },
      );
      await authFetch(`/orders/${ctx.orderId}/allocate`, ctx.organiser.id, 'organiser@test.local', {
        method: 'POST',
      });
      return { ...ctx, member: ctx.member! };
    }

    async function allocationsFor(orderId: string, organiserId: string): Promise<Alloc[]> {
      const res = await authFetch(
        `/orders/${orderId}/reconciliation`,
        organiserId,
        'organiser@test.local',
      );
      const body = (await res.json()) as { items: Array<{ allocations: Alloc[] }> };
      return body.items[0].allocations;
    }

    function memberClaim(
      ctx: { orderId: string; itemId: string; member: { id: string } },
      method: 'PUT' | 'DELETE',
      amount?: number,
    ) {
      return authFetch(
        `/orders/${ctx.orderId}/items/${ctx.itemId}/claims`,
        ctx.member.id,
        'member@test.local',
        method === 'PUT' ? { method, headers: json, body: JSON.stringify({ amount }) } : { method },
      );
    }

    it('blocks members from editing claims on lines that arrived in full', async () => {
      const ctx = await setupDelivered({ status: 'arrived' });
      const res = await memberClaim(ctx, 'PUT', 250);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/came up short/);
    });

    it('lets a member give up their share of a short line and regenerates allocations', async () => {
      const ctx = await setupDelivered({ status: 'partial', actualQuantity: 500 });

      // Pro-rata starting point: 500g delivered across 1000g claimed
      const before = await allocationsFor(ctx.orderId, ctx.organiser.id);
      expect(before.map((a) => a.amount).sort()).toEqual([250, 250]);

      const res = await memberClaim(ctx, 'DELETE');
      expect(res.status).toBe(200);

      const after = await allocationsFor(ctx.orderId, ctx.organiser.id);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ memberId: ctx.organiser.id, amount: 500 });
    });

    it('lets a member take up a share someone gave up, within what was delivered', async () => {
      const ctx = await setupDelivered({ status: 'partial', actualQuantity: 750 });

      // 500 + 750 = 1250g > 750g delivered, and the total would grow
      const tooMuch = await memberClaim(ctx, 'PUT', 750);
      expect(tooMuch.status).toBe(400);
      const body = (await tooMuch.json()) as { error: string };
      expect(body.error).toMatch(/can't go above what was delivered/);

      // Organiser steps back to 0.25 of their claim (125g), leaving room
      await authFetch(
        `/orders/${ctx.orderId}/items/${ctx.itemId}/claims`,
        ctx.organiser.id,
        'organiser@test.local',
        { method: 'PUT', headers: json, body: JSON.stringify({ amount: 125 }) },
      );

      const ok = await memberClaim(ctx, 'PUT', 625);
      expect(ok.status).toBe(200);

      const allocs = await allocationsFor(ctx.orderId, ctx.organiser.id);
      const byMember = Object.fromEntries(allocs.map((a) => [a.memberId, a.amount]));
      expect(byMember).toEqual({ [ctx.organiser.id]: 125, [ctx.member.id]: 625 });
    });

    it('blocks member edits once the item has been split', async () => {
      const ctx = await setupDelivered({ status: 'partial', actualQuantity: 500 });
      const [alloc] = await allocationsFor(ctx.orderId, ctx.organiser.id);
      await authFetch(
        `/orders/${ctx.orderId}/allocations/${alloc.id}/checks`,
        ctx.organiser.id,
        'organiser@test.local',
        { method: 'PUT', headers: json, body: JSON.stringify({ split: true }) },
      );

      const res = await memberClaim(ctx, 'PUT', 250);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/already been split or collected/);
    });

    it('keeps distribution flags on allocations whose amount did not change', async () => {
      const ctx = await setupDelivered({ status: 'arrived' });
      const before = await allocationsFor(ctx.orderId, ctx.organiser.id);
      const own = before.find((a) => a.memberId === ctx.organiser.id)!;
      await authFetch(
        `/orders/${ctx.orderId}/allocations/${own.id}/checks`,
        ctx.organiser.id,
        'organiser@test.local',
        { method: 'PUT', headers: json, body: JSON.stringify({ pickedUp: true }) },
      );

      // Organiser changes the other member's claim
      await authFetch(
        `/orders/${ctx.orderId}/items/${ctx.itemId}/claims`,
        ctx.organiser.id,
        'organiser@test.local',
        {
          method: 'PUT',
          headers: json,
          body: JSON.stringify({ amount: 1000, memberId: ctx.member.id }),
        },
      );

      const after = await allocationsFor(ctx.orderId, ctx.organiser.id);
      expect(after.find((a) => a.memberId === ctx.organiser.id)).toMatchObject({
        amount: 500,
        confirmed: true,
      });
      expect(after.find((a) => a.memberId === ctx.member.id)).toMatchObject({ amount: 1000 });
    });
  });
});

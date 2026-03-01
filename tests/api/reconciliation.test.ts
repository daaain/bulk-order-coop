import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
	setupMiniflare,
	teardownMiniflare,
	resetDatabase,
	authFetch,
	seedMember,
	seedCatalogue
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
	const { catalogueId } = await seedCatalogue();

	// Create order
	const createRes = await authFetch('/orders', organiser.id, 'organiser@test.local', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: 'Recon Order', catalogueId })
	});
	const order = await createRes.json() as { id: string; inviteCode: string };

	// Add item (product code 1001: casePrice 15.55, 6 units, 500g, vatRate 0)
	const addItemRes = await authFetch(
		`/orders/${order.id}/items`,
		organiser.id,
		'organiser@test.local',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ productCode: '1001' })
		}
	);
	const item = await addItemRes.json() as { id: string };

	// Create claim (organiser claims 500g)
	await authFetch(
		`/orders/${order.id}/items/${item.id}/claims`,
		organiser.id,
		'organiser@test.local',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ amount: 500 })
		}
	);

	// Optionally add a second member who joins and claims
	let member: { id: string; jwt: string } | undefined;
	if (opts?.secondMember) {
		member = await seedMember('member@test.local', 'Member', 'MEM');
		// Join order
		await authFetch(`/orders/${order.id}/join`, member.id, 'member@test.local', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ inviteCode: order.inviteCode })
		});
		// Claim 500g
		await authFetch(
			`/orders/${order.id}/items/${item.id}/claims`,
			member.id,
			'member@test.local',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount: 500 })
			}
		);
	}

	// Close order: open → closed
	await authFetch(`/orders/${order.id}`, organiser.id, 'organiser@test.local', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: 'closed' })
	});

	// Move to reconciling: closed → reconciling
	await authFetch(`/orders/${order.id}`, organiser.id, 'organiser@test.local', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: 'reconciling' })
	});

	return { organiser, member, catalogueId, orderId: order.id, itemId: item.id };
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
					body: JSON.stringify({ status: 'arrived' })
				}
			);

			expect(res.status).toBe(200);
			const body = await res.json() as { delivery: { orderItemId: string; status: string } };
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
					body: JSON.stringify({ status: 'arrived' })
				}
			);

			// Update to different status
			const res = await authFetch(
				`/orders/${orderId}/items/${itemId}/delivery`,
				organiser.id,
				'organiser@test.local',
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status: 'partial', actualQuantity: 3 })
				}
			);

			expect(res.status).toBe(200);
			const body = await res.json() as { delivery: { status: string; actualQuantity: number } };
			expect(body.delivery.status).toBe('partial');
			expect(body.delivery.actualQuantity).toBe(3);
		});

		it('rejects when order is not reconciling', async () => {
			const organiser = await seedMember('organiser@test.local', 'Organiser', 'ORG');
			const { catalogueId } = await seedCatalogue();

			// Create order (stays open)
			const createRes = await authFetch('/orders', organiser.id, 'organiser@test.local', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Open Order', catalogueId })
			});
			const order = await createRes.json() as { id: string };

			// Add item
			const addItemRes = await authFetch(
				`/orders/${order.id}/items`,
				organiser.id,
				'organiser@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ productCode: '1001' })
				}
			);
			const item = await addItemRes.json() as { id: string };

			const res = await authFetch(
				`/orders/${order.id}/items/${item.id}/delivery`,
				organiser.id,
				'organiser@test.local',
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ status: 'arrived' })
				}
			);

			expect(res.status).toBe(400);
			const body = await res.json() as { error: string };
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
					body: JSON.stringify({ status: 'arrived' })
				}
			);

			const res = await authFetch(
				`/orders/${orderId}/reconciliation`,
				organiser.id,
				'organiser@test.local'
			);

			expect(res.status).toBe(200);
			const body = await res.json() as {
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

		it('rejects when order is open', async () => {
			const organiser = await seedMember('organiser@test.local', 'Organiser', 'ORG');
			const { catalogueId } = await seedCatalogue();

			const createRes = await authFetch('/orders', organiser.id, 'organiser@test.local', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: 'Open Order', catalogueId })
			});
			const order = await createRes.json() as { id: string };

			const res = await authFetch(
				`/orders/${order.id}/reconciliation`,
				organiser.id,
				'organiser@test.local'
			);

			expect(res.status).toBe(400);
			const body = await res.json() as { error: string };
			expect(body.error).toMatch(/reconciling or complete/);
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
					body: JSON.stringify({ status: 'arrived' })
				}
			);

			const res = await authFetch(
				`/orders/${orderId}/allocate`,
				organiser.id,
				'organiser@test.local',
				{ method: 'POST' }
			);

			expect(res.status).toBe(200);
			const body = await res.json() as { count: number };
			expect(body.count).toBeGreaterThan(0);
		});

		it('rejects when delivery status is missing', async () => {
			const { organiser, orderId } = await setupReconcilingOrder();

			// Do NOT set delivery status
			const res = await authFetch(
				`/orders/${orderId}/allocate`,
				organiser.id,
				'organiser@test.local',
				{ method: 'POST' }
			);

			expect(res.status).toBe(400);
			const body = await res.json() as { error: string };
			expect(body.error).toMatch(/missing delivery status/i);
		});

		it('rejects non-organiser', async () => {
			const { orderId, itemId, member } = await setupReconcilingOrder({
				secondMember: true
			});

			// Set delivery status as organiser would have — but we only need it if we're
			// testing the allocate endpoint past the delivery check. Here we're testing
			// the 403 which fires before the delivery check.
			const res = await authFetch(
				`/orders/${orderId}/allocate`,
				member!.id,
				'member@test.local',
				{ method: 'POST' }
			);

			expect(res.status).toBe(403);
			const body = await res.json() as { error: string };
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
					body: JSON.stringify({ status: 'arrived' })
				}
			);
			await authFetch(`/orders/${orderId}/allocate`, organiser.id, 'organiser@test.local', {
				method: 'POST'
			});

			// Get reconciliation to find allocation ID
			const reconRes = await authFetch(
				`/orders/${orderId}/reconciliation`,
				organiser.id,
				'organiser@test.local'
			);
			const reconBody = await reconRes.json() as {
				items: Array<{
					allocations: Array<{ id: string; memberId: string; confirmed: boolean }>;
				}>;
			};
			const allocation = reconBody.items[0].allocations.find(
				(a) => a.memberId === organiser.id
			);
			expect(allocation).toBeDefined();

			const res = await authFetch(
				`/orders/${orderId}/allocations/${allocation!.id}/confirm`,
				organiser.id,
				'organiser@test.local',
				{ method: 'PUT' }
			);

			expect(res.status).toBe(200);
			const body = await res.json() as { confirmed: boolean };
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
					body: JSON.stringify({ status: 'arrived' })
				}
			);
			await authFetch(`/orders/${orderId}/allocate`, organiser.id, 'organiser@test.local', {
				method: 'POST'
			});

			const res = await authFetch(
				`/orders/${orderId}/confirm-all`,
				organiser.id,
				'organiser@test.local',
				{ method: 'PUT' }
			);

			expect(res.status).toBe(200);
			const body = await res.json() as { count: number };
			expect(body.count).toBeGreaterThan(0);

			// Verify via reconciliation that allConfirmed is now true
			const reconRes = await authFetch(
				`/orders/${orderId}/reconciliation`,
				organiser.id,
				'organiser@test.local'
			);
			const reconBody = await reconRes.json() as { allConfirmed: boolean };
			expect(reconBody.allConfirmed).toBe(true);
		});
	});
});

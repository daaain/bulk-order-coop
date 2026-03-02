import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
	setupMiniflare,
	teardownMiniflare,
	resetDatabase,
	authFetch,
	seedMember,
	seedCatalogue,
	seedOrderItem
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
			body: JSON.stringify({ name: 'Test Order', catalogueKey })
		});
		const order = (await orderRes.json()) as { id: string };

		const { id: itemId } = await seedOrderItem(order.id, member.id, 'alice@test.local', productCode);

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

			const res = await authFetch(
				claimsPath(orderId, itemId),
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: 500 })
				}
			);

			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				claim: { id: string; amount: number; orderItemId: string; memberId: string };
				rounding: { totalClaimed: number; caseSize: number; casesNeeded: number; gap: number; status: string };
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
				body: JSON.stringify({ amount: 500 })
			});

			const res = await authFetch(
				claimsPath(orderId, itemId),
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: 250 })
				}
			);

			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/already/i);
		});

		it('rejects a claim when the order is not open', async () => {
			const { member, orderId, itemId } = await seedOrderWithItem();

			// Close the order
			await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'closed' })
			});

			const res = await authFetch(
				claimsPath(orderId, itemId),
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: 500 })
				}
			);

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
				body: JSON.stringify({ amount: 500 })
			});

			// Update to a larger amount
			const res = await authFetch(
				claimsPath(orderId, itemId),
				member.id,
				'alice@test.local',
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: 1000 })
				}
			);

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
				body: JSON.stringify({ amount: 500 })
			});

			// Delete it
			const res = await authFetch(
				claimsPath(orderId, itemId),
				member.id,
				'alice@test.local',
				{ method: 'DELETE' }
			);

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
	// GET /orders/:id/claims/mine
	// ----------------------------------------------------------------
	describe('GET /orders/:id/claims/mine', () => {
		it('returns claims with cost totals', async () => {
			const { member, orderId, itemId } = await seedOrderWithItem();

			// Create a claim
			await authFetch(claimsPath(orderId, itemId), member.id, 'alice@test.local', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ amount: 500 })
			});

			const res = await authFetch(
				`/orders/${orderId}/claims/mine`,
				member.id,
				'alice@test.local'
			);

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

			const res = await authFetch(
				`/orders/${orderId}/claims/mine`,
				member.id,
				'alice@test.local'
			);

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

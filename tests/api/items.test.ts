import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
	setupMiniflare,
	teardownMiniflare,
	resetDatabase,
	authFetch,
	seedMember,
	seedCatalogue,
	seedOrderItem,
	TEST_ITEMS
} from './helpers';

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
			body: JSON.stringify({ name: 'Test Order', catalogueKey })
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

			const res = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(TEST_ITEMS['1001'])
				}
			);

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

			const res = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(TEST_ITEMS['1001'])
				}
			);

			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/already/i);
		});

		it('rejects missing description with 400', async () => {
			const { member, orderId } = await seedOrder();

			const res = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ productCode: '1001', casePrice: 10, vatRate: 0, packSize: 500, unit: 'g' })
				}
			);

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
				body: JSON.stringify({ status: 'closed' })
			});

			const res = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(TEST_ITEMS['1001'])
				}
			);

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

			const res = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local'
			);

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
				{ method: 'DELETE' }
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { success: boolean };
			expect(body.success).toBe(true);

			// Verify the item is gone
			const listRes = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local'
			);
			const items = (await listRes.json()) as unknown[];
			expect(items).toHaveLength(0);
		});

		it('rejects deletion when item has claims', async () => {
			const { member, orderId } = await seedOrder();
			const { id: itemId } = await seedOrderItem(orderId, member.id, 'alice@test.local', '1001');

			// Add a claim on this item
			await authFetch(
				`/orders/${orderId}/items/${itemId}/claims`,
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: 500 })
				}
			);

			const res = await authFetch(
				`/orders/${orderId}/items/${itemId}`,
				member.id,
				'alice@test.local',
				{ method: 'DELETE' }
			);

			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/claims/i);
		});
	});
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
	setupMiniflare,
	teardownMiniflare,
	resetDatabase,
	authFetch,
	seedMember,
	seedCatalogue
} from './helpers';

describe('Item routes', () => {
	beforeAll(setupMiniflare);
	afterAll(teardownMiniflare);
	beforeEach(resetDatabase);

	/** Seed a member + catalogue + open order, return all IDs. */
	async function seedOrder() {
		const member = await seedMember('alice@test.local', 'Alice', 'AL');
		const { catalogueId } = await seedCatalogue();

		const res = await authFetch('/orders', member.id, 'alice@test.local', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: 'Test Order', catalogueId })
		});

		const order = (await res.json()) as { id: string; catalogueId: string };
		return { member, catalogueId, orderId: order.id };
	}

	/** Add an item to an order and return the response + parsed body. */
	async function addItem(
		orderId: string,
		memberId: string,
		email: string,
		productCode: string
	) {
		const res = await authFetch(
			`/orders/${orderId}/items`,
			memberId,
			email,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ productCode })
			}
		);
		const body = (await res.json()) as Record<string, unknown>;
		return { status: res.status, body };
	}

	// ----------------------------------------------------------------
	// POST /orders/:id/items
	// ----------------------------------------------------------------
	describe('POST /orders/:id/items', () => {
		it('adds an item to an open order', async () => {
			const { member, orderId } = await seedOrder();

			const { status, body } = await addItem(orderId, member.id, 'alice@test.local', '1001');

			expect(status).toBe(201);
			expect(body.id).toBeDefined();
			expect(body.orderId).toBe(orderId);
			expect(body.productCode).toBe('1001');
			expect(body.addedBy).toBe(member.id);
		});

		it('rejects a duplicate product code with 409', async () => {
			const { member, orderId } = await seedOrder();

			await addItem(orderId, member.id, 'alice@test.local', '1001');
			const { status, body } = await addItem(orderId, member.id, 'alice@test.local', '1001');

			expect(status).toBe(409);
			expect(body.error).toMatch(/already/i);
		});

		it('rejects a non-existent product code with 404', async () => {
			const { member, orderId } = await seedOrder();

			const { status, body } = await addItem(orderId, member.id, 'alice@test.local', '9999');

			expect(status).toBe(404);
			expect(body.error).toMatch(/not found/i);
		});

		it('rejects adding to a closed order with 400', async () => {
			const { member, orderId } = await seedOrder();

			// Close the order
			await authFetch(`/orders/${orderId}`, member.id, 'alice@test.local', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'closed' })
			});

			const { status, body } = await addItem(orderId, member.id, 'alice@test.local', '1001');

			expect(status).toBe(400);
			expect(body.error).toMatch(/not open/i);
		});
	});

	// ----------------------------------------------------------------
	// GET /orders/:id/items
	// ----------------------------------------------------------------
	describe('GET /orders/:id/items', () => {
		it('returns items with catalogue data and rounding info', async () => {
			const { member, orderId } = await seedOrder();
			expect((await addItem(orderId, member.id, 'alice@test.local', '1001')).status).toBe(201);
			expect((await addItem(orderId, member.id, 'alice@test.local', '1002')).status).toBe(201);

			const res = await authFetch(
				`/orders/${orderId}/items`,
				member.id,
				'alice@test.local'
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as Array<{
				orderItem: { id: string; productCode: string };
				catalogueItem: { productCode: string; productDescription: string };
				claims: unknown[];
				rounding: { totalClaimed: number; caseSize: number; casesNeeded: number };
			}>;

			expect(body).toHaveLength(2);
			expect(body[0].orderItem).toBeDefined();
			expect(body[0].catalogueItem).toBeDefined();
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
			const { body: item } = await addItem(orderId, member.id, 'alice@test.local', '1001') as { body: { id: string }; status: number };

			const res = await authFetch(
				`/orders/${orderId}/items/${item.id}`,
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
			const { body: item } = await addItem(orderId, member.id, 'alice@test.local', '1001') as { body: { id: string }; status: number };

			// Add a claim on this item
			await authFetch(
				`/orders/${orderId}/items/${item.id}/claims`,
				member.id,
				'alice@test.local',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ amount: 500 })
				}
			);

			const res = await authFetch(
				`/orders/${orderId}/items/${item.id}`,
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

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Bindings } from '../index';
import type { JwtPayload } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import { orders, orderMembers, orderItems, claims, catalogueItems, members } from '../../db/schema';
import { validateAddItem } from '../services/items';
import { calculateRounding } from '../../shared/rounding';
import type { ClaimWithMember, EnrichedOrderItem, CatalogueItem } from '../../shared/types';

const app = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JwtPayload; memberId: string } }>();

app.use('/*', requireAuth);

// POST /:id/items — Add item to order
app.post('/:id/items', async (c) => {
	const db = drizzle(c.env.DB);
	const orderId = c.req.param('id');
	const memberId = c.get('memberId');
	const body = await c.req.json();

	// Check membership
	const [membership] = await db
		.select()
		.from(orderMembers)
		.where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, memberId)));

	if (!membership) {
		return c.json({ error: 'You are not a member of this order' }, 403);
	}

	// Check order exists and is open
	const [order] = await db
		.select()
		.from(orders)
		.where(eq(orders.id, orderId));

	if (!order) {
		return c.json({ error: 'Order not found' }, 404);
	}

	if (order.status !== 'open') {
		return c.json({ error: 'Order is not open' }, 400);
	}

	const validated = validateAddItem(body);
	if ('error' in validated) {
		return c.json({ error: validated.error }, 400);
	}

	// Verify product exists in the order's catalogue
	const [catItem] = await db
		.select({ id: catalogueItems.id })
		.from(catalogueItems)
		.where(
			and(
				eq(catalogueItems.catalogueId, order.catalogueId),
				eq(catalogueItems.productCode, validated.productCode)
			)
		);

	if (!catItem) {
		return c.json({ error: 'Product not found in catalogue' }, 404);
	}

	// Check for duplicate
	const [existing] = await db
		.select({ id: orderItems.id })
		.from(orderItems)
		.where(
			and(
				eq(orderItems.orderId, orderId),
				eq(orderItems.productCode, validated.productCode)
			)
		);

	if (existing) {
		return c.json({ error: 'Item already on order' }, 409);
	}

	const id = nanoid();
	const now = Math.floor(Date.now() / 1000);

	const item = {
		id,
		orderId,
		productCode: validated.productCode,
		addedBy: memberId,
		addedAt: now,
		notes: validated.notes ?? null
	};

	await db.insert(orderItems).values(item);

	return c.json(item, 201);
});

// GET /:id/items — List order items with claims and rounding
app.get('/:id/items', async (c) => {
	const db = drizzle(c.env.DB);
	const orderId = c.req.param('id');
	const memberId = c.get('memberId');

	// Check membership
	const [membership] = await db
		.select()
		.from(orderMembers)
		.where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, memberId)));

	if (!membership) {
		return c.json({ error: 'You are not a member of this order' }, 403);
	}

	// Get the order to find catalogueId
	const [order] = await db
		.select({ catalogueId: orders.catalogueId })
		.from(orders)
		.where(eq(orders.id, orderId));

	if (!order) {
		return c.json({ error: 'Order not found' }, 404);
	}

	// 1. Get all order items
	const items = await db
		.select()
		.from(orderItems)
		.where(eq(orderItems.orderId, orderId));

	if (items.length === 0) {
		return c.json([]);
	}

	// 2. Get catalogue items for all product codes
	const productCodes = items.map((i) => i.productCode);
	const catItems = await db
		.select()
		.from(catalogueItems)
		.where(
			and(
				eq(catalogueItems.catalogueId, order.catalogueId),
				inArray(catalogueItems.productCode, productCodes)
			)
		);

	const catMap = new Map(catItems.map((ci) => [ci.productCode, ci]));

	// 3. Get claims with member info for all order items
	const itemIds = items.map((i) => i.id);
	const claimRows = await db
		.select({
			id: claims.id,
			orderItemId: claims.orderItemId,
			memberId: claims.memberId,
			amount: claims.amount,
			flexibility: claims.flexibility,
			createdAt: claims.createdAt,
			updatedAt: claims.updatedAt,
			memberName: members.name,
			memberInitials: members.initials
		})
		.from(claims)
		.innerJoin(members, eq(claims.memberId, members.id))
		.where(inArray(claims.orderItemId, itemIds));

	// Group claims by order item
	const claimsByItem = new Map<string, ClaimWithMember[]>();
	for (const row of claimRows) {
		const list = claimsByItem.get(row.orderItemId) ?? [];
		list.push(row);
		claimsByItem.set(row.orderItemId, list);
	}

	// Assemble enriched items
	const result: EnrichedOrderItem[] = items.map((item) => {
		const ci = catMap.get(item.productCode);
		const itemClaims = claimsByItem.get(item.id) ?? [];
		const rounding = calculateRounding(
			itemClaims,
			ci?.unitsPerCase ?? null,
			ci?.packSize ?? 1
		);

		return {
			orderItem: item,
			catalogueItem: {
				...ci!,
				organic: Boolean(ci?.organic),
				active: Boolean(ci?.active)
			} as CatalogueItem,
			claims: itemClaims,
			rounding
		};
	});

	return c.json(result);
});

// DELETE /:id/items/:itemId — Remove item from order
app.delete('/:id/items/:itemId', async (c) => {
	const db = drizzle(c.env.DB);
	const orderId = c.req.param('id');
	const itemId = c.req.param('itemId');
	const memberId = c.get('memberId');

	// Check membership
	const [membership] = await db
		.select()
		.from(orderMembers)
		.where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, memberId)));

	if (!membership) {
		return c.json({ error: 'You are not a member of this order' }, 403);
	}

	// Check order is open
	const [order] = await db
		.select({ status: orders.status })
		.from(orders)
		.where(eq(orders.id, orderId));

	if (!order) {
		return c.json({ error: 'Order not found' }, 404);
	}

	if (order.status !== 'open') {
		return c.json({ error: 'Order is not open' }, 400);
	}

	// Check item exists and belongs to this order
	const [item] = await db
		.select()
		.from(orderItems)
		.where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));

	if (!item) {
		return c.json({ error: 'Item not found' }, 404);
	}

	// Check no claims exist
	const [existingClaim] = await db
		.select({ id: claims.id })
		.from(claims)
		.where(eq(claims.orderItemId, itemId));

	if (existingClaim) {
		return c.json({ error: 'Cannot remove item with existing claims' }, 400);
	}

	await db.delete(orderItems).where(eq(orderItems.id, itemId));

	return c.json({ success: true });
});

export default app;

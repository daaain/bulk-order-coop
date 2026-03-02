import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Bindings } from '../index';
import type { JwtPayload } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import { orders, orderMembers, orderItems, claims, members } from '../../db/schema';
import { validateAddItem } from '../services/items';
import { calculateRounding } from '../../shared/rounding';
import type { ClaimWithMember, EnrichedOrderItem, CatalogueItem } from '../../shared/types';

/** Construct a CatalogueItem from an order_items row */
function catalogueItemFromOrderItem(item: typeof orderItems.$inferSelect): CatalogueItem {
	return {
		productCode: item.productCode,
		description: item.description,
		brand: item.brand,
		organic: Boolean(item.organic),
		casePrice: item.casePrice,
		vatRate: item.vatRate,
		vatPerCase: item.vatPerCase,
		unitsPerCase: item.unitsPerCase,
		packSize: item.packSize,
		unit: item.unit,
		rrp: item.rrp,
		barcode: item.barcode,
		active: true
	};
}

const app = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JwtPayload; memberId: string } }>();

app.use('/*', requireAuth);

// POST /:id/items — Add item to order (with full product snapshot)
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
		description: validated.description,
		brand: validated.brand,
		organic: validated.organic ? 1 : 0,
		casePrice: validated.casePrice,
		vatRate: validated.vatRate,
		vatPerCase: validated.vatPerCase,
		unitsPerCase: validated.unitsPerCase,
		packSize: validated.packSize,
		unit: validated.unit,
		rrp: validated.rrp,
		barcode: validated.barcode,
		addedBy: memberId,
		addedAt: now,
		notes: validated.notes ?? null
	};

	await db.insert(orderItems).values(item);

	return c.json({
		id,
		orderId,
		productCode: validated.productCode,
		description: validated.description,
		brand: validated.brand,
		organic: validated.organic,
		casePrice: validated.casePrice,
		vatRate: validated.vatRate,
		vatPerCase: validated.vatPerCase,
		unitsPerCase: validated.unitsPerCase,
		packSize: validated.packSize,
		unit: validated.unit,
		rrp: validated.rrp,
		barcode: validated.barcode,
		addedBy: memberId,
		addedAt: now,
		notes: validated.notes ?? null
	}, 201);
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

	// 1. Get all order items (now contain product snapshot)
	const items = await db
		.select()
		.from(orderItems)
		.where(eq(orderItems.orderId, orderId));

	if (items.length === 0) {
		return c.json([]);
	}

	// 2. Get claims with member info for all order items
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
		const ci = catalogueItemFromOrderItem(item);
		const itemClaims = claimsByItem.get(item.id) ?? [];
		const rounding = calculateRounding(
			itemClaims,
			item.unitsPerCase,
			item.packSize
		);

		return {
			orderItem: {
				id: item.id,
				orderId: item.orderId,
				productCode: item.productCode,
				description: item.description,
				brand: item.brand,
				organic: Boolean(item.organic),
				casePrice: item.casePrice,
				vatRate: item.vatRate,
				vatPerCase: item.vatPerCase,
				unitsPerCase: item.unitsPerCase,
				packSize: item.packSize,
				unit: item.unit,
				rrp: item.rrp,
				barcode: item.barcode,
				addedBy: item.addedBy,
				addedAt: item.addedAt,
				notes: item.notes
			},
			catalogueItem: ci,
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

export { catalogueItemFromOrderItem };
export default app;

import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Bindings } from '../index';
import type { JwtPayload } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import { orders, orderMembers, orderItems, claims, catalogueItems } from '../../db/schema';
import { validateClaim } from '../services/items';
import { calculateRounding } from '../../shared/rounding';
import { estimateCost, calculateCaseSize } from '../../shared/costs';
import type { MyClaim } from '../../shared/types';

const app = new Hono<{ Bindings: Bindings; Variables: { jwtPayload: JwtPayload; memberId: string } }>();

app.use('/*', requireAuth);

// POST /:id/items/:itemId/claims — Create claim
app.post('/:id/items/:itemId/claims', async (c) => {
	const db = drizzle(c.env.DB);
	const orderId = c.req.param('id');
	const itemId = c.req.param('itemId');
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

	// Check order is open
	const [order] = await db
		.select({ status: orders.status, catalogueId: orders.catalogueId })
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

	const validated = validateClaim(body);
	if ('error' in validated) {
		return c.json({ error: validated.error }, 400);
	}

	// Check for duplicate claim
	const [existing] = await db
		.select({ id: claims.id })
		.from(claims)
		.where(and(eq(claims.orderItemId, itemId), eq(claims.memberId, memberId)));

	if (existing) {
		return c.json({ error: 'You already have a claim on this item' }, 409);
	}

	const id = nanoid();
	const now = Math.floor(Date.now() / 1000);

	const claim = {
		id,
		orderItemId: itemId,
		memberId,
		amount: validated.amount,
		flexibility: validated.flexibility ?? null,
		createdAt: now,
		updatedAt: now
	};

	await db.insert(claims).values(claim);

	// Fetch all claims for rounding
	const allClaims = await db
		.select({ amount: claims.amount, flexibility: claims.flexibility })
		.from(claims)
		.where(eq(claims.orderItemId, itemId));

	const [catItem] = await db
		.select({ unitsPerCase: catalogueItems.unitsPerCase, packSize: catalogueItems.packSize })
		.from(catalogueItems)
		.where(
			and(
				eq(catalogueItems.catalogueId, order.catalogueId),
				eq(catalogueItems.productCode, item.productCode)
			)
		);

	const rounding = calculateRounding(allClaims, catItem?.unitsPerCase ?? null, catItem?.packSize ?? 1);

	return c.json({ claim, rounding }, 201);
});

// PUT /:id/items/:itemId/claims — Update own claim
app.put('/:id/items/:itemId/claims', async (c) => {
	const db = drizzle(c.env.DB);
	const orderId = c.req.param('id');
	const itemId = c.req.param('itemId');
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

	// Check order is open
	const [order] = await db
		.select({ status: orders.status, catalogueId: orders.catalogueId })
		.from(orders)
		.where(eq(orders.id, orderId));

	if (!order) {
		return c.json({ error: 'Order not found' }, 404);
	}

	if (order.status !== 'open') {
		return c.json({ error: 'Order is not open' }, 400);
	}

	// Check item exists
	const [item] = await db
		.select()
		.from(orderItems)
		.where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));

	if (!item) {
		return c.json({ error: 'Item not found' }, 404);
	}

	const validated = validateClaim(body);
	if ('error' in validated) {
		return c.json({ error: validated.error }, 400);
	}

	// Check claim exists and belongs to this member
	const [existing] = await db
		.select()
		.from(claims)
		.where(and(eq(claims.orderItemId, itemId), eq(claims.memberId, memberId)));

	if (!existing) {
		return c.json({ error: 'Claim not found' }, 404);
	}

	const now = Math.floor(Date.now() / 1000);

	await db.update(claims).set({
		amount: validated.amount,
		flexibility: validated.flexibility ?? null,
		updatedAt: now
	}).where(eq(claims.id, existing.id));

	const updatedClaim = { ...existing, amount: validated.amount, flexibility: validated.flexibility ?? null, updatedAt: now };

	// Fetch all claims for rounding
	const allClaims = await db
		.select({ amount: claims.amount, flexibility: claims.flexibility })
		.from(claims)
		.where(eq(claims.orderItemId, itemId));

	const [catItem] = await db
		.select({ unitsPerCase: catalogueItems.unitsPerCase, packSize: catalogueItems.packSize })
		.from(catalogueItems)
		.where(
			and(
				eq(catalogueItems.catalogueId, order.catalogueId),
				eq(catalogueItems.productCode, item.productCode)
			)
		);

	const rounding = calculateRounding(allClaims, catItem?.unitsPerCase ?? null, catItem?.packSize ?? 1);

	return c.json({ claim: updatedClaim, rounding });
});

// DELETE /:id/items/:itemId/claims — Remove own claim
app.delete('/:id/items/:itemId/claims', async (c) => {
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
		.select({ status: orders.status, catalogueId: orders.catalogueId })
		.from(orders)
		.where(eq(orders.id, orderId));

	if (!order) {
		return c.json({ error: 'Order not found' }, 404);
	}

	if (order.status !== 'open') {
		return c.json({ error: 'Order is not open' }, 400);
	}

	// Check item exists
	const [item] = await db
		.select()
		.from(orderItems)
		.where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));

	if (!item) {
		return c.json({ error: 'Item not found' }, 404);
	}

	// Check claim exists and belongs to this member
	const [existing] = await db
		.select()
		.from(claims)
		.where(and(eq(claims.orderItemId, itemId), eq(claims.memberId, memberId)));

	if (!existing) {
		return c.json({ error: 'Claim not found' }, 404);
	}

	await db.delete(claims).where(eq(claims.id, existing.id));

	// Fetch remaining claims for rounding
	const remainingClaims = await db
		.select({ amount: claims.amount, flexibility: claims.flexibility })
		.from(claims)
		.where(eq(claims.orderItemId, itemId));

	const [catItem] = await db
		.select({ unitsPerCase: catalogueItems.unitsPerCase, packSize: catalogueItems.packSize })
		.from(catalogueItems)
		.where(
			and(
				eq(catalogueItems.catalogueId, order.catalogueId),
				eq(catalogueItems.productCode, item.productCode)
			)
		);

	const rounding = calculateRounding(remainingClaims, catItem?.unitsPerCase ?? null, catItem?.packSize ?? 1);

	return c.json({ rounding });
});

// GET /:id/claims/mine — My claims with cost estimates
app.get('/:id/claims/mine', async (c) => {
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

	// Get the order
	const [order] = await db
		.select({ catalogueId: orders.catalogueId })
		.from(orders)
		.where(eq(orders.id, orderId));

	if (!order) {
		return c.json({ error: 'Order not found' }, 404);
	}

	// Get all order items for this order
	const items = await db
		.select()
		.from(orderItems)
		.where(eq(orderItems.orderId, orderId));

	if (items.length === 0) {
		return c.json({ claims: [], totals: { net: 0, vat: 0, gross: 0 } });
	}

	const itemIds = items.map((i) => i.id);

	// Get this member's claims on those items
	const myClaims = await db
		.select()
		.from(claims)
		.where(and(inArray(claims.orderItemId, itemIds), eq(claims.memberId, memberId)));

	if (myClaims.length === 0) {
		return c.json({ claims: [], totals: { net: 0, vat: 0, gross: 0 } });
	}

	// Get catalogue items for the claimed order items
	const claimedItems = items.filter((i) => myClaims.some((cl) => cl.orderItemId === i.id));
	const productCodes = claimedItems.map((i) => i.productCode);

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
	const itemMap = new Map(items.map((i) => [i.id, i]));

	let totalNet = 0;
	let totalVat = 0;
	let totalGross = 0;

	const result: MyClaim[] = myClaims.map((claim) => {
		const oi = itemMap.get(claim.orderItemId)!;
		const ci = catMap.get(oi.productCode)!;
		const caseSize = calculateCaseSize(ci.unitsPerCase, ci.packSize);
		const cost = estimateCost(claim.amount, caseSize, ci.casePrice, ci.vatRate);

		totalNet += cost.net;
		totalVat += cost.vat;
		totalGross += cost.gross;

		return {
			claim,
			orderItem: oi,
			catalogueItem: {
				...ci,
				organic: Boolean(ci.organic),
				active: Boolean(ci.active)
			},
			estimatedCost: cost
		};
	});

	return c.json({
		claims: result,
		totals: { net: totalNet, vat: totalVat, gross: totalGross }
	});
});

export default app;

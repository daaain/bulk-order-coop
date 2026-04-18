import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Bindings } from '../index';
import type { JwtPayload } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import { orders, orderMembers, orderItems, claims } from '../../db/schema';
import { validateClaim } from '../services/items';
import { calculateRounding } from '../../shared/rounding';
import { estimateCost, calculateCaseSize } from '../../shared/costs';
import type { MyClaim } from '../../shared/types';
import { catalogueItemFromOrderItem } from './items';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

const app = new Hono<{
  Bindings: Bindings;
  Variables: { jwtPayload: JwtPayload; memberId: string };
}>();

app.use('/*', requireAuth);

/**
 * Resolve who the claim operation targets and whether the caller is an organiser.
 * When `bodyMemberId` is provided and differs from the caller, only organisers
 * may proceed and the target must be a member of the order.
 */
async function resolveClaimTarget(
  db: DrizzleD1Database,
  orderId: string,
  callerId: string,
  bodyMemberId?: string,
): Promise<
  | { targetMemberId: string; isOrganiser: boolean }
  | { error: string; status: 403 | 400 }
> {
  const [callerMembership] = await db
    .select({ role: orderMembers.role })
    .from(orderMembers)
    .where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, callerId)));

  if (!callerMembership) {
    return { error: 'You are not a member of this order', status: 403 };
  }

  const isOrganiser = callerMembership.role === 'organiser';

  if (bodyMemberId && bodyMemberId !== callerId) {
    if (!isOrganiser) {
      return { error: "Only organisers can manage other members' claims", status: 403 };
    }

    const [targetMembership] = await db
      .select({ memberId: orderMembers.memberId })
      .from(orderMembers)
      .where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, bodyMemberId)));

    if (!targetMembership) {
      return { error: 'Target member is not a member of this order', status: 400 };
    }

    return { targetMemberId: bodyMemberId, isOrganiser };
  }

  return { targetMemberId: callerId, isOrganiser };
}

/** Check order status and return an error response if the operation is not allowed. */
function checkOrderStatus(
  status: string,
  isOrganiser: boolean,
): { error: string } | null {
  if (!isOrganiser && status !== 'open') {
    return { error: 'Order is not open' };
  }
  if (isOrganiser && status === 'complete') {
    return { error: 'Order is complete' };
  }
  return null;
}

// POST /:id/items/:itemId/claims — Create claim
app.post('/:id/items/:itemId/claims', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const callerId = c.get('memberId');
  const body = await c.req.json();

  // Resolve target member
  const target = await resolveClaimTarget(db, orderId, callerId, body.memberId);
  if ('error' in target) {
    return c.json({ error: target.error }, target.status);
  }

  // Check order status
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const statusError = checkOrderStatus(order.status, target.isOrganiser);
  if (statusError) {
    return c.json(statusError, 400);
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
    .where(and(eq(claims.orderItemId, itemId), eq(claims.memberId, target.targetMemberId)));

  if (existing) {
    return c.json({ error: 'Member already has a claim on this item' }, 409);
  }

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    id,
    orderItemId: itemId,
    memberId: target.targetMemberId,
    amount: validated.amount,
    flexibility: validated.flexibility ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(claims).values(claim);

  // Fetch all claims for rounding
  const allClaims = await db
    .select({ amount: claims.amount, flexibility: claims.flexibility })
    .from(claims)
    .where(eq(claims.orderItemId, itemId));

  const rounding = calculateRounding(allClaims, item.unitsPerCase, item.packSize);

  return c.json({ claim, rounding }, 201);
});

// PUT /:id/items/:itemId/claims — Update claim
app.put('/:id/items/:itemId/claims', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const callerId = c.get('memberId');
  const body = await c.req.json();

  // Resolve target member
  const target = await resolveClaimTarget(db, orderId, callerId, body.memberId);
  if ('error' in target) {
    return c.json({ error: target.error }, target.status);
  }

  // Check order status
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const statusError = checkOrderStatus(order.status, target.isOrganiser);
  if (statusError) {
    return c.json(statusError, 400);
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

  // Check claim exists for the target member
  const [existing] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.orderItemId, itemId), eq(claims.memberId, target.targetMemberId)));

  if (!existing) {
    return c.json({ error: 'Claim not found' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);

  await db
    .update(claims)
    .set({ amount: validated.amount, flexibility: validated.flexibility ?? null, updatedAt: now })
    .where(eq(claims.id, existing.id));

  const updatedClaim = {
    ...existing,
    amount: validated.amount,
    flexibility: validated.flexibility ?? null,
    updatedAt: now,
  };

  // Fetch all claims for rounding
  const allClaims = await db
    .select({ amount: claims.amount, flexibility: claims.flexibility })
    .from(claims)
    .where(eq(claims.orderItemId, itemId));

  const rounding = calculateRounding(allClaims, item.unitsPerCase, item.packSize);

  return c.json({ claim: updatedClaim, rounding });
});

// DELETE /:id/items/:itemId/claims — Remove claim
app.delete('/:id/items/:itemId/claims', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const callerId = c.get('memberId');
  const targetMemberIdParam = c.req.query('memberId');

  // Resolve target member
  const target = await resolveClaimTarget(db, orderId, callerId, targetMemberIdParam);
  if ('error' in target) {
    return c.json({ error: target.error }, target.status);
  }

  // Check order status
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const statusError = checkOrderStatus(order.status, target.isOrganiser);
  if (statusError) {
    return c.json(statusError, 400);
  }

  // Check item exists
  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  // Check claim exists for the target member
  const [existing] = await db
    .select()
    .from(claims)
    .where(and(eq(claims.orderItemId, itemId), eq(claims.memberId, target.targetMemberId)));

  if (!existing) {
    return c.json({ error: 'Claim not found' }, 404);
  }

  await db.delete(claims).where(eq(claims.id, existing.id));

  // Fetch remaining claims for rounding
  const remainingClaims = await db
    .select({ amount: claims.amount, flexibility: claims.flexibility })
    .from(claims)
    .where(eq(claims.orderItemId, itemId));

  const rounding = calculateRounding(remainingClaims, item.unitsPerCase, item.packSize);

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

  // Get all order items for this order
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

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

  const itemMap = new Map(items.map((i) => [i.id, i]));

  let totalNet = 0;
  let totalVat = 0;
  let totalGross = 0;

  const result: MyClaim[] = myClaims.map((claim) => {
    const oi = itemMap.get(claim.orderItemId)!;
    const ci = catalogueItemFromOrderItem(oi);
    const caseSize = calculateCaseSize(oi.unitsPerCase, oi.packSize);
    const cost = estimateCost(claim.amount, caseSize, oi.casePrice, oi.vatRate);

    totalNet += cost.net;
    totalVat += cost.vat;
    totalGross += cost.gross;

    return {
      claim,
      orderItem: {
        id: oi.id,
        orderId: oi.orderId,
        productCode: oi.productCode,
        description: oi.description,
        brand: oi.brand,
        organic: Boolean(oi.organic),
        casePrice: oi.casePrice,
        vatRate: oi.vatRate,
        vatPerCase: oi.vatPerCase,
        unitsPerCase: oi.unitsPerCase,
        packSize: oi.packSize,
        unit: oi.unit,
        rrp: oi.rrp,
        barcode: oi.barcode,
        addedBy: oi.addedBy,
        addedAt: oi.addedAt,
        notes: oi.notes,
      },
      catalogueItem: ci,
      estimatedCost: cost,
    };
  });

  return c.json({ claims: result, totals: { net: totalNet, vat: totalVat, gross: totalGross } });
});

export default app;

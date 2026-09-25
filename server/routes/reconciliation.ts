import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import type { Bindings } from '../index';
import type { JwtPayload } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import {
  orders,
  orderMembers,
  orderItems,
  claims,
  members,
  deliveryItems,
  allocations,
} from '../../db/schema';
import { validateDeliveryUpdate } from '../services/reconciliation';
import { calculateRounding } from '../../shared/rounding';
import { calculateCaseSize, estimateCost, applyDiscount } from '../../shared/costs';
import type {
  ClaimWithMember,
  AllocationWithMember,
  ReconciliationItem,
  MemberCostSummary,
  ReconciliationSummary,
  OrderDiscountSummary,
} from '../../shared/types';
import { DEFAULT_ADMIN_FEE_PERCENTAGE } from '../../shared/types';
import { catalogueItemFromOrderItem } from './items';
import { orderHasAllocations, recalculateAllocations } from '../services/allocations';

const app = new Hono<{
  Bindings: Bindings;
  Variables: { jwtPayload: JwtPayload; memberId: string };
}>();

app.use('/*', requireAuth);

// PUT /:id/items/:itemId/delivery — Upsert delivery status
app.put('/:id/items/:itemId/delivery', async (c) => {
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

  // Delivery status drives allocations (and which lines members may rebalance),
  // so only organisers record it.
  if (membership.role !== 'organiser') {
    return c.json({ error: 'Only organisers can update delivery status' }, 403);
  }

  // Check order is reconciling
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  if (order.status !== 'reconciling') {
    return c.json({ error: 'Order must be in reconciling status' }, 400);
  }

  // Check item exists and belongs to this order
  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)));

  if (!item) {
    return c.json({ error: 'Item not found' }, 404);
  }

  const validated = validateDeliveryUpdate(body);
  if ('error' in validated) {
    return c.json({ error: validated.error }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  // Upsert: check if delivery record exists
  const [existing] = await db
    .select()
    .from(deliveryItems)
    .where(eq(deliveryItems.orderItemId, itemId));

  if (existing) {
    await db
      .update(deliveryItems)
      .set({
        status: validated.status,
        actualPrice: validated.actualPrice ?? null,
        actualQuantity: validated.actualQuantity ?? null,
        notes: validated.notes ?? null,
        updatedBy: memberId,
        updatedAt: now,
      })
      .where(eq(deliveryItems.orderItemId, itemId));
  } else {
    await db
      .insert(deliveryItems)
      .values({
        orderItemId: itemId,
        status: validated.status,
        actualPrice: validated.actualPrice ?? null,
        actualQuantity: validated.actualQuantity ?? null,
        notes: validated.notes ?? null,
        updatedBy: memberId,
        updatedAt: now,
      });
  }

  // Keep members' shares in sync once allocations have been generated.
  if (await orderHasAllocations(db, orderId)) {
    await recalculateAllocations(db, orderId, [itemId]);
  }

  const [delivery] = await db
    .select()
    .from(deliveryItems)
    .where(eq(deliveryItems.orderItemId, itemId));

  return c.json({ delivery });
});

// GET /:id/reconciliation — Full reconciliation data
app.get('/:id/reconciliation', async (c) => {
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

  const [order] = await db
    .select({
      status: orders.status,
      discountPercentage: orders.discountPercentage,
      adminFeePercentage: orders.adminFeePercentage,
    })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const discountPct = order.discountPercentage ?? 0;
  const adminPct = order.adminFeePercentage ?? DEFAULT_ADMIN_FEE_PERCENTAGE;
  const memberDiscountPct = Math.max(0, discountPct - adminPct);

  // 1. Get all order items (with product snapshots)
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  if (items.length === 0) {
    return c.json({
      items: [],
      memberSummaries: [],
      orderTotals: { net: 0, vat: 0, gross: 0 },
      allConfirmed: true,
      discount: null,
    } satisfies ReconciliationSummary);
  }

  const itemIds = items.map((i) => i.id);

  // 2. Get claims with member info
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
      memberInitials: members.initials,
    })
    .from(claims)
    .innerJoin(members, eq(claims.memberId, members.id))
    .where(inArray(claims.orderItemId, itemIds));

  const claimsByItem = new Map<string, ClaimWithMember[]>();
  for (const row of claimRows) {
    const list = claimsByItem.get(row.orderItemId) ?? [];
    list.push(row);
    claimsByItem.set(row.orderItemId, list);
  }

  // 3. Get delivery items
  const deliveries = await db
    .select()
    .from(deliveryItems)
    .where(inArray(deliveryItems.orderItemId, itemIds));
  const deliveryMap = new Map(deliveries.map((d) => [d.orderItemId, d]));

  // 4. Get allocations with member info
  const allocationRows = await db
    .select({
      id: allocations.id,
      orderItemId: allocations.orderItemId,
      memberId: allocations.memberId,
      amount: allocations.amount,
      price: allocations.price,
      confirmed: allocations.confirmed,
      splitConfirmed: allocations.splitConfirmed,
      memberName: members.name,
      memberInitials: members.initials,
    })
    .from(allocations)
    .innerJoin(members, eq(allocations.memberId, members.id))
    .where(inArray(allocations.orderItemId, itemIds));

  const allocationsByItem = new Map<string, AllocationWithMember[]>();
  for (const row of allocationRows) {
    const list = allocationsByItem.get(row.orderItemId) ?? [];
    list.push({
      ...row,
      confirmed: Boolean(row.confirmed),
      splitConfirmed: Boolean(row.splitConfirmed),
    });
    allocationsByItem.set(row.orderItemId, list);
  }

  // 5. Assemble ReconciliationItems
  const reconItems: ReconciliationItem[] = items.map((item) => {
    const ci = catalogueItemFromOrderItem(item);
    const itemClaims = claimsByItem.get(item.id) ?? [];
    const rounding = calculateRounding(itemClaims, item.unitsPerCase, item.packSize);
    const delivery = deliveryMap.get(item.id) ?? null;
    const itemAllocations = allocationsByItem.get(item.id) ?? [];

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
        notes: item.notes,
      },
      catalogueItem: ci,
      claims: itemClaims,
      rounding,
      delivery: delivery
        ? {
            orderItemId: delivery.orderItemId,
            status: delivery.status as 'arrived' | 'missing' | 'partial' | 'different_price',
            actualPrice: delivery.actualPrice,
            actualQuantity: delivery.actualQuantity,
            notes: delivery.notes,
          }
        : null,
      allocations: itemAllocations,
    };
  });

  // 6. Compute member summaries
  const memberTotals = new Map<string, MemberCostSummary>();

  for (const reconItem of reconItems) {
    const ci = reconItem.catalogueItem;
    const caseSize = calculateCaseSize(ci.unitsPerCase, ci.packSize);

    for (const alloc of reconItem.allocations) {
      let summary = memberTotals.get(alloc.memberId);
      if (!summary) {
        summary = {
          memberId: alloc.memberId,
          memberName: alloc.memberName,
          memberInitials: alloc.memberInitials,
          items: [],
          totals: { net: 0, vat: 0, gross: 0 },
          allConfirmed: true,
          allSplit: true,
        };
        memberTotals.set(alloc.memberId, summary);
      }

      const rawCost = estimateCost(
        alloc.amount,
        caseSize,
        reconItem.delivery?.status === 'different_price' && reconItem.delivery.actualPrice
          ? reconItem.delivery.actualPrice
          : ci.casePrice,
        ci.vatRate,
      );
      const cost = applyDiscount(rawCost, memberDiscountPct);
      const net = Math.round(cost.net * 100) / 100;
      const vat = Math.round(cost.vat * 100) / 100;
      const gross = Math.round(cost.gross * 100) / 100;

      // Find claimed amount for this member
      const memberClaim = reconItem.claims.find((cl) => cl.memberId === alloc.memberId);

      summary.items.push({
        orderItemId: reconItem.orderItem.id,
        description: ci.description,
        claimed: memberClaim?.amount ?? 0,
        allocated: alloc.amount,
        net,
        vat,
        gross,
        confirmed: alloc.confirmed,
        splitConfirmed: alloc.splitConfirmed,
      });

      summary.totals.net += net;
      summary.totals.vat += vat;
      summary.totals.gross += gross;

      if (!alloc.confirmed) {
        summary.allConfirmed = false;
      }
      if (!alloc.splitConfirmed) {
        summary.allSplit = false;
      }
    }
  }

  // Round member totals
  for (const summary of memberTotals.values()) {
    summary.totals.net = Math.round(summary.totals.net * 100) / 100;
    summary.totals.vat = Math.round(summary.totals.vat * 100) / 100;
    summary.totals.gross = Math.round(summary.totals.gross * 100) / 100;
  }

  const memberSummaries = Array.from(memberTotals.values());

  const orderTotals = {
    net: Math.round(memberSummaries.reduce((s, m) => s + m.totals.net, 0) * 100) / 100,
    vat: Math.round(memberSummaries.reduce((s, m) => s + m.totals.vat, 0) * 100) / 100,
    gross: Math.round(memberSummaries.reduce((s, m) => s + m.totals.gross, 0) * 100) / 100,
  };

  const allConfirmed = memberSummaries.length > 0 && memberSummaries.every((m) => m.allConfirmed);

  // Derive the pre-discount subtotal from the sum of member nets: members
  // already see the post-discount net, so dividing by (1 - memberPct/100)
  // recovers the pre-discount amount. This keeps the totals row aligned with
  // the allocation lines rather than with invoice-wide VAT rounding.
  let discount: OrderDiscountSummary | null = null;
  if (order.discountPercentage !== null && order.discountPercentage > 0) {
    const memberFactor = 1 - memberDiscountPct / 100;
    const subtotalBeforeDiscount =
      memberFactor > 0 ? orderTotals.net / memberFactor : orderTotals.net;
    const subtotal = Math.round(subtotalBeforeDiscount * 100) / 100;
    const discountAmount = Math.round(((subtotal * discountPct) / 100) * 100) / 100;
    const adminFeeAmount = Math.round(((subtotal * adminPct) / 100) * 100) / 100;
    const memberDiscountAmount = Math.round(((subtotal * memberDiscountPct) / 100) * 100) / 100;
    discount = {
      discountPercentage: discountPct,
      adminFeePercentage: adminPct,
      memberDiscountPercentage: memberDiscountPct,
      subtotalBeforeDiscount: subtotal,
      discountAmount,
      adminFeeAmount,
      memberDiscountAmount,
    };
  }

  return c.json({
    items: reconItems,
    memberSummaries,
    orderTotals,
    allConfirmed,
    discount,
  } satisfies ReconciliationSummary);
});

// POST /:id/allocate — Generate allocations (organiser only)
app.post('/:id/allocate', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const memberId = c.get('memberId');

  // Check organiser role
  const [membership] = await db
    .select()
    .from(orderMembers)
    .where(
      and(
        eq(orderMembers.orderId, orderId),
        eq(orderMembers.memberId, memberId),
        eq(orderMembers.role, 'organiser'),
      ),
    );

  if (!membership) {
    return c.json({ error: 'Only organisers can generate allocations' }, 403);
  }

  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  if (order.status !== 'reconciling') {
    return c.json({ error: 'Order must be in reconciling status' }, 400);
  }

  const [anyItem] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .limit(1);

  if (!anyItem) {
    return c.json({ error: 'No items on this order' }, 400);
  }

  const result = await recalculateAllocations(db, orderId);
  if ('error' in result) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ count: result.count });
});

// PUT /:id/allocations/:allocationId/checks — Toggle split / picked-up flags
//
// Body: { split?: boolean, pickedUp?: boolean } — at least one field required.
// Permissions:
//   - split: any member of the order (anyone helping at the distribution)
//   - pickedUp: any member of the order (members often collect each other's order)
app.put('/:id/allocations/:allocationId/checks', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const allocationId = c.req.param('allocationId');
  const memberId = c.get('memberId');
  const body = (await c.req.json()) as { split?: unknown; pickedUp?: unknown };

  const splitProvided = Object.prototype.hasOwnProperty.call(body, 'split');
  const pickedUpProvided = Object.prototype.hasOwnProperty.call(body, 'pickedUp');

  if (!splitProvided && !pickedUpProvided) {
    return c.json({ error: 'At least one of split or pickedUp must be provided' }, 400);
  }
  if (splitProvided && typeof body.split !== 'boolean') {
    return c.json({ error: 'split must be a boolean' }, 400);
  }
  if (pickedUpProvided && typeof body.pickedUp !== 'boolean') {
    return c.json({ error: 'pickedUp must be a boolean' }, 400);
  }

  const [membership] = await db
    .select()
    .from(orderMembers)
    .where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, memberId)));

  if (!membership) {
    return c.json({ error: 'You are not a member of this order' }, 403);
  }

  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  if (order.status !== 'reconciling') {
    return c.json({ error: 'Order must be in reconciling status' }, 400);
  }

  const [alloc] = await db.select().from(allocations).where(eq(allocations.id, allocationId));

  if (!alloc) {
    return c.json({ error: 'Allocation not found' }, 404);
  }

  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, alloc.orderItemId), eq(orderItems.orderId, orderId)));

  if (!item) {
    return c.json({ error: 'Allocation does not belong to this order' }, 404);
  }

  const updates: { confirmed?: number; splitConfirmed?: number } = {};
  if (splitProvided) updates.splitConfirmed = body.split ? 1 : 0;
  if (pickedUpProvided) updates.confirmed = body.pickedUp ? 1 : 0;

  await db.update(allocations).set(updates).where(eq(allocations.id, allocationId));

  const [updated] = await db.select().from(allocations).where(eq(allocations.id, allocationId));

  return c.json({
    ...updated,
    confirmed: Boolean(updated.confirmed),
    splitConfirmed: Boolean(updated.splitConfirmed),
  });
});

// PUT /:id/allocations/:allocationId/confirm — Confirm own allocation
app.put('/:id/allocations/:allocationId/confirm', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const allocationId = c.req.param('allocationId');
  const memberId = c.get('memberId');

  // Check membership
  const [membership] = await db
    .select()
    .from(orderMembers)
    .where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, memberId)));

  if (!membership) {
    return c.json({ error: 'You are not a member of this order' }, 403);
  }

  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  if (order.status !== 'reconciling') {
    return c.json({ error: 'Order must be in reconciling status' }, 400);
  }

  // Find allocation and verify ownership
  const [alloc] = await db
    .select()
    .from(allocations)
    .where(and(eq(allocations.id, allocationId), eq(allocations.memberId, memberId)));

  if (!alloc) {
    return c.json({ error: 'Allocation not found or not yours' }, 404);
  }

  // Verify the allocation belongs to an item on this order
  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, alloc.orderItemId), eq(orderItems.orderId, orderId)));

  if (!item) {
    return c.json({ error: 'Allocation does not belong to this order' }, 404);
  }

  await db.update(allocations).set({ confirmed: 1 }).where(eq(allocations.id, allocationId));

  return c.json({ ...alloc, confirmed: true });
});

// PUT /:id/confirm-all — Confirm all own allocations at once
app.put('/:id/confirm-all', async (c) => {
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

  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  if (order.status !== 'reconciling') {
    return c.json({ error: 'Order must be in reconciling status' }, 400);
  }

  // Get all order item IDs for this order
  const items = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  if (items.length === 0) {
    return c.json({ count: 0 });
  }

  const itemIds = items.map((i) => i.id);

  // Update all my unconfirmed allocations on this order's items
  const myAllocations = await db
    .select({ id: allocations.id })
    .from(allocations)
    .where(
      and(
        inArray(allocations.orderItemId, itemIds),
        eq(allocations.memberId, memberId),
        eq(allocations.confirmed, 0),
      ),
    );

  if (myAllocations.length === 0) {
    return c.json({ count: 0 });
  }

  const allocIds = myAllocations.map((a) => a.id);
  await db.update(allocations).set({ confirmed: 1 }).where(inArray(allocations.id, allocIds));

  return c.json({ count: myAllocations.length });
});

export default app;

import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { orders, orderItems, claims, deliveryItems, allocations } from '../../db/schema';
import { computeAllocations } from './reconciliation';
import { calculateRounding } from '../../shared/rounding';
import { calculateCaseSize } from '../../shared/costs';
import { DEFAULT_ADMIN_FEE_PERCENTAGE } from '../../shared/types';
import type { DeliveryStatus } from '../../shared/types';

/** True once an organiser has generated allocations for any item on the order. */
export async function orderHasAllocations(
  db: DrizzleD1Database,
  orderId: string,
): Promise<boolean> {
  const itemIds = (
    await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, orderId))
  ).map((r) => r.id);
  if (itemIds.length === 0) return false;

  const [row] = await db
    .select({ id: allocations.id })
    .from(allocations)
    .where(inArray(allocations.orderItemId, itemIds))
    .limit(1);
  return Boolean(row);
}

/**
 * Recompute allocations from current claims and delivery statuses.
 *
 * With `onlyItemIds`, only those items are recomputed (used to keep shares in
 * sync after a claim or delivery edit); otherwise every item on the order is.
 *
 * Existing rows are updated in place rather than recreated, and a member's
 * split/picked-up flags are kept when their allocated amount hasn't changed —
 * those flags record physical distribution, which is still valid for an
 * unchanged share. Allocations for members who no longer get anything are
 * removed.
 */
export async function recalculateAllocations(
  db: DrizzleD1Database,
  orderId: string,
  onlyItemIds?: string[],
): Promise<{ count: number } | { error: string }> {
  const [order] = await db
    .select({
      discountPercentage: orders.discountPercentage,
      adminFeePercentage: orders.adminFeePercentage,
    })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { error: 'Order not found' };

  const discountPct = order.discountPercentage ?? 0;
  const adminPct = order.adminFeePercentage ?? DEFAULT_ADMIN_FEE_PERCENTAGE;
  const memberDiscountPct = Math.max(0, discountPct - adminPct);

  let items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  if (onlyItemIds) {
    const wanted = new Set(onlyItemIds);
    items = items.filter((i) => wanted.has(i.id));
  }
  if (items.length === 0) return { count: 0 };

  const itemIds = items.map((i) => i.id);

  const deliveries = await db
    .select()
    .from(deliveryItems)
    .where(inArray(deliveryItems.orderItemId, itemIds));
  const deliveryMap = new Map(deliveries.map((d) => [d.orderItemId, d]));

  const missingDelivery = items.filter((i) => !deliveryMap.has(i.id));
  if (missingDelivery.length > 0) {
    return {
      error: `${missingDelivery.length} item(s) are missing delivery status. All items must have a delivery status before generating allocations.`,
    };
  }

  const allClaims = await db.select().from(claims).where(inArray(claims.orderItemId, itemIds));
  const claimsByItem = new Map<string, typeof allClaims>();
  for (const claim of allClaims) {
    const list = claimsByItem.get(claim.orderItemId) ?? [];
    list.push(claim);
    claimsByItem.set(claim.orderItemId, list);
  }

  const existing = await db
    .select()
    .from(allocations)
    .where(inArray(allocations.orderItemId, itemIds));
  const existingByKey = new Map(existing.map((a) => [`${a.orderItemId}:${a.memberId}`, a]));

  const inserts: (typeof allocations.$inferInsert)[] = [];
  const keep = new Set<string>();
  let count = 0;

  for (const item of items) {
    const delivery = deliveryMap.get(item.id)!;
    const itemClaims = claimsByItem.get(item.id) ?? [];
    const rounding = calculateRounding(itemClaims, item.unitsPerCase, item.packSize);

    const computed = computeAllocations(
      itemClaims.map((cl) => ({ memberId: cl.memberId, amount: cl.amount })),
      delivery.status as DeliveryStatus,
      calculateCaseSize(item.unitsPerCase, item.packSize),
      rounding.casesNeeded,
      item.casePrice,
      item.vatRate,
      delivery.actualPrice,
      delivery.actualQuantity,
      memberDiscountPct,
    );

    for (const alloc of computed) {
      count++;
      const prior = existingByKey.get(`${item.id}:${alloc.memberId}`);
      if (!prior) {
        inserts.push({
          id: nanoid(),
          orderItemId: item.id,
          memberId: alloc.memberId,
          amount: alloc.amount,
          price: alloc.price,
          confirmed: 0,
          splitConfirmed: 0,
        });
        continue;
      }

      keep.add(prior.id);
      const amountChanged = prior.amount !== alloc.amount;
      if (amountChanged || prior.price !== alloc.price) {
        await db
          .update(allocations)
          .set({
            amount: alloc.amount,
            price: alloc.price,
            ...(amountChanged ? { confirmed: 0, splitConfirmed: 0 } : {}),
          })
          .where(eq(allocations.id, prior.id));
      }
    }
  }

  const stale = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
  if (stale.length > 0) {
    await db.delete(allocations).where(inArray(allocations.id, stale));
  }

  // D1 caps SQL variables per statement, so chunk
  const CHUNK_SIZE = 10;
  for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
    await db.insert(allocations).values(inserts.slice(i, i + CHUNK_SIZE));
  }

  return { count };
}

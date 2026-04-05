import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, count, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Bindings } from '../index';
import type { JwtPayload } from '../services/jwt';
import { requireAuth } from '../middleware/auth';
import { orders, orderMembers, members } from '../../db/schema';
import {
  validateCreateOrder,
  validateUpdateOrder,
  validateJoinOrder,
  isValidStatusTransition,
  generateInviteCode,
} from '../services/orders';

const app = new Hono<{
  Bindings: Bindings;
  Variables: { jwtPayload: JwtPayload; memberId: string };
}>();

app.use('/*', requireAuth);

// POST / — Create order
app.post('/', async (c) => {
  const db = drizzle(c.env.DB);
  const memberId = c.get('memberId');
  const body = await c.req.json();

  const validated = validateCreateOrder(body);
  if ('error' in validated) {
    return c.json({ error: validated.error }, 400);
  }

  // Verify catalogue exists in KV
  const catalogueExists = await c.env.CATALOGUE_KV.get(validated.catalogueKey);
  if (!catalogueExists) {
    return c.json({ error: 'Catalogue not found' }, 404);
  }

  const id = nanoid();
  const inviteCode = generateInviteCode();
  const now = Math.floor(Date.now() / 1000);

  const order = {
    id,
    name: validated.name,
    catalogueKey: validated.catalogueKey,
    status: 'open',
    deadline: validated.deadline ?? null,
    inviteCode,
    createdBy: memberId,
    createdAt: now,
  };

  await db.insert(orders).values(order);

  await db.insert(orderMembers).values({
    orderId: id,
    memberId,
    role: 'organiser',
    joinedAt: now,
  });

  return c.json(order, 201);
});

// GET / — List member's orders
app.get('/', async (c) => {
  const db = drizzle(c.env.DB);
  const memberId = c.get('memberId');

  // Get order IDs where user is a member
  const memberOrders = await db
    .select({ orderId: orderMembers.orderId })
    .from(orderMembers)
    .where(eq(orderMembers.memberId, memberId));

  if (memberOrders.length === 0) {
    return c.json([]);
  }

  const orderIds = memberOrders.map((m) => m.orderId);

  // Get those orders
  const userOrders = await db.select().from(orders).where(inArray(orders.id, orderIds));

  // Get member counts for each order
  const memberCounts = await db
    .select({ orderId: orderMembers.orderId, count: count() })
    .from(orderMembers)
    .where(inArray(orderMembers.orderId, orderIds))
    .groupBy(orderMembers.orderId);

  const countMap = new Map(memberCounts.map((mc) => [mc.orderId, mc.count]));

  const result = userOrders.map((order) => ({
    ...order,
    memberCount: countMap.get(order.id) ?? 0,
  }));

  return c.json(result);
});

// GET /join/:code — Lookup invite (registered before /:id to avoid conflict)
app.get('/join/:code', async (c) => {
  const db = drizzle(c.env.DB);
  const code = c.req.param('code');

  const [order] = await db.select().from(orders).where(eq(orders.inviteCode, code));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const [{ count: memberCount }] = await db
    .select({ count: count() })
    .from(orderMembers)
    .where(eq(orderMembers.orderId, order.id));

  return c.json({
    id: order.id,
    name: order.name,
    status: order.status,
    memberCount,
  });
});

// GET /:id — Order details
app.get('/:id', async (c) => {
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

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  // Get all members with their details
  const orderMemberRows = await db
    .select({
      memberId: orderMembers.memberId,
      name: members.name,
      initials: members.initials,
      role: orderMembers.role,
      joinedAt: orderMembers.joinedAt,
    })
    .from(orderMembers)
    .innerJoin(members, eq(orderMembers.memberId, members.id))
    .where(eq(orderMembers.orderId, orderId));

  return c.json({ ...order, members: orderMemberRows });
});

// PUT /:id — Update order (organiser only)
app.put('/:id', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const memberId = c.get('memberId');
  const body = await c.req.json();

  const validated = validateUpdateOrder(body);
  if ('error' in validated) {
    return c.json({ error: validated.error }, 400);
  }

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
    return c.json({ error: 'Only organisers can update orders' }, 403);
  }

  // If status change, validate transition
  if (validated.status) {
    const [currentOrder] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!currentOrder) {
      return c.json({ error: 'Order not found' }, 404);
    }

    if (!isValidStatusTransition(currentOrder.status, validated.status)) {
      return c.json(
        { error: `Cannot transition from '${currentOrder.status}' to '${validated.status}'` },
        400,
      );
    }
  }

  // Build update object
  const updateFields: Record<string, unknown> = {};
  if (validated.name !== undefined) updateFields.name = validated.name;
  if (validated.deadline !== undefined) updateFields.deadline = validated.deadline;
  if (validated.status !== undefined) updateFields.status = validated.status;

  await db.update(orders).set(updateFields).where(eq(orders.id, orderId));

  const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, orderId));

  return c.json(updatedOrder);
});

// POST /:id/join — Join order
app.post('/:id/join', async (c) => {
  const db = drizzle(c.env.DB);
  const orderId = c.req.param('id');
  const memberId = c.get('memberId');
  const body = await c.req.json();

  const validated = validateJoinOrder(body);
  if ('error' in validated) {
    return c.json({ error: validated.error }, 400);
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

  if (!order) {
    return c.json({ error: 'Order not found' }, 404);
  }

  if (order.inviteCode !== validated.inviteCode) {
    return c.json({ error: 'Invalid invite code' }, 400);
  }

  if (order.status !== 'open') {
    return c.json({ error: 'Order is not open for new members' }, 400);
  }

  // Check if already a member
  const [existing] = await db
    .select()
    .from(orderMembers)
    .where(and(eq(orderMembers.orderId, orderId), eq(orderMembers.memberId, memberId)));

  if (existing) {
    return c.json({ error: 'You are already a member of this order' }, 409);
  }

  const now = Math.floor(Date.now() / 1000);

  await db.insert(orderMembers).values({
    orderId,
    memberId,
    role: 'member',
    joinedAt: now,
  });

  return c.json(order);
});

export default app;

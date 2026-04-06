import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import { members, authTokens } from '../../db/schema';
import { sendMagicLink } from '../services/email';
import { signJwt } from '../services/jwt';

const app = new Hono<{ Bindings: Bindings }>();

// POST /auth/magic-link — send a magic link email
app.post('/magic-link', async (c) => {
  const { email } = await c.req.json<{ email: string }>();

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email is required' }, 400);
  }

  const db = drizzle(c.env.DB);
  const token = nanoid(32);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 15 * 60; // 15 minutes

  await db
    .insert(authTokens)
    .values({ id: nanoid(), email: email.toLowerCase().trim(), token, expiresAt });

  // Prefer the browser's Origin header so dev links point at Vite (:5173)
  // rather than the wrangler worker (:8787). Falls back to the request origin
  // for non-browser callers (tests, curl, etc.).
  const baseUrl = c.req.header('Origin') ?? new URL(c.req.url).origin;
  await sendMagicLink(c.env.RESEND_API_KEY, email, token, baseUrl, c.env.EMAIL_FROM);

  return c.json({ message: 'Magic link sent' });
});

// GET /auth/verify?token=xxx — verify token and return JWT
app.get('/verify', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: 'Token is required' }, 400);
  }

  const db = drizzle(c.env.DB);
  const now = Math.floor(Date.now() / 1000);

  const [authToken] = await db
    .select()
    .from(authTokens)
    .where(eq(authTokens.token, token))
    .limit(1);

  if (!authToken) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  if (authToken.usedAt) {
    return c.json({ error: 'Token already used' }, 401);
  }

  if (authToken.expiresAt < now) {
    return c.json({ error: 'Token expired' }, 401);
  }

  // Mark token as used
  await db.update(authTokens).set({ usedAt: now }).where(eq(authTokens.id, authToken.id));

  // Find or create member
  const email = authToken.email;
  let [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);

  const isNewUser = !member;

  if (!member) {
    const id = nanoid();
    await db.insert(members).values({ id, email, createdAt: now });
    member = { id, email, name: null, initials: null, createdAt: now };
  }

  const jwt = await signJwt({ sub: member.id, email: member.email }, c.env.JWT_SECRET);

  return c.json({
    token: jwt,
    user: { id: member.id, email: member.email, name: member.name, initials: member.initials },
    isNewUser,
  });
});

// PUT /auth/profile — update name and initials (first-login setup)
app.put('/profile', async (c) => {
  const { memberId, name, initials } = await c.req.json<{
    memberId: string;
    name: string;
    initials: string;
  }>();

  if (!memberId || !name || !initials) {
    return c.json({ error: 'memberId, name, and initials are required' }, 400);
  }

  if (initials.length < 2 || initials.length > 3) {
    return c.json({ error: 'Initials must be 2-3 characters' }, 400);
  }

  const db = drizzle(c.env.DB);

  await db
    .update(members)
    .set({ name, initials: initials.toUpperCase() })
    .where(eq(members.id, memberId));

  const [updated] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);

  return c.json({
    user: { id: updated.id, email: updated.email, name: updated.name, initials: updated.initials },
  });
});

export default app;

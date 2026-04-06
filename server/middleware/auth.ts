import { createMiddleware } from 'hono/factory';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import type { Bindings } from '../index';
import { verifyJwt, type JwtPayload } from '../services/jwt';
import { members } from '../../db/schema';

type AuthEnv = {
  Bindings: Bindings;
  Variables: {
    jwtPayload: JwtPayload;
    memberId: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.slice(7);

  let payload: JwtPayload;
  try {
    payload = await verifyJwt(token, c.env.JWT_SECRET);
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Verify the member referenced by the JWT still exists. The local D1 dev DB
  // gets wiped by e2e setup, which would otherwise leave the browser holding a
  // valid-but-orphaned token and surface as opaque FK errors on the first write.
  const db = drizzle(c.env.DB);
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, payload.sub))
    .limit(1);

  if (!member) {
    return c.json({ error: 'Member no longer exists' }, 401);
  }

  c.set('jwtPayload', payload);
  c.set('memberId', payload.sub);
  await next();
});

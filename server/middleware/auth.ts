import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../index';
import { verifyJwt, type JwtPayload } from '../services/jwt';

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

	try {
		const payload = await verifyJwt(token, c.env.JWT_SECRET);
		c.set('jwtPayload', payload);
		c.set('memberId', payload.sub);
		await next();
	} catch {
		return c.json({ error: 'Invalid or expired token' }, 401);
	}
});

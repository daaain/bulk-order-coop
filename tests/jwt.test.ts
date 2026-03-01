import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../server/services/jwt';

const TEST_SECRET = 'test-secret-for-jwt-testing';

describe('JWT', () => {
	it('signs and verifies a valid token', async () => {
		const token = await signJwt({ sub: 'user-123', email: 'test@example.com' }, TEST_SECRET);

		expect(token).toBeTruthy();
		expect(token.split('.')).toHaveLength(3);

		const payload = await verifyJwt(token, TEST_SECRET);
		expect(payload.sub).toBe('user-123');
		expect(payload.email).toBe('test@example.com');
		expect(payload.iat).toBeTypeOf('number');
		expect(payload.exp).toBeTypeOf('number');
		expect(payload.exp).toBeGreaterThan(payload.iat);
	});

	it('rejects a token with wrong secret', async () => {
		const token = await signJwt({ sub: 'user-123', email: 'test@example.com' }, TEST_SECRET);

		await expect(verifyJwt(token, 'wrong-secret')).rejects.toThrow('Invalid token signature');
	});

	it('rejects a tampered token', async () => {
		const token = await signJwt({ sub: 'user-123', email: 'test@example.com' }, TEST_SECRET);

		// Tamper with the payload
		const parts = token.split('.');
		parts[1] = parts[1] + 'x';
		const tampered = parts.join('.');

		await expect(verifyJwt(tampered, TEST_SECRET)).rejects.toThrow();
	});

	it('rejects an expired token', async () => {
		const token = await signJwt(
			{ sub: 'user-123', email: 'test@example.com' },
			TEST_SECRET,
			-1 // already expired
		);

		await expect(verifyJwt(token, TEST_SECRET)).rejects.toThrow('Token expired');
	});

	it('rejects an invalid format', async () => {
		await expect(verifyJwt('not-a-token', TEST_SECRET)).rejects.toThrow('Invalid token format');
	});

	it('sets correct expiry based on expiresInSeconds', async () => {
		const token = await signJwt(
			{ sub: 'user-123', email: 'test@example.com' },
			TEST_SECRET,
			3600 // 1 hour
		);

		const payload = await verifyJwt(token, TEST_SECRET);
		expect(payload.exp - payload.iat).toBe(3600);
	});
});

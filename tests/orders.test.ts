import { describe, it, expect } from 'vitest';
import {
	validateCreateOrder,
	validateUpdateOrder,
	validateJoinOrder,
	isValidStatusTransition,
	generateInviteCode
} from '../server/services/orders';

describe('validateCreateOrder', () => {
	it('returns parsed body for valid input', () => {
		const result = validateCreateOrder({ name: 'Jan Order', catalogueKey: 'abc123' });
		expect(result).toEqual({ name: 'Jan Order', catalogueKey: 'abc123' });
		expect('error' in result).toBe(false);
	});

	it('returns parsed body with optional deadline', () => {
		const deadline = Date.now();
		const result = validateCreateOrder({ name: 'Jan Order', catalogueKey: 'abc123', deadline });
		expect(result).toEqual({ name: 'Jan Order', catalogueKey: 'abc123', deadline });
	});

	it('returns error for missing name', () => {
		const result = validateCreateOrder({ catalogueKey: 'abc123' });
		expect(result).toHaveProperty('error');
		expect((result as { error: string }).error).toMatch(/name/i);
	});

	it('returns error for empty name (whitespace only)', () => {
		const result = validateCreateOrder({ name: '   ', catalogueKey: 'abc123' });
		expect(result).toHaveProperty('error');
		expect((result as { error: string }).error).toMatch(/name/i);
	});

	it('returns error for missing catalogueKey', () => {
		const result = validateCreateOrder({ name: 'Jan Order' });
		expect(result).toHaveProperty('error');
		expect((result as { error: string }).error).toMatch(/catalogueKey/i);
	});
});

describe('validateUpdateOrder', () => {
	it('allows partial update with name only', () => {
		const result = validateUpdateOrder({ name: 'Updated Name' });
		expect(result).toEqual({ name: 'Updated Name' });
		expect('error' in result).toBe(false);
	});

	it('allows partial update with deadline only', () => {
		const deadline = Date.now();
		const result = validateUpdateOrder({ deadline });
		expect(result).toEqual({ deadline });
	});

	it('allows partial update with valid status', () => {
		const result = validateUpdateOrder({ status: 'closed' });
		expect(result).toEqual({ status: 'closed' });
	});

	it('rejects invalid status value', () => {
		const result = validateUpdateOrder({ status: 'invalid' });
		expect(result).toHaveProperty('error');
		expect((result as { error: string }).error).toMatch(/status/i);
	});

	it('rejects empty object (at least one field required)', () => {
		const result = validateUpdateOrder({});
		expect(result).toHaveProperty('error');
		expect((result as { error: string }).error).toMatch(/at least one/i);
	});
});

describe('isValidStatusTransition', () => {
	it('allows open → closed', () => {
		expect(isValidStatusTransition('open', 'closed')).toBe(true);
	});

	it('allows closed → reconciling', () => {
		expect(isValidStatusTransition('closed', 'reconciling')).toBe(true);
	});

	it('allows reconciling → complete', () => {
		expect(isValidStatusTransition('reconciling', 'complete')).toBe(true);
	});

	it('rejects skipping (open → complete)', () => {
		expect(isValidStatusTransition('open', 'complete')).toBe(false);
	});

	it('rejects backwards (closed → open)', () => {
		expect(isValidStatusTransition('closed', 'open')).toBe(false);
	});

	it('rejects same (open → open)', () => {
		expect(isValidStatusTransition('open', 'open')).toBe(false);
	});
});

describe('generateInviteCode', () => {
	it('returns a 10-character string', () => {
		const code = generateInviteCode();
		expect(code).toBeTypeOf('string');
		expect(code).toHaveLength(10);
	});
});

describe('validateJoinOrder', () => {
	it('returns error for missing inviteCode', () => {
		const result = validateJoinOrder({});
		expect(result).toHaveProperty('error');
		expect((result as { error: string }).error).toMatch(/inviteCode/i);
	});

	it('returns parsed body for valid input', () => {
		const result = validateJoinOrder({ inviteCode: 'ABC1234567' });
		expect(result).toEqual({ inviteCode: 'ABC1234567' });
		expect('error' in result).toBe(false);
	});
});

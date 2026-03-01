import { describe, it, expect } from 'vitest';
import { validateAddItem, validateClaim } from '$server/services/items';

describe('validateAddItem', () => {
	it('accepts a valid productCode', () => {
		const result = validateAddItem({ productCode: '12345' });
		expect(result).toEqual({ productCode: '12345' });
	});

	it('rejects missing productCode', () => {
		const result = validateAddItem({});
		expect(result).toEqual({ error: 'productCode is required' });
	});

	it('rejects empty productCode', () => {
		const result = validateAddItem({ productCode: '  ' });
		expect(result).toEqual({ error: 'productCode is required' });
	});

	it('accepts productCode with optional notes', () => {
		const result = validateAddItem({ productCode: '12345', notes: 'Get the green one' });
		expect(result).toEqual({ productCode: '12345', notes: 'Get the green one' });
	});

	it('strips notes if empty/whitespace', () => {
		const result = validateAddItem({ productCode: '12345', notes: '   ' });
		expect(result).toEqual({ productCode: '12345' });
	});
});

describe('validateClaim', () => {
	it('accepts a valid amount with no flexibility', () => {
		const result = validateClaim({ amount: 2.5 });
		expect(result).toEqual({ amount: 2.5 });
	});

	it('accepts valid flexibility values', () => {
		for (const flexibility of ['+', '-', '+-', '*']) {
			const result = validateClaim({ amount: 1, flexibility });
			expect(result).toEqual({ amount: 1, flexibility });
		}
	});

	it('rejects zero amount', () => {
		const result = validateClaim({ amount: 0 });
		expect(result).toEqual({ error: 'amount must be a positive number' });
	});

	it('rejects negative amount', () => {
		const result = validateClaim({ amount: -1 });
		expect(result).toEqual({ error: 'amount must be a positive number' });
	});

	it('rejects non-numeric amount', () => {
		const result = validateClaim({ amount: 'lots' });
		expect(result).toEqual({ error: 'amount must be a positive number' });
	});

	it('rejects missing amount', () => {
		const result = validateClaim({});
		expect(result).toEqual({ error: 'amount must be a positive number' });
	});

	it('rejects invalid flexibility value', () => {
		const result = validateClaim({ amount: 1, flexibility: 'maybe' });
		expect(result).toEqual({ error: 'flexibility must be one of: +, -, +-, *' });
	});
});

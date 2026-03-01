import { describe, it, expect } from 'vitest';
import { estimateCost, calculateCaseSize, vatRateToPercent } from '$shared/costs';

describe('calculateCaseSize', () => {
	it('multiplies unitsPerCase by packSize for packaged items', () => {
		// 6 tins × 400g each = 2400g per case
		expect(calculateCaseSize(6, 400)).toBe(2400);
	});

	it('uses packSize alone for loose/bulk items (null unitsPerCase)', () => {
		// 5kg bag
		expect(calculateCaseSize(null, 5)).toBe(5);
	});
});

describe('vatRateToPercent', () => {
	it('maps code 0 to 0%', () => {
		expect(vatRateToPercent(0)).toBe(0);
	});

	it('maps code 2 to 20%', () => {
		expect(vatRateToPercent(2)).toBe(20);
	});

	it('maps unknown codes to 0%', () => {
		expect(vatRateToPercent(1)).toBe(0);
		expect(vatRateToPercent(99)).toBe(0);
	});
});

describe('estimateCost', () => {
	it('estimates cost for zero-rated VAT item (code 0)', () => {
		// Claiming 500g from a 3000g case at £15.00, VAT code 0
		const result = estimateCost(500, 3000, 15.0, 0);
		expect(result.net).toBeCloseTo(2.5);
		expect(result.vat).toBeCloseTo(0);
		expect(result.gross).toBeCloseTo(2.5);
	});

	it('estimates cost for standard-rated VAT item (code 2)', () => {
		// Claiming 1000g from a 3000g case at £18.00, VAT code 2 (20%)
		const result = estimateCost(1000, 3000, 18.0, 2);
		expect(result.net).toBeCloseTo(6.0);
		expect(result.vat).toBeCloseTo(1.2);
		expect(result.gross).toBeCloseTo(7.2);
	});

	it('estimates cost for a full case', () => {
		// Claiming full case: 3000g from 3000g case at £15.00, VAT code 0
		const result = estimateCost(3000, 3000, 15.0, 0);
		expect(result.net).toBeCloseTo(15.0);
		expect(result.vat).toBeCloseTo(0);
		expect(result.gross).toBeCloseTo(15.0);
	});

	it('estimates cost for fractional case proportion with standard VAT', () => {
		// Claiming 750g from a 3000g case at £12.00, VAT code 2 (20%)
		// proportion = 750/3000 = 0.25, net = 3.00, vat = 0.60
		const result = estimateCost(750, 3000, 12.0, 2);
		expect(result.net).toBeCloseTo(3.0);
		expect(result.vat).toBeCloseTo(0.6);
		expect(result.gross).toBeCloseTo(3.6);
	});

	it('returns zero for zero claim amount', () => {
		const result = estimateCost(0, 3000, 15.0, 2);
		expect(result.net).toBe(0);
		expect(result.vat).toBe(0);
		expect(result.gross).toBe(0);
	});
});

import type { DeliveryStatus } from '../../shared/types';
import { estimateCost } from '../../shared/costs';

const VALID_STATUSES: DeliveryStatus[] = ['arrived', 'missing', 'partial', 'different_price'];

export interface DeliveryUpdateInput {
	status: DeliveryStatus;
	actualQuantity?: number | null;
	actualPrice?: number | null;
	notes?: string | null;
}

export function validateDeliveryUpdate(
	body: unknown
): DeliveryUpdateInput | { error: string } {
	if (!body || typeof body !== 'object') {
		return { error: 'Request body must be an object' };
	}

	const { status, actualQuantity, actualPrice, notes } = body as Record<string, unknown>;

	if (typeof status !== 'string' || !VALID_STATUSES.includes(status as DeliveryStatus)) {
		return { error: `status must be one of: ${VALID_STATUSES.join(', ')}` };
	}

	if (status === 'partial') {
		if (typeof actualQuantity !== 'number' || actualQuantity <= 0) {
			return { error: 'actualQuantity is required and must be positive when status is partial' };
		}
	}

	if (status === 'different_price') {
		if (typeof actualPrice !== 'number' || actualPrice <= 0) {
			return { error: 'actualPrice is required and must be positive when status is different_price' };
		}
	}

	const result: DeliveryUpdateInput = { status: status as DeliveryStatus };

	if (actualQuantity !== undefined && actualQuantity !== null) {
		result.actualQuantity = actualQuantity as number;
	}
	if (actualPrice !== undefined && actualPrice !== null) {
		result.actualPrice = actualPrice as number;
	}
	if (notes !== undefined) {
		result.notes = typeof notes === 'string' ? notes : null;
	}

	return result;
}

export interface AllocationInput {
	memberId: string;
	amount: number;
}

export interface ComputedAllocation {
	memberId: string;
	amount: number;
	price: number;
}

/**
 * Compute allocations for an order item based on claims and delivery status.
 *
 * @param claims       Array of { memberId, amount } for each claim on this item
 * @param status       Delivery status
 * @param caseSize     Units per case (from calculateCaseSize)
 * @param casesOrdered Number of cases ordered (from rounding.casesNeeded)
 * @param casePrice    Catalogue case price in £
 * @param vatCode      Infinity Foods VAT code (0 or 2)
 * @param actualPrice  Actual case price (when status is 'different_price')
 * @param actualQuantity Actual units delivered (when status is 'partial')
 */
export function computeAllocations(
	claims: AllocationInput[],
	status: DeliveryStatus,
	caseSize: number,
	casesOrdered: number,
	casePrice: number,
	vatCode: number,
	actualPrice?: number | null,
	actualQuantity?: number | null
): ComputedAllocation[] {
	if (status === 'missing' || claims.length === 0) {
		return [];
	}

	const totalClaimed = claims.reduce((sum, c) => sum + c.amount, 0);
	const effectivePrice = status === 'different_price' && actualPrice ? actualPrice : casePrice;

	let scaleFactor = 1.0;
	if (status === 'partial' && actualQuantity && totalClaimed > 0) {
		scaleFactor = Math.min(actualQuantity / totalClaimed, 1.0);
	}

	return claims.map((claim) => {
		const allocatedAmount = Math.round((claim.amount * scaleFactor) * 100) / 100;
		const cost = estimateCost(allocatedAmount, caseSize, effectivePrice, vatCode);
		const price = Math.round(cost.net * 100) / 100;

		return {
			memberId: claim.memberId,
			amount: allocatedAmount,
			price
		};
	});
}

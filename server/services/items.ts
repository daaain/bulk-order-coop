const VALID_FLEXIBILITY = ['+', '-', '+-', '*'] as const;

type AddItemResult = { productCode: string; notes?: string } | { error: string };
type ClaimResult = { amount: number; flexibility?: string } | { error: string };

export function validateAddItem(body: Record<string, unknown>): AddItemResult {
	const productCode = typeof body.productCode === 'string' ? body.productCode.trim() : '';
	if (!productCode) {
		return { error: 'productCode is required' };
	}

	const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
	if (notes) {
		return { productCode, notes };
	}
	return { productCode };
}

export function validateClaim(body: Record<string, unknown>): ClaimResult {
	const amount = typeof body.amount === 'number' ? body.amount : NaN;
	if (!amount || amount <= 0 || isNaN(amount)) {
		return { error: 'amount must be a positive number' };
	}

	if (body.flexibility !== undefined && body.flexibility !== null) {
		if (!VALID_FLEXIBILITY.includes(body.flexibility as typeof VALID_FLEXIBILITY[number])) {
			return { error: 'flexibility must be one of: +, -, +-, *' };
		}
		return { amount, flexibility: body.flexibility as string };
	}

	return { amount };
}

const VALID_FLEXIBILITY = ['+', '-', '+-', '*'] as const;

export interface AddItemSnapshot {
  productCode: string;
  description: string;
  brand: string | null;
  organic: boolean;
  casePrice: number;
  vatRate: number;
  vatPerCase: number;
  unitsPerCase: number | null;
  packSize: number;
  unit: string;
  rrp: number | null;
  barcode: string | null;
  notes?: string;
}

type AddItemResult = AddItemSnapshot | { error: string };
type Flexibility = '+' | '-' | '+-' | '*';
type ClaimResult = { amount: number; flexibility?: Flexibility } | { error: string };

export function validateAddItem(body: Record<string, unknown>): AddItemResult {
  const productCode = typeof body.productCode === 'string' ? body.productCode.trim() : '';
  if (!productCode) {
    return { error: 'productCode is required' };
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return { error: 'description is required' };
  }

  if (typeof body.casePrice !== 'number' || body.casePrice <= 0) {
    return { error: 'casePrice must be a positive number' };
  }

  if (body.vatRate !== 0 && body.vatRate !== 2) {
    return { error: 'vatRate must be 0 or 2' };
  }

  if (typeof body.packSize !== 'number' || body.packSize <= 0) {
    return { error: 'packSize must be a positive number' };
  }

  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  if (!unit) {
    return { error: 'unit is required' };
  }

  const result: AddItemSnapshot = {
    productCode,
    description,
    brand: typeof body.brand === 'string' ? body.brand : null,
    organic: Boolean(body.organic),
    casePrice: body.casePrice,
    vatRate: body.vatRate as number,
    vatPerCase: typeof body.vatPerCase === 'number' ? body.vatPerCase : 0,
    unitsPerCase: typeof body.unitsPerCase === 'number' ? body.unitsPerCase : null,
    packSize: body.packSize,
    unit,
    rrp: typeof body.rrp === 'number' ? body.rrp : null,
    barcode: typeof body.barcode === 'string' ? body.barcode : null,
  };

  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes) {
    result.notes = notes;
  }

  return result;
}

export function validateClaim(body: Record<string, unknown>): ClaimResult {
  const amount = typeof body.amount === 'number' ? body.amount : NaN;
  if (!amount || amount <= 0 || isNaN(amount)) {
    return { error: 'amount must be a positive number' };
  }

  if (body.flexibility !== undefined && body.flexibility !== null) {
    if (!VALID_FLEXIBILITY.includes(body.flexibility as (typeof VALID_FLEXIBILITY)[number])) {
      return { error: 'flexibility must be one of: +, -, +-, *' };
    }
    return { amount, flexibility: body.flexibility as Flexibility };
  }

  return { amount };
}

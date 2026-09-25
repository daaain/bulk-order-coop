import { nanoid } from 'nanoid';

const VALID_STATUSES = ['open', 'closed', 'reconciling', 'complete'] as const;

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['closed'],
  closed: ['reconciling'],
  reconciling: ['complete'],
};

export function validateCreateOrder(
  body: unknown,
): { name: string; catalogueKey: string; deadline?: number } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }

  const { name, catalogueKey, deadline } = body as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '') {
    return { error: 'name is required and must be a non-empty string' };
  }

  if (typeof catalogueKey !== 'string' || catalogueKey.trim() === '') {
    return { error: 'catalogueKey is required and must be a non-empty string' };
  }

  const result: { name: string; catalogueKey: string; deadline?: number } = {
    name: name.trim(),
    catalogueKey: catalogueKey.trim(),
  };

  if (deadline !== undefined) {
    if (typeof deadline !== 'number') {
      return { error: 'deadline must be a number (Unix timestamp)' };
    }
    result.deadline = deadline;
  }

  return result;
}

export interface UpdateOrderInput {
  name?: string;
  deadline?: number | null;
  status?: string;
  discountPercentage?: number | null;
  adminFeePercentage?: number | null;
  invoiceNumber?: string | null;
  invoiceTotal?: number | null;
}

function validatePercentField(
  name: string,
  value: unknown,
): { ok: true; value: number | null } | { error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: `${name} must be a number in [0, 100] or null` };
  }
  if (value < 0 || value > 100) {
    return { error: `${name} must be between 0 and 100` };
  }
  return { ok: true, value };
}

export function validateUpdateOrder(body: unknown): UpdateOrderInput | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }

  const {
    name,
    deadline,
    status,
    discountPercentage,
    adminFeePercentage,
    invoiceNumber,
    invoiceTotal,
  } = body as Record<string, unknown>;

  const result: UpdateOrderInput = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim() === '') {
      return { error: 'name must be a non-empty string' };
    }
    result.name = name.trim();
  }

  if (deadline !== undefined) {
    if (deadline !== null && typeof deadline !== 'number') {
      return { error: 'deadline must be a number or null' };
    }
    result.deadline = deadline as number | null;
  }

  if (status !== undefined) {
    if (typeof status !== 'string' || !(VALID_STATUSES as readonly string[]).includes(status)) {
      return { error: `status must be one of: ${VALID_STATUSES.join(', ')}` };
    }
    result.status = status;
  }

  if (discountPercentage !== undefined) {
    const v = validatePercentField('discountPercentage', discountPercentage);
    if ('error' in v) return { error: v.error };
    result.discountPercentage = v.value;
  }

  if (adminFeePercentage !== undefined) {
    const v = validatePercentField('adminFeePercentage', adminFeePercentage);
    if ('error' in v) return { error: v.error };
    result.adminFeePercentage = v.value;
  }

  if (invoiceNumber !== undefined) {
    if (
      invoiceNumber !== null &&
      (typeof invoiceNumber !== 'string' || invoiceNumber.trim() === '')
    ) {
      return { error: 'invoiceNumber must be a non-empty string or null' };
    }
    result.invoiceNumber = invoiceNumber === null ? null : invoiceNumber.trim();
  }

  if (invoiceTotal !== undefined) {
    if (
      invoiceTotal !== null &&
      (typeof invoiceTotal !== 'number' || !Number.isFinite(invoiceTotal) || invoiceTotal < 0)
    ) {
      return { error: 'invoiceTotal must be a non-negative number or null' };
    }
    result.invoiceTotal = invoiceTotal;
  }

  if (Object.keys(result).length === 0) {
    return {
      error:
        'At least one field (name, deadline, status, discountPercentage, adminFeePercentage, invoiceNumber, invoiceTotal) is required',
    };
  }

  return result;
}

export function validateJoinOrder(body: unknown): { inviteCode: string } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }

  const { inviteCode } = body as Record<string, unknown>;

  if (typeof inviteCode !== 'string' || inviteCode.trim() === '') {
    return { error: 'inviteCode is required and must be a non-empty string' };
  }

  return { inviteCode: inviteCode.trim() };
}

export function isValidStatusTransition(from: string, to: string): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateRoleChange(
  body: unknown,
): { role: 'organiser' | 'member' } | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }

  const { role } = body as Record<string, unknown>;

  if (role !== 'organiser' && role !== 'member') {
    return { error: "role must be 'organiser' or 'member'" };
  }

  return { role };
}

export function generateInviteCode(): string {
  return nanoid(10);
}

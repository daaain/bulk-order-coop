import { nanoid } from 'nanoid';

const VALID_STATUSES = ['open', 'closed', 'reconciling', 'complete'] as const;

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
	open: ['closed'],
	closed: ['reconciling'],
	reconciling: ['complete']
};

export function validateCreateOrder(
	body: unknown
): { name: string; catalogueId: string; deadline?: number } | { error: string } {
	if (!body || typeof body !== 'object') {
		return { error: 'Request body must be an object' };
	}

	const { name, catalogueId, deadline } = body as Record<string, unknown>;

	if (typeof name !== 'string' || name.trim() === '') {
		return { error: 'name is required and must be a non-empty string' };
	}

	if (typeof catalogueId !== 'string' || catalogueId.trim() === '') {
		return { error: 'catalogueId is required and must be a non-empty string' };
	}

	const result: { name: string; catalogueId: string; deadline?: number } = {
		name: name.trim(),
		catalogueId: catalogueId.trim()
	};

	if (deadline !== undefined) {
		if (typeof deadline !== 'number') {
			return { error: 'deadline must be a number (Unix timestamp)' };
		}
		result.deadline = deadline;
	}

	return result;
}

export function validateUpdateOrder(
	body: unknown
): { name?: string; deadline?: number | null; status?: string } | { error: string } {
	if (!body || typeof body !== 'object') {
		return { error: 'Request body must be an object' };
	}

	const { name, deadline, status } = body as Record<string, unknown>;

	const result: { name?: string; deadline?: number | null; status?: string } = {};

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

	if (Object.keys(result).length === 0) {
		return { error: 'At least one field (name, deadline, status) is required' };
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

export function generateInviteCode(): string {
	return nanoid(10);
}

import type { PageLoad } from './$types';
import { lookupInviteCode } from '$lib/orders';

export const load: PageLoad = async ({ params }) => {
	try {
		const preview = await lookupInviteCode(params.code);
		return { code: params.code, preview, error: null };
	} catch (e: any) {
		return { code: params.code, preview: null, error: e.message || 'Invalid invite code' };
	}
};

import type { LayoutLoad } from './$types';
import { fetchOrder } from '$lib/orders';

export const load: LayoutLoad = async ({ params }) => {
	const order = await fetchOrder(params.id);
	return { orderId: params.id, order };
};

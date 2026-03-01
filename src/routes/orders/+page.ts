import type { PageLoad } from './$types';
import { fetchOrders } from '$lib/orders';

export const load: PageLoad = async () => {
	const orders = await fetchOrders();
	return { orders };
};

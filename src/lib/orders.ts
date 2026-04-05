import type { Order, OrderWithMemberCount, OrderDetail, OrderPreview } from '$shared/types';
import { apiFetch } from './api';

export async function fetchOrders(): Promise<OrderWithMemberCount[]> {
  return apiFetch<OrderWithMemberCount[]>('/orders');
}

export async function fetchOrder(id: string): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/orders/${id}`);
}

export async function createOrder(data: {
  name: string;
  catalogueKey: string;
  deadline?: number;
}): Promise<Order> {
  return apiFetch<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateOrder(
  id: string,
  data: { name?: string; deadline?: number | null; status?: string },
): Promise<Order> {
  return apiFetch<Order>(`/orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function joinOrder(orderId: string, inviteCode: string): Promise<Order> {
  return apiFetch<Order>(`/orders/${orderId}/join`, {
    method: 'POST',
    body: JSON.stringify({ inviteCode }),
  });
}

export async function lookupInviteCode(code: string): Promise<OrderPreview> {
  return apiFetch<OrderPreview>(`/orders/join/${code}`);
}

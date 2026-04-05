import { apiFetch } from './api';
import type { ReconciliationSummary, DeliveryItem, Allocation } from '$shared/types';

export function fetchReconciliation(orderId: string): Promise<ReconciliationSummary> {
  return apiFetch(`/orders/${orderId}/reconciliation`);
}

export function updateDeliveryStatus(
  orderId: string,
  itemId: string,
  data: {
    status: string;
    actualQuantity?: number | null;
    actualPrice?: number | null;
    notes?: string | null;
  },
): Promise<{ delivery: DeliveryItem }> {
  return apiFetch(`/orders/${orderId}/items/${itemId}/delivery`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function generateAllocations(orderId: string): Promise<{ count: number }> {
  return apiFetch(`/orders/${orderId}/allocate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function confirmAllocation(orderId: string, allocationId: string): Promise<Allocation> {
  return apiFetch(`/orders/${orderId}/allocations/${allocationId}/confirm`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
}

export function confirmAllMyAllocations(orderId: string): Promise<{ count: number }> {
  return apiFetch(`/orders/${orderId}/confirm-all`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
}

import { apiFetch } from './api';
import type { ParsedCatalogueItem } from '$shared/csv';
import type { EnrichedOrderItem, MyClaim, OrderItem, Claim, RoundingResult } from '$shared/types';

export function fetchOrderItems(orderId: string): Promise<EnrichedOrderItem[]> {
  return apiFetch(`/orders/${orderId}/items`);
}

export function addItemToOrder(
  orderId: string,
  snapshot: ParsedCatalogueItem,
  notes?: string,
): Promise<OrderItem> {
  return apiFetch(`/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify({ ...snapshot, notes }),
  });
}

export function removeItemFromOrder(
  orderId: string,
  itemId: string,
): Promise<{ success: boolean }> {
  return apiFetch(`/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
}

export function createClaim(
  orderId: string,
  itemId: string,
  amount: number,
  flexibility?: string,
): Promise<{ claim: Claim; rounding: RoundingResult }> {
  return apiFetch(`/orders/${orderId}/items/${itemId}/claims`, {
    method: 'POST',
    body: JSON.stringify({ amount, flexibility }),
  });
}

export function updateClaim(
  orderId: string,
  itemId: string,
  amount: number,
  flexibility?: string,
): Promise<{ claim: Claim; rounding: RoundingResult }> {
  return apiFetch(`/orders/${orderId}/items/${itemId}/claims`, {
    method: 'PUT',
    body: JSON.stringify({ amount, flexibility }),
  });
}

export function removeClaim(
  orderId: string,
  itemId: string,
): Promise<{ rounding: RoundingResult }> {
  return apiFetch(`/orders/${orderId}/items/${itemId}/claims`, { method: 'DELETE' });
}

export function fetchMyClaims(
  orderId: string,
): Promise<{ claims: MyClaim[]; totals: { net: number; vat: number; gross: number } }> {
  return apiFetch(`/orders/${orderId}/claims/mine`);
}

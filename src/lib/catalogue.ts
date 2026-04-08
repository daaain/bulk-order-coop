import type { ParsedCatalogueItem } from '$shared/csv';
import { parseCatalogueCsv } from '$shared/csv';
import { storeCatalogue, getCatalogueItems } from './catalogue-db';

export async function loadCatalogue(
  orderId: string,
  catalogueKey: string,
): Promise<ParsedCatalogueItem[]> {
  // Check IndexedDB cache first (namespaced per order)
  const cached = await getCatalogueItems(orderId, catalogueKey);
  if (cached) {
    return cached;
  }

  // Fetch CSV from KV via API
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api/catalogues/${catalogueKey}`, { headers, cache: 'no-store' });

  if (!res.ok) {
    throw new Error('Failed to load catalogue');
  }

  const csvText = await res.text();
  const items = parseCatalogueCsv(csvText);

  // Store in IndexedDB for future use, namespaced by order
  await storeCatalogue(orderId, catalogueKey, items);

  return items;
}

export function searchItems(items: ParsedCatalogueItem[], query: string): ParsedCatalogueItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const haystack = `${item.description} ${item.brand ?? ''} ${item.productCode}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function filterItems(
  items: ParsedCatalogueItem[],
  filters: { organic?: boolean; onOffer?: boolean; brand?: string; activeOnly?: boolean },
): ParsedCatalogueItem[] {
  return items.filter((item) => {
    if (filters.organic && !item.organic) return false;
    if (filters.onOffer && !item.onOffer) return false;
    if (filters.brand && item.brand !== filters.brand) return false;
    if (filters.activeOnly && !item.active) return false;
    return true;
  });
}

export function getUniqueBrands(items: ParsedCatalogueItem[]): string[] {
  const brands = new Set(items.map((i) => i.brand).filter(Boolean) as string[]);
  return [...brands].sort();
}

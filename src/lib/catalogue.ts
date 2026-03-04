import type { ParsedCatalogueItem } from '$shared/csv';
import { parseCatalogueCsv } from '$shared/csv';
import { storeCatalogue, getCatalogueItems } from './catalogue-db';

export async function loadCatalogue(catalogueKey: string): Promise<ParsedCatalogueItem[]> {
	// Check IndexedDB cache first
	const cached = await getCatalogueItems(catalogueKey);
	if (cached) {
		return cached;
	}

	// Fetch CSV from KV via API
	const token = localStorage.getItem('auth_token');
	const headers: Record<string, string> = {};
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	const res = await fetch(`/api/catalogues/${catalogueKey}`, {
		headers,
		cache: 'no-store'
	});

	if (!res.ok) {
		throw new Error('Failed to load catalogue');
	}

	const csvText = await res.text();
	const items = parseCatalogueCsv(csvText);

	// Store in IndexedDB for future use
	await storeCatalogue(catalogueKey, items);

	return items;
}

export function searchItems(items: ParsedCatalogueItem[], query: string): ParsedCatalogueItem[] {
	if (!query.trim()) return items;
	const q = query.toLowerCase();
	return items.filter(
		(item) =>
			item.description.toLowerCase().includes(q) ||
			(item.brand?.toLowerCase().includes(q) ?? false) ||
			item.productCode.includes(q)
	);
}

export function filterItems(
	items: ParsedCatalogueItem[],
	filters: {
		organic?: boolean;
		onOffer?: boolean;
		brand?: string;
		activeOnly?: boolean;
	}
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

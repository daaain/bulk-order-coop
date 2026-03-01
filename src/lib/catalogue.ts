import type { CatalogueItem } from '$shared/types';
import { apiFetch } from './api';

let cachedItems: CatalogueItem[] = [];
let cachedCatalogueId: string | null = null;

export async function loadCatalogue(catalogueId: string): Promise<CatalogueItem[]> {
	if (cachedCatalogueId === catalogueId && cachedItems.length > 0) {
		return cachedItems;
	}
	const data = await apiFetch<{ catalogue: any; items: CatalogueItem[] }>(
		`/catalogues/${catalogueId}`
	);
	cachedItems = data.items;
	cachedCatalogueId = catalogueId;
	return cachedItems;
}

export function searchItems(items: CatalogueItem[], query: string): CatalogueItem[] {
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
	items: CatalogueItem[],
	filters: {
		organic?: boolean;
		brand?: string;
		activeOnly?: boolean;
	}
): CatalogueItem[] {
	return items.filter((item) => {
		if (filters.organic && !item.organic) return false;
		if (filters.brand && item.brand !== filters.brand) return false;
		if (filters.activeOnly && !item.active) return false;
		return true;
	});
}

export function getUniqueBrands(items: CatalogueItem[]): string[] {
	const brands = new Set(items.map((i) => i.brand).filter(Boolean) as string[]);
	return [...brands].sort();
}

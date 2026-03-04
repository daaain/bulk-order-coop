export interface ParsedCatalogueItem {
	productCode: string;
	description: string;
	brand: string;
	organic: boolean;
	casePrice: number;
	vatRate: number;
	vatPerCase: number;
	unitsPerCase: number | null;
	packSize: number;
	unit: string;
	rrp: number | null;
	barcode: string;
	active: boolean;
	onOffer: boolean;
}

// Column indices from the Infinity Foods CSV header:
// 0: Product code
// 1: order column 1
// 2: concatprodsize as text
// 3: organic
// 4: product description
// 5: RRP rounded to 2
// 6: brand
// 7: Change Marker
// 8: Case price
// 9: Vat Marker
// 10: Vat per case
// 11: Barcode inner
// 12: units case
// 13: pk size
// 14: unit
// 15: Vat rating
// 16: Active as a number

const COL = {
	PRODUCT_CODE: 0,
	ORGANIC: 3,
	DESCRIPTION: 4,
	RRP: 5,
	BRAND: 6,
	CHANGE_MARKER: 7,
	CASE_PRICE: 8,
	VAT_PER_CASE: 10,
	BARCODE: 11,
	UNITS_CASE: 12,
	PK_SIZE: 13,
	UNIT: 14,
	VAT_RATING: 15,
	ACTIVE: 16
} as const;

export function parseCatalogueCsv(csv: string): ParsedCatalogueItem[] {
	const lines = csv.replace(/\r\n/g, '\n').split('\n');

	// Skip header line
	const dataLines = lines.slice(1);

	const items: ParsedCatalogueItem[] = [];

	for (const line of dataLines) {
		const trimmed = line.trim();

		// Skip blank lines and non-data rows (e.g. "...")
		if (!trimmed || !trimmed.match(/^\d/)) {
			continue;
		}

		const cols = parseCsvLine(trimmed);

		// Need at least enough columns
		if (cols.length < 17) {
			continue;
		}

		const productCode = cols[COL.PRODUCT_CODE].trim();

		// Filter out 999xxx service request codes
		if (productCode.startsWith('999')) {
			continue;
		}

		const rrpStr = cols[COL.RRP].trim();
		const unitsStr = cols[COL.UNITS_CASE].trim();

		items.push({
			productCode,
			description: cols[COL.DESCRIPTION].trim(),
			brand: cols[COL.BRAND].trim(),
			organic: cols[COL.ORGANIC].trim().toLowerCase() === 'organic',
			casePrice: parseFloat(cols[COL.CASE_PRICE]) || 0,
			vatRate: parseInt(cols[COL.VAT_RATING], 10) || 0,
			vatPerCase: parseFloat(cols[COL.VAT_PER_CASE]) || 0,
			unitsPerCase: unitsStr ? parseInt(unitsStr, 10) : null,
			packSize: parseFloat(cols[COL.PK_SIZE]) || 0,
			unit: cols[COL.UNIT].trim(),
			rrp: rrpStr ? parseFloat(rrpStr) : null,
			barcode: cols[COL.BARCODE].trim(),
			active: cols[COL.ACTIVE].trim() === '1',
			onOffer: cols[COL.CHANGE_MARKER].trim().toLowerCase() === 'r'
		});
	}

	return items;
}

function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			result.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	result.push(current);
	return result;
}

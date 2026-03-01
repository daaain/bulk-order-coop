import { describe, it, expect } from 'vitest';
import { parseCatalogueCsv } from '../server/services/csv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HEADER =
	'Product code,order column 1,concatprodsize as text,organic,product description,RRP rounded to 2,brand,Change Marker,Case price,Vat Marker,Vat per case,Barcode inner,units case,pk size,unit,Vat rating,Active as a number';

function makeCsv(...rows: string[]): string {
	// Simulate the real format: header, blank line, then rows separated by blank lines
	return [HEADER, '', ...rows.flatMap((r) => [r, ''])].join('\n');
}

describe('parseCatalogueCsv', () => {
	describe('basic parsing', () => {
		it('parses a single packaged item correctly', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice - white - Italy,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			);
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(1);

			const item = items[0];
			expect(item.productCode).toBe('1001');
			expect(item.description).toBe('Arborio Rice - white - Italy');
			expect(item.brand).toBe('Infinity Foods');
			expect(item.organic).toBe(true);
			expect(item.casePrice).toBe(15.55);
			expect(item.vatRate).toBe(0);
			expect(item.vatPerCase).toBe(0);
			expect(item.unitsPerCase).toBe(6);
			expect(item.packSize).toBe(500);
			expect(item.unit).toBe('g');
			expect(item.rrp).toBe(3.46);
			expect(item.barcode).toBe('5028869010010');
			expect(item.active).toBe(true);
		});

		it('parses multiple items', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice - white - Italy,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1',
				'1002,,6x500g,organic,Black Rice - Italy,3.49,Infinity Foods,,15.70,,0,5028869010027,6,500,g,0,1'
			);
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(2);
			expect(items[0].productCode).toBe('1001');
			expect(items[1].productCode).toBe('1002');
		});
	});

	describe('blank row handling', () => {
		it('skips blank rows between items', () => {
			const csv = [
				HEADER,
				'',
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1',
				'',
				'',
				'',
				'1002,,6x500g,organic,Black Rice,3.49,Infinity Foods,,15.70,,0,5028869010027,6,500,g,0,1',
				''
			].join('\n');
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(2);
		});

		it('handles CSV with no trailing newline', () => {
			const csv = [
				HEADER,
				'',
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			].join('\n');
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(1);
		});
	});

	describe('999xxx service request filtering', () => {
		it('filters out product codes starting with 999', () => {
			const csv = makeCsv(
				'996120,,500g,,Rosehip Fine Cut,,Infinity Foods,,11.65,V,2.33,5021858372816,,500,g,2,1',
				'999991,,,,PLEASE EMAIL DELIVERY NOTE,,,,0.00,,0,,,,,0,1',
				'999999,,,,PLEASE PHONE WITH OUT OF STOCKS,,,,0.00,,0,,,,,0,1'
			);
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(1);
			expect(items[0].productCode).toBe('996120');
		});
	});

	describe('organic flag', () => {
		it('sets organic to true when column contains "organic"', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			);
			expect(parseCatalogueCsv(csv)[0].organic).toBe(true);
		});

		it('sets organic to false when column is empty', () => {
			const csv = makeCsv(
				'996120,,500g,,Rosehip Fine Cut,,Infinity Foods,,11.65,V,2.33,5021858372816,,500,g,2,1'
			);
			expect(parseCatalogueCsv(csv)[0].organic).toBe(false);
		});
	});

	describe('VAT handling', () => {
		it('parses zero-rated VAT items (no V marker, rating 0)', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			);
			const item = parseCatalogueCsv(csv)[0];
			expect(item.vatRate).toBe(0);
			expect(item.vatPerCase).toBe(0);
		});

		it('parses standard-rate VAT items (V marker, rating 2)', () => {
			const csv = makeCsv(
				'996120,,500g,,Rosehip Fine Cut,,Infinity Foods,,11.65,V,2.33,5021858372816,,500,g,2,1'
			);
			const item = parseCatalogueCsv(csv)[0];
			expect(item.vatRate).toBe(2);
			expect(item.vatPerCase).toBe(2.33);
		});
	});

	describe('packaged vs loose/bulk items', () => {
		it('parses packaged items with units_per_case', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			);
			const item = parseCatalogueCsv(csv)[0];
			expect(item.unitsPerCase).toBe(6);
			expect(item.packSize).toBe(500);
			expect(item.unit).toBe('g');
		});

		it('parses loose/bulk items with no units_per_case', () => {
			const csv = makeCsv(
				'996120,,500g,,Rosehip Fine Cut,,Infinity Foods,,11.65,V,2.33,5021858372816,,500,g,2,1'
			);
			const item = parseCatalogueCsv(csv)[0];
			expect(item.unitsPerCase).toBeNull();
			expect(item.packSize).toBe(500);
			expect(item.unit).toBe('g');
		});

		it('parses kg items correctly', () => {
			const csv = makeCsv(
				'1010,,6x1kg,organic,Brown Rice Short Grain - Italy,3.86,Infinity Foods,,17.35,,0,5028869010102,6,1,kg,0,1'
			);
			const item = parseCatalogueCsv(csv)[0];
			expect(item.unitsPerCase).toBe(6);
			expect(item.packSize).toBe(1);
			expect(item.unit).toBe('kg');
		});
	});

	describe('active flag', () => {
		it('sets active to true when "Active as a number" is 1', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			);
			expect(parseCatalogueCsv(csv)[0].active).toBe(true);
		});

		it('sets active to false when "Active as a number" is 0', () => {
			const csv = makeCsv(
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,0'
			);
			expect(parseCatalogueCsv(csv)[0].active).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('handles missing RRP (empty field)', () => {
			const csv = makeCsv(
				'996120,,500g,,Rosehip Fine Cut,,Infinity Foods,,11.65,V,2.33,5021858372816,,500,g,2,1'
			);
			const item = parseCatalogueCsv(csv)[0];
			expect(item.rrp).toBeNull();
		});

		it('handles missing brand (empty field)', () => {
			const csv = makeCsv('1001,,6x500g,organic,Some Product,3.46,,,15.55,,0,123,6,500,g,0,1');
			const item = parseCatalogueCsv(csv)[0];
			expect(item.brand).toBe('');
		});

		it('handles rows with ellipsis or non-data content gracefully', () => {
			const csv = [HEADER, '', '...', '', '1001,,6x500g,organic,Rice,3.46,IF,,15.55,,0,123,6,500,g,0,1'].join(
				'\n'
			);
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(1);
			expect(items[0].productCode).toBe('1001');
		});

		it('handles Windows-style line endings (CRLF)', () => {
			const csv = [
				HEADER,
				'',
				'1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1'
			].join('\r\n');
			const items = parseCatalogueCsv(csv);
			expect(items).toHaveLength(1);
			expect(items[0].active).toBe(true);
		});
	});

	describe('real file parsing', () => {
		it('parses the actual invcat2.csv sample file', () => {
			const csv = readFileSync(resolve(__dirname, 'fixtures/invcat2.csv'), 'utf-8');
			const items = parseCatalogueCsv(csv);

			// Should have 7 real products (996120, 996122) but not the 999xxx service requests
			expect(items.length).toBeGreaterThanOrEqual(7);

			// No 999xxx items should be present
			const serviceItems = items.filter((i) => i.productCode.startsWith('999'));
			expect(serviceItems).toHaveLength(0);

			// Check first item
			const first = items.find((i) => i.productCode === '1001');
			expect(first).toBeDefined();
			expect(first!.description).toBe('Arborio Rice - white - Italy');
			expect(first!.organic).toBe(true);
			expect(first!.casePrice).toBe(15.55);

			// Check a VAT item
			const vatItem = items.find((i) => i.productCode === '996120');
			expect(vatItem).toBeDefined();
			expect(vatItem!.vatRate).toBe(2);
			expect(vatItem!.vatPerCase).toBe(2.33);
			expect(vatItem!.description).toBe('Rosehip Fine Cut');

			// Check a loose item
			const looseItem = items.find((i) => i.productCode === '996122');
			expect(looseItem).toBeDefined();
			expect(looseItem!.unitsPerCase).toBeNull();
			expect(looseItem!.packSize).toBe(1);
			expect(looseItem!.unit).toBe('kg');
		});
	});
});

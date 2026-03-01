import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
	setupMiniflare,
	teardownMiniflare,
	resetDatabase,
	appFetch,
	seedCatalogue,
	getDb
} from './helpers';

const CSV_CONTENT = `Product code,order column 1,concatprodsize as text,organic,product description,RRP rounded to 2,brand,Change Marker,Case price,Vat Marker,Vat per case,Barcode inner,units case,pk size,unit,Vat rating,Active as a number
1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1`;

describe('Catalogue routes', () => {
	beforeAll(setupMiniflare);
	afterAll(teardownMiniflare);
	beforeEach(resetDatabase);

	function insertSystemMember() {
		const now = Math.floor(Date.now() / 1000);
		return getDb()
			.prepare(
				'INSERT OR IGNORE INTO members (id, email, name, initials, created_at) VALUES (?, ?, ?, ?, ?)'
			)
			.bind('system', 'system@test.local', 'System', 'SYS', now)
			.run();
	}

	describe('POST /catalogues', () => {
		it('creates a catalogue from valid CSV form data', async () => {
			await insertSystemMember();

			const form = new FormData();
			form.append('name', 'Test Cat');
			form.append('file', new File([CSV_CONTENT], 'test.csv', { type: 'text/csv' }));

			const res = await appFetch('/catalogues', { method: 'POST', body: form });
			expect(res.status).toBe(201);

			const body = (await res.json()) as { id: string; name: string; itemCount: number };
			expect(body.id).toBeDefined();
			expect(body.name).toBe('Test Cat');
			expect(body.itemCount).toBe(1);
		});

		it('rejects request with missing file', async () => {
			await insertSystemMember();

			const form = new FormData();
			form.append('name', 'No File Catalogue');

			const res = await appFetch('/catalogues', { method: 'POST', body: form });
			expect(res.status).toBe(400);

			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/file/i);
		});
	});

	describe('GET /catalogues', () => {
		it('returns an array of catalogues', async () => {
			await seedCatalogue();

			const res = await appFetch('/catalogues');
			expect(res.status).toBe(200);

			const body = (await res.json()) as Array<{ id: string; name: string; itemCount: number }>;
			expect(Array.isArray(body)).toBe(true);
			expect(body.length).toBe(1);
			expect(body[0].name).toBe('Test Catalogue');
			expect(body[0].itemCount).toBeGreaterThan(0);
		});
	});

	describe('GET /catalogues/:id', () => {
		it('returns a catalogue with its items', async () => {
			const { catalogueId, itemCount } = await seedCatalogue();

			const res = await appFetch(`/catalogues/${catalogueId}`);
			expect(res.status).toBe(200);

			const body = (await res.json()) as {
				id: string;
				name: string;
				items: Array<{ id: string; productCode: string }>;
			};
			expect(body.id).toBe(catalogueId);
			expect(body.items).toHaveLength(itemCount);
		});

		it('returns 404 for a non-existent catalogue', async () => {
			const res = await appFetch('/catalogues/nonexistent-id');
			expect(res.status).toBe(404);

			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/not found/i);
		});
	});
});

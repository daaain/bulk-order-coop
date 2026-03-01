import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Bindings } from '../index';
import { catalogues, catalogueItems } from '../../db/schema';
import { parseCatalogueCsv } from '../services/csv';

const app = new Hono<{ Bindings: Bindings }>();

// POST / — Upload a catalogue CSV
app.post('/', async (c) => {
	const db = drizzle(c.env.DB);
	const formData = await c.req.formData();

	const name = formData.get('name');
	if (!name || typeof name !== 'string') {
		return c.json({ error: 'Missing required field: name' }, 400);
	}

	const file = formData.get('file');
	if (!file || !(file instanceof File)) {
		return c.json({ error: 'Missing required field: file' }, 400);
	}

	const csvText = await file.text();
	const parsedItems = parseCatalogueCsv(csvText);

	if (parsedItems.length === 0) {
		return c.json({ error: 'CSV contained no valid items' }, 400);
	}

	const catalogueId = nanoid();
	const now = Math.floor(Date.now() / 1000);

	// Insert the catalogue record
	await db.insert(catalogues).values({
		id: catalogueId,
		name,
		uploadedBy: 'system',
		uploadedAt: now,
		itemCount: parsedItems.length
	});

	// Insert items in batches (D1/SQLite limits 100 bound parameters per query; 15 columns × 6 = 90)
	const BATCH_SIZE = 6;
	for (let i = 0; i < parsedItems.length; i += BATCH_SIZE) {
		const batch = parsedItems.slice(i, i + BATCH_SIZE);
		await db.insert(catalogueItems).values(
			batch.map((item) => ({
				id: nanoid(),
				catalogueId,
				productCode: item.productCode,
				description: item.description,
				brand: item.brand,
				organic: item.organic ? 1 : 0,
				casePrice: item.casePrice,
				vatRate: item.vatRate,
				vatPerCase: item.vatPerCase,
				unitsPerCase: item.unitsPerCase,
				packSize: item.packSize,
				unit: item.unit,
				rrp: item.rrp,
				barcode: item.barcode,
				active: item.active ? 1 : 0
			}))
		);
	}

	return c.json({ id: catalogueId, name, itemCount: parsedItems.length }, 201);
});

// GET / — List all catalogues
app.get('/', async (c) => {
	const db = drizzle(c.env.DB);

	const allCatalogues = await db
		.select({
			id: catalogues.id,
			name: catalogues.name,
			uploadedAt: catalogues.uploadedAt,
			itemCount: catalogues.itemCount
		})
		.from(catalogues);

	return c.json(allCatalogues);
});

// GET /:id — Get a single catalogue with all its items
app.get('/:id', async (c) => {
	const db = drizzle(c.env.DB);
	const id = c.req.param('id');

	const [catalogue] = await db
		.select()
		.from(catalogues)
		.where(eq(catalogues.id, id));

	if (!catalogue) {
		return c.json({ error: 'Catalogue not found' }, 404);
	}

	const items = await db
		.select()
		.from(catalogueItems)
		.where(eq(catalogueItems.catalogueId, id));

	c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

	return c.json({ ...catalogue, items });
});

export default app;

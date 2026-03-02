import { Hono } from 'hono';
import type { Bindings } from '../index';
import { parseCatalogueCsv } from '../../shared/csv';

const app = new Hono<{ Bindings: Bindings }>();

// POST / — Upload a catalogue CSV to R2
app.post('/', async (c) => {
	const formData = await c.req.formData();

	const file = formData.get('file');
	if (!file || !(file instanceof File)) {
		return c.json({ error: 'Missing required field: file' }, 400);
	}

	const csvText = await file.text();
	const parsedItems = parseCatalogueCsv(csvText);

	if (parsedItems.length === 0) {
		return c.json({ error: 'CSV contained no valid items' }, 400);
	}

	const key = `${Date.now()}-${file.name}`;
	await c.env.CATALOGUE_BUCKET.put(key, csvText);

	return c.json({ key, itemCount: parsedItems.length }, 201);
});

// GET /:key{.+} — Serve CSV from R2
app.get('/:key{.+}', async (c) => {
	const key = c.req.param('key');
	const object = await c.env.CATALOGUE_BUCKET.get(key);

	if (!object) {
		return c.json({ error: 'Catalogue not found' }, 404);
	}

	c.header('Content-Type', 'text/csv');
	c.header('Cache-Control', 'public, max-age=31536000, immutable');

	return c.body(await object.text());
});

export default app;

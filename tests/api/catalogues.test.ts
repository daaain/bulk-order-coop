import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupMiniflare,
  teardownMiniflare,
  resetDatabase,
  appFetch,
  seedCatalogue,
} from './helpers';

const CSV_CONTENT = `Product code,order column 1,concatprodsize as text,organic,product description,RRP rounded to 2,brand,Change Marker,Case price,Vat Marker,Vat per case,Barcode inner,units case,pk size,unit,Vat rating,Active as a number
1001,,6x500g,organic,Arborio Rice,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1`;

describe('Catalogue routes', () => {
  beforeAll(setupMiniflare);
  afterAll(teardownMiniflare);
  beforeEach(resetDatabase);

  describe('POST /catalogues', () => {
    it('uploads CSV to R2 and returns key + itemCount', async () => {
      const form = new FormData();
      form.append('file', new File([CSV_CONTENT], 'test.csv', { type: 'text/csv' }));

      const res = await appFetch('/catalogues', { method: 'POST', body: form });
      expect(res.status).toBe(201);

      const body = (await res.json()) as { key: string; itemCount: number };
      expect(body.key).toBeDefined();
      expect(body.key).toContain('test.csv');
      expect(body.itemCount).toBe(1);
    });

    it('rejects request with missing file', async () => {
      const form = new FormData();

      const res = await appFetch('/catalogues', { method: 'POST', body: form });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/file/i);
    });

    it('rejects CSV with no valid items', async () => {
      const form = new FormData();
      form.append('file', new File(['just,a,header\n'], 'empty.csv', { type: 'text/csv' }));

      const res = await appFetch('/catalogues', { method: 'POST', body: form });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/no valid items/i);
    });
  });

  describe('GET /catalogues/:key', () => {
    it('serves CSV from R2 with correct content type', async () => {
      const { catalogueKey } = await seedCatalogue();

      const res = await appFetch(`/catalogues/${catalogueKey}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/csv');

      const text = await res.text();
      expect(text).toContain('Product code');
      expect(text).toContain('1001');
    });

    it('returns 404 for non-existent key', async () => {
      const res = await appFetch('/catalogues/nonexistent-key.csv');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not found/i);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  storeCatalogue,
  getCatalogueItems,
  __resetCatalogueDbForTests,
} from '../src/lib/catalogue-db';
import type { ParsedCatalogueItem } from '../shared/csv';

function makeItems(productCode: string): ParsedCatalogueItem[] {
  return [
    {
      productCode,
      description: `Item ${productCode}`,
      brand: 'Test',
      casePrice: 10,
      vatRate: 0,
      vatPerCase: 0,
      packSize: 1,
      unit: 'kg',
      unitsPerCase: 1,
      organic: false,
      onOffer: false,
      active: true,
      rrp: 0,
      barcode: '',
    },
  ];
}

describe('catalogue-db', () => {
  beforeEach(() => {
    // Reset IndexedDB and the cached db promise between tests
    globalThis.indexedDB = new IDBFactory();
    __resetCatalogueDbForTests();
  });

  describe('per-order namespacing', () => {
    it('stores catalogues separately per orderId, even when catalogueKey differs', async () => {
      await storeCatalogue('order-1', 'cat-a', makeItems('A1'));
      await storeCatalogue('order-2', 'cat-b', makeItems('B1'));

      const order1 = await getCatalogueItems('order-1', 'cat-a');
      const order2 = await getCatalogueItems('order-2', 'cat-b');

      expect(order1?.[0]?.productCode).toBe('A1');
      expect(order2?.[0]?.productCode).toBe('B1');
    });

    it('returns null when catalogueKey does not match the stored entry for the order', async () => {
      await storeCatalogue('order-1', 'cat-a', makeItems('A1'));
      const result = await getCatalogueItems('order-1', 'cat-different');
      expect(result).toBeNull();
    });

    it('overwrites when storing the same orderId twice', async () => {
      await storeCatalogue('order-1', 'cat-a', makeItems('A1'));
      await storeCatalogue('order-1', 'cat-a', makeItems('A2'));
      const result = await getCatalogueItems('order-1', 'cat-a');
      expect(result).toHaveLength(1);
      expect(result?.[0]?.productCode).toBe('A2');
    });
  });

  describe('LRU eviction', () => {
    it('keeps only the 3 most recently stored orders', async () => {
      await storeCatalogue('order-1', 'cat-1', makeItems('1'));
      await new Promise((r) => setTimeout(r, 2));
      await storeCatalogue('order-2', 'cat-2', makeItems('2'));
      await new Promise((r) => setTimeout(r, 2));
      await storeCatalogue('order-3', 'cat-3', makeItems('3'));
      await new Promise((r) => setTimeout(r, 2));
      await storeCatalogue('order-4', 'cat-4', makeItems('4'));

      expect(await getCatalogueItems('order-1', 'cat-1')).toBeNull();
      expect(await getCatalogueItems('order-2', 'cat-2')).not.toBeNull();
      expect(await getCatalogueItems('order-3', 'cat-3')).not.toBeNull();
      expect(await getCatalogueItems('order-4', 'cat-4')).not.toBeNull();
    });

    it('evicts the oldest by storedAt, not by insertion order', async () => {
      await storeCatalogue('order-1', 'cat-1', makeItems('1'));
      await new Promise((r) => setTimeout(r, 2));
      await storeCatalogue('order-2', 'cat-2', makeItems('2'));
      await new Promise((r) => setTimeout(r, 2));
      await storeCatalogue('order-3', 'cat-3', makeItems('3'));
      await new Promise((r) => setTimeout(r, 2));
      // Re-store order-1 → it becomes the most recent
      await storeCatalogue('order-1', 'cat-1', makeItems('1b'));
      await new Promise((r) => setTimeout(r, 2));
      // Adding a 4th distinct order should now evict order-2 (the oldest)
      await storeCatalogue('order-4', 'cat-4', makeItems('4'));

      expect(await getCatalogueItems('order-2', 'cat-2')).toBeNull();
      expect(await getCatalogueItems('order-1', 'cat-1')).not.toBeNull();
      expect(await getCatalogueItems('order-3', 'cat-3')).not.toBeNull();
      expect(await getCatalogueItems('order-4', 'cat-4')).not.toBeNull();
    });
  });
});

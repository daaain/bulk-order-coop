import { openDB, type IDBPDatabase } from 'idb';
import type { ParsedCatalogueItem } from '$shared/csv';

interface CatalogueDB {
  catalogues: {
    key: string;
    value: { key: string; items: ParsedCatalogueItem[]; storedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<CatalogueDB>> | null = null;

function openCatalogueDB(): Promise<IDBPDatabase<CatalogueDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatalogueDB>('catalogue-cache', 2, {
      upgrade(db) {
        if (db.objectStoreNames.contains('catalogues')) {
          db.deleteObjectStore('catalogues');
        }
        db.createObjectStore('catalogues', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

export async function storeCatalogue(key: string, items: ParsedCatalogueItem[]): Promise<void> {
  const db = await openCatalogueDB();
  await db.put('catalogues', { key, items, storedAt: Date.now() });
}

export async function getCatalogueItems(key: string): Promise<ParsedCatalogueItem[] | null> {
  const db = await openCatalogueDB();
  const entry = await db.get('catalogues', key);
  return entry?.items ?? null;
}

export async function getCatalogueMeta(key: string): Promise<{ storedAt: number } | null> {
  const db = await openCatalogueDB();
  const entry = await db.get('catalogues', key);
  return entry ? { storedAt: entry.storedAt } : null;
}

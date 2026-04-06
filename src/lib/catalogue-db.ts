import { openDB, type IDBPDatabase } from 'idb';
import type { ParsedCatalogueItem } from '$shared/csv';

interface CatalogueEntry {
  orderId: string;
  catalogueKey: string;
  items: ParsedCatalogueItem[];
  storedAt: number;
}

interface CatalogueDB {
  catalogues: {
    key: string;
    value: CatalogueEntry;
  };
}

const MAX_CACHED_ORDERS = 3;

let dbPromise: Promise<IDBPDatabase<CatalogueDB>> | null = null;

function openCatalogueDB(): Promise<IDBPDatabase<CatalogueDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CatalogueDB>('catalogue-cache', 3, {
      upgrade(db) {
        if (db.objectStoreNames.contains('catalogues')) {
          db.deleteObjectStore('catalogues');
        }
        db.createObjectStore('catalogues', { keyPath: 'orderId' });
      },
    });
  }
  return dbPromise;
}

export async function storeCatalogue(
  orderId: string,
  catalogueKey: string,
  items: ParsedCatalogueItem[],
): Promise<void> {
  const db = await openCatalogueDB();
  await db.put('catalogues', { orderId, catalogueKey, items, storedAt: Date.now() });
  await evictOldest(db);
}

export async function getCatalogueItems(
  orderId: string,
  catalogueKey: string,
): Promise<ParsedCatalogueItem[] | null> {
  const db = await openCatalogueDB();
  const entry = await db.get('catalogues', orderId);
  if (!entry || entry.catalogueKey !== catalogueKey) return null;
  return entry.items;
}

async function evictOldest(db: IDBPDatabase<CatalogueDB>): Promise<void> {
  const all = await db.getAll('catalogues');
  if (all.length <= MAX_CACHED_ORDERS) return;
  const sorted = [...all].sort((a, b) => a.storedAt - b.storedAt);
  const toEvict = sorted.slice(0, all.length - MAX_CACHED_ORDERS);
  await Promise.all(toEvict.map((entry) => db.delete('catalogues', entry.orderId)));
}

// Test-only: reset the cached DB connection so a fresh IDBFactory takes effect.
export function __resetCatalogueDbForTests(): void {
  dbPromise = null;
}

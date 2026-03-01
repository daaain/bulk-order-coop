import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import app, { type Bindings } from '../../server/index';
import { signJwt } from '../../server/services/jwt';

let mf: Miniflare;
let db: D1Database;

const JWT_SECRET = 'test-secret';

// Small CSV fixture with 5 items (matches Infinity Foods format)
const TEST_CSV = `Product code,order column 1,concatprodsize as text,organic,product description,RRP rounded to 2,brand,Change Marker,Case price,Vat Marker,Vat per case,Barcode inner,units case,pk size,unit,Vat rating,Active as a number
1001,,6x500g,organic,Arborio Rice - white - Italy,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1
1002,,6x500g,organic,Black Rice - Italy,3.49,Infinity Foods,,15.70,,0,5028869010027,6,500,g,0,1
1003,,6x500g,organic,Amaranth Seed,2.73,Infinity Foods,,12.30,,0,5028869010034,6,500,g,0,1
1005,,6x500g,organic,Brown Rice Short Grain - Italy,2.09,Infinity Foods,,9.40,,0,5028869010058,6,500,g,0,1
2050,,6x400g,,Chopped Tomatoes,1.29,Biona,,6.45,V,1.29,5028869020503,6,400,g,2,1`;

export async function setupMiniflare() {
	mf = new Miniflare({
		modules: true,
		d1Databases: ['DB'],
		script: 'export default { fetch() { return new Response("") } }'
	});
	db = await mf.getD1Database('DB') as unknown as D1Database;

	const migrationPath = resolve(process.cwd(), 'db/migrations/0000_puzzling_leech.sql');
	const raw = readFileSync(migrationPath, 'utf-8');
	// Strip Drizzle statement-breakpoint markers and collapse to semicolon-delimited statements
	// D1 exec splits on \n so each statement must be a single line
	const statements = raw
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const stmt of statements) {
		const oneLine = stmt.replace(/\n/g, ' ').replace(/\t/g, ' ');
		await db.exec(oneLine);
	}
}

export async function teardownMiniflare() {
	await mf?.dispose();
}

// Tables in reverse dependency order for clean deletes
const TABLES = [
	'allocations',
	'delivery_items',
	'claims',
	'order_items',
	'order_members',
	'orders',
	'catalogue_items',
	'catalogues',
	'auth_tokens',
	'members'
];

export async function resetDatabase() {
	for (const table of TABLES) {
		await db.exec(`DELETE FROM ${table}`);
	}
}

export async function appFetch(path: string, init?: RequestInit): Promise<Response> {
	const bindings = {
		DB: db,
		JWT_SECRET,
		RESEND_API_KEY: 're_xxx'
	} as unknown as Bindings;

	return app.fetch(
		new Request(`http://localhost/api${path}`, init),
		bindings
	);
}

export async function authFetch(
	path: string,
	memberId: string,
	email: string,
	init?: RequestInit
): Promise<Response> {
	const jwt = await signJwt({ sub: memberId, email }, JWT_SECRET);
	const headers = new Headers(init?.headers);
	headers.set('Authorization', `Bearer ${jwt}`);
	return appFetch(path, { ...init, headers });
}

export async function seedMember(
	email: string,
	name?: string,
	initials?: string
): Promise<{ id: string; jwt: string }> {
	const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const now = Math.floor(Date.now() / 1000);
	await db
		.prepare('INSERT INTO members (id, email, name, initials, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(id, email, name ?? null, initials ?? null, now)
		.run();
	const jwt = await signJwt({ sub: id, email }, JWT_SECRET);
	return { id, jwt };
}

export async function seedCatalogue(): Promise<{ catalogueId: string; itemCount: number }> {
	// Create "system" member for the uploadedBy FK
	await db
		.prepare('INSERT OR IGNORE INTO members (id, email, name, initials, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind('system', 'system@test.local', 'System', 'SYS', Math.floor(Date.now() / 1000))
		.run();

	const formData = new FormData();
	formData.append('name', 'Test Catalogue');
	formData.append('file', new File([TEST_CSV], 'test.csv', { type: 'text/csv' }));

	const res = await appFetch('/catalogues', {
		method: 'POST',
		body: formData
	});

	const data = await res.json() as { id: string; itemCount: number };
	return { catalogueId: data.id, itemCount: data.itemCount };
}

export function getDb(): D1Database {
	return db;
}

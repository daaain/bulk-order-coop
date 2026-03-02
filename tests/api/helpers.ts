import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import app, { type Bindings } from '../../server/index';
import { signJwt } from '../../server/services/jwt';

let mf: Miniflare;
let db: D1Database;
let r2: R2Bucket;

const JWT_SECRET = 'test-secret';

// Small CSV fixture with 5 items (matches Infinity Foods format)
const TEST_CSV = `Product code,order column 1,concatprodsize as text,organic,product description,RRP rounded to 2,brand,Change Marker,Case price,Vat Marker,Vat per case,Barcode inner,units case,pk size,unit,Vat rating,Active as a number
1001,,6x500g,organic,Arborio Rice - white - Italy,3.46,Infinity Foods,,15.55,,0,5028869010010,6,500,g,0,1
1002,,6x500g,organic,Black Rice - Italy,3.49,Infinity Foods,,15.70,,0,5028869010027,6,500,g,0,1
1003,,6x500g,organic,Amaranth Seed,2.73,Infinity Foods,,12.30,,0,5028869010034,6,500,g,0,1
1005,,6x500g,organic,Brown Rice Short Grain - Italy,2.09,Infinity Foods,,9.40,,0,5028869010058,6,500,g,0,1
2050,,6x400g,,Chopped Tomatoes,1.29,Biona,,6.45,V,1.29,5028869020503,6,400,g,2,1`;

/** Product snapshots matching the TEST_CSV data, keyed by productCode */
export const TEST_ITEMS: Record<string, Record<string, unknown>> = {
	'1001': {
		productCode: '1001',
		description: 'Arborio Rice - white - Italy',
		brand: 'Infinity Foods',
		organic: true,
		casePrice: 15.55,
		vatRate: 0,
		vatPerCase: 0,
		unitsPerCase: 6,
		packSize: 500,
		unit: 'g',
		rrp: 3.46,
		barcode: '5028869010010'
	},
	'1002': {
		productCode: '1002',
		description: 'Black Rice - Italy',
		brand: 'Infinity Foods',
		organic: true,
		casePrice: 15.70,
		vatRate: 0,
		vatPerCase: 0,
		unitsPerCase: 6,
		packSize: 500,
		unit: 'g',
		rrp: 3.49,
		barcode: '5028869010027'
	},
	'1003': {
		productCode: '1003',
		description: 'Amaranth Seed',
		brand: 'Infinity Foods',
		organic: true,
		casePrice: 12.30,
		vatRate: 0,
		vatPerCase: 0,
		unitsPerCase: 6,
		packSize: 500,
		unit: 'g',
		rrp: 2.73,
		barcode: '5028869010034'
	},
	'1005': {
		productCode: '1005',
		description: 'Brown Rice Short Grain - Italy',
		brand: 'Infinity Foods',
		organic: true,
		casePrice: 9.40,
		vatRate: 0,
		vatPerCase: 0,
		unitsPerCase: 6,
		packSize: 500,
		unit: 'g',
		rrp: 2.09,
		barcode: '5028869010058'
	},
	'2050': {
		productCode: '2050',
		description: 'Chopped Tomatoes',
		brand: 'Biona',
		organic: false,
		casePrice: 6.45,
		vatRate: 2,
		vatPerCase: 1.29,
		unitsPerCase: 6,
		packSize: 400,
		unit: 'g',
		rrp: 1.29,
		barcode: '5028869020503'
	}
};

export async function setupMiniflare() {
	mf = new Miniflare({
		modules: true,
		d1Databases: ['DB'],
		r2Buckets: ['CATALOGUE_BUCKET'],
		script: 'export default { fetch() { return new Response("") } }'
	});
	db = await mf.getD1Database('DB') as unknown as D1Database;
	r2 = await mf.getR2Bucket('CATALOGUE_BUCKET') as unknown as R2Bucket;

	const migrationPath = resolve(process.cwd(), 'db/migrations/0000_famous_pete_wisdom.sql');
	const raw = readFileSync(migrationPath, 'utf-8');
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
	'auth_tokens',
	'members'
];

export async function resetDatabase() {
	for (const table of TABLES) {
		await db.exec(`DELETE FROM ${table}`);
	}

	// Clear R2 bucket
	const listed = await r2.list();
	for (const obj of listed.objects) {
		await r2.delete(obj.key);
	}
}

export async function appFetch(path: string, init?: RequestInit): Promise<Response> {
	const bindings = {
		DB: db,
		CATALOGUE_BUCKET: r2,
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

export async function seedCatalogueInR2(): Promise<{ catalogueKey: string }> {
	const key = `test-${Date.now()}.csv`;
	await r2.put(key, TEST_CSV);
	return { catalogueKey: key };
}

/** Add an order item with a full product snapshot via the API */
export async function seedOrderItem(
	orderId: string,
	memberId: string,
	email: string,
	productCode: string
): Promise<{ id: string }> {
	const snapshot = TEST_ITEMS[productCode];
	if (!snapshot) throw new Error(`No test item for product code: ${productCode}`);

	const res = await authFetch(
		`/orders/${orderId}/items`,
		memberId,
		email,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(snapshot)
		}
	);
	const body = await res.json() as { id: string };
	return { id: body.id };
}

export function getDb(): D1Database {
	return db;
}

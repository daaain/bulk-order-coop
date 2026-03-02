#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

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

function findD1Database(): string {
	const base = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
	if (!existsSync(base)) throw new Error(`D1 directory not found: ${base}`);

	const entries = readdirSync(base);
	for (const entry of entries) {
		const fullPath = join(base, entry);
		// Direct .sqlite file (e.g. <hash>.sqlite)
		if (entry.endsWith('.sqlite')) return fullPath;
		// Subdirectory containing db.sqlite
		const dbPath = join(fullPath, 'db.sqlite');
		if (existsSync(dbPath)) return dbPath;
	}
	throw new Error('D1 database file not found');
}

const command = process.argv[2];
const dbPath = findD1Database();
const db = new Database(dbPath);

switch (command) {
	case 'get-token': {
		const email = process.argv[3];
		if (!email) {
			console.error('Usage: db-helper.ts get-token <email>');
			process.exit(1);
		}
		const row = db
			.query(
				'SELECT token FROM auth_tokens WHERE email = ? AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1'
			)
			.get(email) as { token: string } | null;
		if (!row) {
			console.error(`No unused token found for ${email}`);
			process.exit(1);
		}
		console.log(row.token);
		break;
	}
	case 'clear': {
		for (const table of TABLES) {
			db.run(`DELETE FROM ${table}`);
		}
		console.log('Database cleared');
		break;
	}
	case 'clear-member': {
		const emailToClear = process.argv[3];
		if (!emailToClear) {
			console.error('Usage: db-helper.ts clear-member <email>');
			process.exit(1);
		}
		// Delete auth tokens for this email
		db.run('DELETE FROM auth_tokens WHERE email = ?', [emailToClear]);
		// Delete member by email (cascading won't work, so just delete the member)
		db.run('DELETE FROM members WHERE email = ?', [emailToClear]);
		console.log(`Cleared member ${emailToClear}`);
		break;
	}
	case 'seed-member': {
		const email = process.argv[3];
		const name = process.argv[4];
		const initials = process.argv[5];
		if (!email || !name || !initials) {
			console.error('Usage: db-helper.ts seed-member <email> <name> <initials>');
			process.exit(1);
		}
		const id = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const now = Math.floor(Date.now() / 1000);
		db.run(
			'INSERT INTO members (id, email, name, initials, created_at) VALUES (?, ?, ?, ?, ?)',
			[id, email, name, initials, now]
		);
		console.log(id);
		break;
	}
	case 'count-claims': {
		const rows = db.query('SELECT c.id, c.member_id, c.amount, oi.order_id FROM claims c JOIN order_items oi ON c.order_item_id = oi.id').all();
		console.log(JSON.stringify(rows));
		break;
	}
	default:
		console.error('Unknown command:', command);
		process.exit(1);
}

db.close();

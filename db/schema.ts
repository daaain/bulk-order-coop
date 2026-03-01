import { sqliteTable, text, integer, real, unique, primaryKey } from 'drizzle-orm/sqlite-core';

// ── members ── registered users ──────────────────────────────────────────────

export const members = sqliteTable('members', {
	id: text('id').primaryKey(),
	email: text('email').unique().notNull(),
	name: text('name'),
	initials: text('initials'),
	createdAt: integer('created_at').notNull()
});

// ── auth_tokens ── magic-link tokens ─────────────────────────────────────────

export const authTokens = sqliteTable('auth_tokens', {
	id: text('id').primaryKey(),
	email: text('email').notNull(),
	token: text('token').unique().notNull(),
	expiresAt: integer('expires_at').notNull(),
	usedAt: integer('used_at')
});

// ── catalogues ── uploaded catalogue versions ────────────────────────────────

export const catalogues = sqliteTable('catalogues', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	uploadedBy: text('uploaded_by')
		.references(() => members.id)
		.notNull(),
	uploadedAt: integer('uploaded_at').notNull(),
	itemCount: integer('item_count').notNull()
});

// ── catalogue_items ── individual products in a catalogue ────────────────────

export const catalogueItems = sqliteTable(
	'catalogue_items',
	{
		id: text('id').primaryKey(),
		catalogueId: text('catalogue_id')
			.references(() => catalogues.id)
			.notNull(),
		productCode: text('product_code').notNull(),
		description: text('description').notNull(),
		brand: text('brand'),
		organic: integer('organic'),
		casePrice: real('case_price').notNull(),
		vatRate: integer('vat_rate').notNull(),
		vatPerCase: real('vat_per_case').notNull(),
		unitsPerCase: integer('units_per_case'),
		packSize: real('pack_size').notNull(),
		unit: text('unit').notNull(),
		rrp: real('rrp'),
		barcode: text('barcode'),
		active: integer('active').notNull()
	},
	(table) => [unique().on(table.catalogueId, table.productCode)]
);

// ── orders ── a bulk order event ─────────────────────────────────────────────

export const orders = sqliteTable('orders', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	catalogueId: text('catalogue_id')
		.references(() => catalogues.id)
		.notNull(),
	status: text('status').notNull(),
	deadline: integer('deadline'),
	inviteCode: text('invite_code').unique().notNull(),
	createdBy: text('created_by')
		.references(() => members.id)
		.notNull(),
	createdAt: integer('created_at').notNull()
});

// ── order_members ── who's part of an order ──────────────────────────────────

export const orderMembers = sqliteTable(
	'order_members',
	{
		orderId: text('order_id')
			.references(() => orders.id)
			.notNull(),
		memberId: text('member_id')
			.references(() => members.id)
			.notNull(),
		role: text('role').notNull(),
		joinedAt: integer('joined_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.orderId, table.memberId] })
	]
);

// ── order_items ── catalogue items added to an order ─────────────────────────

export const orderItems = sqliteTable(
	'order_items',
	{
		id: text('id').primaryKey(),
		orderId: text('order_id')
			.references(() => orders.id)
			.notNull(),
		productCode: text('product_code').notNull(),
		addedBy: text('added_by')
			.references(() => members.id)
			.notNull(),
		addedAt: integer('added_at').notNull(),
		notes: text('notes')
	},
	(table) => [unique().on(table.orderId, table.productCode)]
);

// ── claims ── a member's interest in an order item ───────────────────────────

export const claims = sqliteTable(
	'claims',
	{
		id: text('id').primaryKey(),
		orderItemId: text('order_item_id')
			.references(() => orderItems.id)
			.notNull(),
		memberId: text('member_id')
			.references(() => members.id)
			.notNull(),
		amount: real('amount').notNull(),
		flexibility: text('flexibility').$type<'+' | '-' | '+-' | '*'>(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(table) => [unique().on(table.orderItemId, table.memberId)]
);

// ── delivery_items ── reconciliation per order item ──────────────────────────

export const deliveryItems = sqliteTable('delivery_items', {
	orderItemId: text('order_item_id')
		.references(() => orderItems.id)
		.primaryKey(),
	status: text('status').notNull(),
	actualPrice: real('actual_price'),
	actualQuantity: integer('actual_quantity'),
	notes: text('notes'),
	updatedBy: text('updated_by')
		.references(() => members.id)
		.notNull(),
	updatedAt: integer('updated_at').notNull()
});

// ── allocations ── final amounts after reconciliation ────────────────────────

export const allocations = sqliteTable(
	'allocations',
	{
		id: text('id').primaryKey(),
		orderItemId: text('order_item_id')
			.references(() => orderItems.id)
			.notNull(),
		memberId: text('member_id')
			.references(() => members.id)
			.notNull(),
		amount: real('amount').notNull(),
		price: real('price').notNull(),
		confirmed: integer('confirmed').notNull().default(0)
	},
	(table) => [unique().on(table.orderItemId, table.memberId)]
);

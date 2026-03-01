CREATE TABLE `allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` real NOT NULL,
	`price` real NOT NULL,
	`confirmed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allocations_order_item_id_member_id_unique` ON `allocations` (`order_item_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_token_unique` ON `auth_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `catalogue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`catalogue_id` text NOT NULL,
	`product_code` text NOT NULL,
	`description` text NOT NULL,
	`brand` text,
	`organic` integer,
	`case_price` real NOT NULL,
	`vat_rate` integer NOT NULL,
	`vat_per_case` real NOT NULL,
	`units_per_case` integer,
	`pack_size` real NOT NULL,
	`unit` text NOT NULL,
	`rrp` real,
	`barcode` text,
	`active` integer NOT NULL,
	FOREIGN KEY (`catalogue_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogue_items_catalogue_id_product_code_unique` ON `catalogue_items` (`catalogue_id`,`product_code`);--> statement-breakpoint
CREATE TABLE `catalogues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`item_count` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`order_item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`amount` real NOT NULL,
	`flexibility` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_order_item_id_member_id_unique` ON `claims` (`order_item_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `delivery_items` (
	`order_item_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`actual_price` real,
	`actual_quantity` integer,
	`notes` text,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`initials` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_code` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_items_order_id_product_code_unique` ON `order_items` (`order_id`,`product_code`);--> statement-breakpoint
CREATE TABLE `order_members` (
	`order_id` text NOT NULL,
	`member_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`order_id`, `member_id`),
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`catalogue_id` text NOT NULL,
	`status` text NOT NULL,
	`deadline` integer,
	`invite_code` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`catalogue_id`) REFERENCES `catalogues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_invite_code_unique` ON `orders` (`invite_code`);
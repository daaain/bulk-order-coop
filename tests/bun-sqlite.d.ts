declare module 'bun:sqlite' {
	export class Database {
		constructor(filename: string);
		query(sql: string): Statement;
		run(sql: string, params?: unknown[]): void;
		close(): void;
	}
	interface Statement {
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
	}
}

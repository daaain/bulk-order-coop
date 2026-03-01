import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

const DB_HELPER = 'bun tests/e2e/db-helper.ts';

export function getAuthToken(email: string): string {
	return execSync(`${DB_HELPER} get-token ${email}`, { encoding: 'utf-8' }).trim();
}

export function clearDatabase(): void {
	execSync(`${DB_HELPER} clear`, { encoding: 'utf-8' });
}

export function seedMember(email: string, name: string, initials: string): string {
	return execSync(`${DB_HELPER} seed-member ${email} ${name} ${initials}`, {
		encoding: 'utf-8'
	}).trim();
}

export function clearTestMember(email: string): void {
	execSync(`${DB_HELPER} clear-member ${email}`, { encoding: 'utf-8' });
}

export async function loginAs(
	page: Page,
	email: string,
	options?: { name?: string; initials?: string }
): Promise<void> {
	// Submit magic link form
	await page.goto('/');
	await page.fill('input[type="email"]', email);
	await page.click('button:has-text("Send magic link")');

	// Wait for success message
	await page.waitForSelector('text=Check your email');

	// Get token from D1
	const token = getAuthToken(email);

	// Navigate to verify endpoint
	await page.goto(`/auth/verify?token=${token}`);

	// Wait for redirect (either to profile setup or orders)
	await page.waitForURL(/\/(auth\/profile|orders)/, { timeout: 10000 });

	// Complete profile if needed
	if (page.url().includes('/auth/profile')) {
		const name = options?.name ?? 'Test User';
		const initials = options?.initials ?? 'TU';
		await page.fill('input[placeholder="e.g. Jane Smith"]', name);
		await page.fill('input[placeholder="e.g. JS"]', initials);
		await page.click('button:has-text("Save and continue")');
		await page.waitForURL(/\/orders/, { timeout: 10000 });
	}
}

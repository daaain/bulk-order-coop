import { test, expect } from '@playwright/test';
import { clearTestMember, getAuthToken } from './helpers';

test.describe('Auth flow (unauthenticated)', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('shows sign-in form for unauthenticated users', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('input[type="email"]')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
	});

	test('shows "Check your email" after submitting', async ({ page }) => {
		await page.goto('/');
		await page.fill('input[type="email"]', 'auth-test@test.local');
		await page.click('button:has-text("Send magic link")');
		await expect(page.getByText('Check your email')).toBeVisible();
	});

	test('completes profile setup for new users', async ({ page }) => {
		// Only clear specific test data, not the entire DB (which would delete the authenticated E2E user)
		clearTestMember('new-profile@test.local');

		await page.goto('/');
		await page.fill('input[type="email"]', 'new-profile@test.local');
		await page.click('button:has-text("Send magic link")');
		await expect(page.getByText('Check your email')).toBeVisible();

		const token = getAuthToken('new-profile@test.local');
		await page.goto(`/auth/verify?token=${token}`);
		await page.waitForURL(/\/auth\/profile/);

		await page.fill('input[placeholder="e.g. Jane Smith"]', 'New Profile');
		await page.fill('input[placeholder="e.g. JS"]', 'NP');
		await page.click('button:has-text("Save and continue")');
		await page.waitForURL(/\/orders/);

		await expect(page.getByRole('heading', { name: 'My Orders' })).toBeVisible();
	});
});

test.describe('Auth flow (authenticated)', () => {
	test('redirects to /orders when already authenticated', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/orders/);
	});
});

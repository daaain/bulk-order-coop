import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Orders', () => {
	test('creates an order with uploaded CSV', async ({ page }) => {
		await page.goto('/orders/new');

		// Fill order name
		await page.fill('input[placeholder="e.g. January 2026 Order"]', 'E2E Test Order');

		// Select "Upload new CSV" radio (should be default)
		await page.check('input[value="upload"]');

		// Upload CSV file
		const csvPath = path.resolve('tests/fixtures/invcat2.csv');
		await page.setInputFiles('input[type="file"]', csvPath);

		// Submit
		await page.click('button:has-text("Create order")');

		// Should redirect to the order dashboard — the order name appears as an h2 heading
		await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
		await expect(page.getByRole('heading', { name: 'E2E Test Order' })).toBeVisible();
	});

	test('shows order in list after creation', async ({ page }) => {
		await page.goto('/orders');
		await expect(page.locator('a:has-text("E2E Test Order")').first()).toBeVisible();
	});

	test('shows order dashboard with members and invite link', async ({ page }) => {
		await page.goto('/orders');
		await page.locator('a:has-text("E2E Test Order")').first().click();

		// Should see the order dashboard
		await expect(page.getByText('Members')).toBeVisible();
		await expect(page.getByText('E2E User')).toBeVisible();
		await expect(page.getByText('Invite link')).toBeVisible();

		// Copy link button should be visible
		await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
	});
});

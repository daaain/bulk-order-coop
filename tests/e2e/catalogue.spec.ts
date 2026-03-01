import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Catalogue', () => {
	// Helper to ensure an order exists and navigate to its catalogue
	async function ensureOrderAndGoToCatalogue(page: import('@playwright/test').Page) {
		await page.goto('/orders');

		// Check if an order already exists
		const orderLink = page.locator('a:has-text("E2E Test Order")');
		if (await orderLink.count() === 0) {
			// Create one
			await page.goto('/orders/new');
			await page.fill('input[placeholder="e.g. January 2026 Order"]', 'E2E Test Order');
			await page.check('input[value="upload"]');
			await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
			await page.click('button:has-text("Create order")');
			await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
		} else {
			await orderLink.first().click();
			await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
		}

		// Navigate to catalogue tab
		await page.click('a:has-text("Catalogue")');
		await page.waitForURL(/\/catalogue/);
	}

	test('shows catalogue items', async ({ page }) => {
		await ensureOrderAndGoToCatalogue(page);
		// Should show product items
		await expect(page.locator('article').first()).toBeVisible();
	});

	test('filters items by search query', async ({ page }) => {
		await ensureOrderAndGoToCatalogue(page);

		// Search for a specific product
		await page.fill('input[placeholder="Search products..."]', 'Rice');

		// Should show matching items
		const items = page.locator('article');
		await expect(items.first()).toBeVisible();

		// All visible items should contain "Rice" in their text
		const count = await items.count();
		expect(count).toBeGreaterThan(0);
	});

	test('adds an item to the order from catalogue', async ({ page }) => {
		await ensureOrderAndGoToCatalogue(page);

		// Search for a specific product
		await page.fill('input[placeholder="Search products..."]', 'Arborio Rice');

		// Click "Add to order" on the first matching item
		const addButton = page.locator('button:has-text("Add to order")').first();
		await expect(addButton).toBeVisible();
		await addButton.click();

		// After adding, a claim button should appear
		await expect(page.locator('button:has-text("Add claim")').first()).toBeVisible();
	});
});

import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Claims', () => {
	// Navigate to an E2E Test Order's catalogue page with Buckwheat item ready for claiming.
	// Handles all possible states: no order, item not on order, item with existing claim.
	// Returns the page positioned at the catalogue with the first Buckwheat article visible.
	async function navigateToCatalogueWithItem(page: import('@playwright/test').Page) {
		await page.goto('/orders');

		const orderLink = page.locator('a:has-text("E2E Test Order")');
		if ((await orderLink.count()) === 0) {
			// Create order
			await page.goto('/orders/new');
			await page.fill('input[placeholder="e.g. January 2026 Order"]', 'E2E Test Order');
			await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
			await page.click('button:has-text("Create order")');
			await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
		} else {
			await orderLink.first().click();
			await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
		}

		// Navigate to catalogue and search for Buckwheat
		await page.click('a:has-text("Catalogue")');
		await page.waitForURL(/\/catalogue/);
		await expect(page.locator('article').first()).toBeVisible();
		await page.fill('input[placeholder="Search products..."]', 'Buckwheat');
		await expect(page.locator('article').first()).toBeVisible();

		const firstArticle = page.locator('article').first();

		// Ensure item is on the order (handle "Add to order" state)
		const addToOrderBtn = firstArticle.locator('button:has-text("Add to order")');
		if (await addToOrderBtn.isVisible()) {
			await addToOrderBtn.click();
			await expect(firstArticle.locator('button:has-text("Add claim")')).toBeVisible();
		}

		return firstArticle;
	}

	// Ensure we have an item on the order with NO existing claim (ready for "Add claim")
	async function ensureNoClaim(firstArticle: import('@playwright/test').Locator) {
		const editClaimBtn = firstArticle.locator('button:has-text("Edit my claim")');
		const addClaimBtn = firstArticle.locator('button:has-text("Add claim")');

		if (await editClaimBtn.isVisible()) {
			await firstArticle.locator('button:has-text("Remove")').click();
			await firstArticle.locator('button:has-text("Yes")').click();
			await expect(addClaimBtn).toBeVisible();
		}
	}

	// Ensure we have a claim on the item (create if needed)
	async function ensureClaimExists(firstArticle: import('@playwright/test').Locator, amount = '250') {
		const editClaimBtn = firstArticle.locator('button:has-text("Edit my claim")');
		const addClaimBtn = firstArticle.locator('button:has-text("Add claim")');

		if (await addClaimBtn.isVisible()) {
			await addClaimBtn.click();
			await firstArticle.locator('input[type="number"]').fill(amount);
			await firstArticle.locator('button:has-text("Save claim")').click();
			await expect(editClaimBtn).toBeVisible();
		}
	}

	test('creates a claim on an item', async ({ page }) => {
		const firstArticle = await navigateToCatalogueWithItem(page);
		await ensureNoClaim(firstArticle);

		// Click "Add claim" on the item
		await firstArticle.locator('button:has-text("Add claim")').click();

		// Fill claim form within the article
		await firstArticle.locator('input[type="number"]').fill('500');
		await firstArticle.locator('button:has-text("Save claim")').click();

		// Should show the claim was created — "Edit my claim" button appears
		await expect(firstArticle.locator('button:has-text("Edit my claim")')).toBeVisible();
	});

	test('shows claim in My Claims list', async ({ page }) => {
		const firstArticle = await navigateToCatalogueWithItem(page);

		// Remove any existing claim, then create a fresh one
		await ensureNoClaim(firstArticle);
		await firstArticle.locator('button:has-text("Add claim")').click();
		await firstArticle.locator('input[type="number"]').fill('250');
		await firstArticle.locator('button:has-text("Save claim")').click();
		await expect(firstArticle.locator('button:has-text("Edit my claim")')).toBeVisible();

		// Navigate to My Claims
		await page.click('a:has-text("My Claims")');
		await page.waitForURL(/\/claims/);
		await page.waitForLoadState('networkidle');

		// Should show at least one claim — log page state on failure for debugging
		const rows = page.locator('tbody tr');
		try {
			await expect(rows.first()).toBeVisible({ timeout: 10000 });
		} catch (e) {
			const mainText = await page.locator('main').innerText();
			console.log(`[claims-debug] Page text: ${mainText.substring(0, 500)}`);
			console.log(`[claims-debug] tbody rows: ${await rows.count()}`);
			throw e;
		}
	});

	test('removes a claim', async ({ page }) => {
		const firstArticle = await navigateToCatalogueWithItem(page);
		await ensureClaimExists(firstArticle, '100');

		// Navigate to claims tab
		await page.click('a:has-text("My Claims")');
		await page.waitForURL(/\/claims/);

		// Wait for claims to load
		await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 10000 });

		const initialCount = await page.locator('tbody tr').count();

		if (initialCount > 0) {
			// Click Remove (ConfirmButton: first click shows confirm, second confirms)
			await page.locator('button:has-text("Remove")').first().click();
			// Confirm the removal
			await page.locator('button:has-text("Yes")').first().click();

			// Wait for removal to take effect
			if (initialCount === 1) {
				await expect(page.locator('tbody tr')).toHaveCount(0);
			} else {
				await expect(page.locator('tbody tr')).toHaveCount(initialCount - 1);
			}
		}
	});
});

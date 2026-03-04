import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Full order journey', () => {
	test('complete lifecycle: create → claim → close → reconcile → complete', async ({ page }) => {
		// 1. Create a new order with CSV upload
		await page.goto('/orders/new');
		await page.fill('input[placeholder="e.g. January 2026 Order"]', 'Journey Order');
		await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
		await page.click('button:has-text("Create order")');
		await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

		// Verify order was created
		await expect(page.getByRole('heading', { name: 'Journey Order' })).toBeVisible();

		// 2. Browse catalogue and add an item
		await page.click('a:has-text("Catalogue")');
		await page.waitForURL(/\/catalogue/);

		await page.fill('input[placeholder="Search products..."]', 'Arborio Rice');
		await expect(page.locator('article').first()).toBeVisible();

		await page.locator('button:has-text("Add to order")').first().click();
		await expect(page.locator('button:has-text("Add claim")').first()).toBeVisible();

		// 3. Create a claim on the item (Arborio Rice is 6×500g, packaged — claim in packs)
		await page.locator('button:has-text("Add claim")').first().click();
		await page.fill('input[type="number"]', '6');
		await page.click('button:has-text("Save claim")');

		// Verify claim was created
		await page.click('a:has-text("Claims")');
		await page.waitForURL(/\/claims/);
		await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });

		// 4. Close the order (organiser action)
		await page.click('a:has-text("Dashboard")');
		await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

		await page.click('button:has-text("Close order")');
		await page.click('button:has-text("Yes")');
		await expect(page.getByText('closed').first()).toBeVisible({ timeout: 15000 });

		// 5. Start reconciliation
		await page.click('button:has-text("Start reconciliation")');
		await page.click('button:has-text("Yes")');
		await expect(page.getByText('reconciling').first()).toBeVisible({ timeout: 15000 });

		// 6. Navigate to reconciliation page
		await page.click('a:has-text("Reconciliation")');
		await page.waitForURL(/\/reconciliation/);

		// 7. Mark items as arrived — wait for the page to load first
		const markAllBtn = page.locator('button:has-text("Mark all as arrived")');
		await expect(markAllBtn).toBeVisible({ timeout: 15000 });
		await markAllBtn.click();

		// Wait for the save to complete (button becomes re-enabled or delivery status updates)
		await page.waitForLoadState('networkidle');

		// 8. Generate allocations
		const allocateBtn = page.locator('button:has-text("Generate allocations")');
		await expect(allocateBtn).toBeVisible({ timeout: 15000 });
		await allocateBtn.click();

		// Wait for allocations to appear (can be slow under CI)
		await expect(page.locator('details').first()).toBeVisible({ timeout: 30000 });

		// 9. Confirm all allocations
		const confirmAllBtn = page.locator('button:has-text("Confirm all my allocations")');
		await expect(confirmAllBtn).toBeVisible({ timeout: 15000 });
		await confirmAllBtn.click();

		// Verify confirmed
		await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 15000 });

		// 10. Mark order complete (back to dashboard)
		await page.click('a:has-text("Dashboard")');
		await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

		await page.click('button:has-text("Mark complete")');
		await page.click('button:has-text("Yes")');
		await expect(page.getByText('complete').first()).toBeVisible({ timeout: 15000 });
	});
});

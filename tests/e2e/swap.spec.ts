import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Swap', () => {
  async function ensureOrderAndNavigate(page: import('@playwright/test').Page) {
    await page.goto('/orders');
    const orderLink = page.locator('a:has-text("E2E Test Order")');
    if ((await orderLink.count()) === 0) {
      await page.goto('/orders/new');
      await page.fill('input[placeholder="e.g. January 2026 Order"]', 'E2E Test Order');
      await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
      await page.click('button:has-text("Create order")');
      await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
    } else {
      await orderLink.first().click();
      await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
    }
  }

  test('preserves a claim when swapping to a different catalogue item', async ({ page }) => {
    await ensureOrderAndNavigate(page);

    // Go to catalogue, search for Buckwheat, and ensure a claim exists on it.
    await page.click('a:has-text("Catalogue")');
    await page.waitForURL(/\/catalogue/);
    await page.fill('input[placeholder="Search products..."]', 'Buckwheat');
    const buckwheatArticle = page.locator('article', { hasText: 'Buckwheat Groats' }).first();
    await expect(buckwheatArticle).toBeVisible();

    // Add to order if necessary
    const addToOrder = buckwheatArticle.locator('button:has-text("Add to order")');
    if (await addToOrder.isVisible()) {
      await addToOrder.click();
      await expect(buckwheatArticle.locator('button:has-text("Add claim")')).toBeVisible();
    }

    // Remove any existing claim to start fresh
    const editBtn = buckwheatArticle.locator('button:has-text("Edit my claim")');
    if (await editBtn.isVisible()) {
      await buckwheatArticle.locator('button:has-text("Remove")').first().click();
      await buckwheatArticle.locator('button:has-text("Yes")').first().click();
      await expect(buckwheatArticle.locator('button:has-text("Add claim")')).toBeVisible();
    }

    // Add a claim
    await buckwheatArticle.locator('button:has-text("Add claim")').click();
    await buckwheatArticle.locator('input[type="number"]').fill('2');
    await buckwheatArticle.locator('button:has-text("Save claim")').click();
    await expect(buckwheatArticle.locator('button:has-text("Edit my claim")')).toBeVisible();

    // Click Swap
    await buckwheatArticle.locator('button:has-text("Swap")').click();
    await page.waitForURL(/\/swap\//);

    // On swap page, pick a distinct item: Amaranth Seed (not on order)
    await page.fill('input[placeholder="Search products..."]', 'Amaranth');
    const amaranthRow = page
      .locator('article', { hasText: 'Amaranth Seed' })
      .first();
    await expect(amaranthRow).toBeVisible();
    await amaranthRow.locator('button:has-text("Swap to this")').click();

    // Confirmation view
    await expect(page.locator('h2:has-text("Confirm swap")')).toBeVisible();
    await page.locator('button:has-text("Confirm swap")').click();

    // We should be back on catalogue
    await page.waitForURL(/\/catalogue/);

    // Amaranth should now be on the order with a preserved claim
    await page.fill('input[placeholder="Search products..."]', 'Amaranth');
    const amaranthArticle = page.locator('article', { hasText: 'Amaranth Seed' }).first();
    await expect(amaranthArticle).toBeVisible();
    await expect(
      amaranthArticle.locator('button:has-text("Edit my claim")'),
    ).toBeVisible({ timeout: 10000 });

    // And the original Buckwheat should no longer be claimed
    await page.fill('input[placeholder="Search products..."]', 'Buckwheat');
    const buckwheatAfter = page.locator('article', { hasText: 'Buckwheat Groats' }).first();
    await expect(buckwheatAfter).toBeVisible();
    await expect(buckwheatAfter.locator('button:has-text("Edit my claim")')).toHaveCount(0);
  });
});

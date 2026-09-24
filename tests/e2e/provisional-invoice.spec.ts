import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Provisional invoice check', () => {
  test('shows items missing from the provisional invoice and swaps one', async ({ page }) => {
    await page.goto('/orders/new');
    await page.fill('input[placeholder="e.g. January 2026 Order"]', 'Provisional Check Order');
    await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
    await page.click('button:has-text("Create order")');
    await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

    await page.click('a:has-text("Catalogue")');
    await page.waitForURL(/\/catalogue/);

    async function addAndClaim(productCode: string, packs: string) {
      const searchInput = page.locator('input[placeholder="Search products..."]');
      await searchInput.fill('');
      await searchInput.fill(productCode);
      const article = page.locator(`article:has-text("Code: ${productCode}")`).first();
      await expect(article).toBeVisible({ timeout: 10000 });
      const addBtn = article.locator('button:has-text("Add to order")');
      if (await addBtn.isVisible()) await addBtn.click();
      await article.locator('button:has-text("Add claim")').click();
      await article.locator('input[type="number"]').fill(packs);
      await article.locator('button:has-text("Save claim")').click();
      await expect(article.locator('button:has-text("Edit my claim")')).toBeVisible({
        timeout: 15000,
      });
    }

    // Chia Seeds (6×250g) and Washing Powder (1×12.5kg) — both full cases
    await addAndClaim('6052', '6');
    await addAndClaim('830560', '1');

    await page.click('a:has-text("Dashboard")');
    await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
    await page.click('button:has-text("Close order")');
    await page.click('button:has-text("Yes")');
    await expect(page.getByText('closed').first()).toBeVisible({ timeout: 15000 });

    await page.click('a:has-text("Submission")');
    await page.waitForURL(/\/submission/);
    await expect(page.getByTestId('copy-infinity')).toContainText('2 lines');

    // Infinity could only supply the Chia Seeds
    await page
      .getByTestId('provisional-input')
      .setInputFiles({
        name: 'infinity_foods_order.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          '"Product Code","Order Quantity",Brand,Description\n6052,1,"Infinity Foods","Organic Chia Seeds"\n',
        ),
      });

    const dialog = page.locator('dialog.check-dialog');
    await expect(dialog).toBeVisible();
    const missing = dialog.getByTestId('missing-items');
    await expect(missing.locator('tbody tr')).toHaveCount(1);
    await expect(missing).toContainText('830560');
    await expect(missing).toContainText('0 of 1');

    // Swap it and land back on the Submission page
    await missing.locator('button:has-text("Swap")').click();
    await page.waitForURL(/\/swap\//);
    await page.fill('input[placeholder="Search products..."]', 'Amaranth');
    await page
      .locator('article', { hasText: 'Amaranth Seed' })
      .first()
      .locator('button:has-text("Swap to this")')
      .click();
    await page.locator('button:has-text("Confirm swap")').click();
    await page.waitForURL(/\/submission$/);

    // The check survives the round trip; the swapped item is resolved and the
    // replacement is listed as something to add to the Infinity order.
    await expect(page.getByTestId('provisional-summary')).toContainText('0 missing, 1 swapped');

    // The carried-over claim is only part of an Amaranth case, so it only
    // becomes an addition once the organiser ticks it for export.
    await page
      .locator('tr.summary-row', { hasText: 'Amaranth Seed' })
      .getByTestId('include-needs-more')
      .check();
    await expect(page.getByTestId('provisional-summary')).toContainText('1 to add');
    await page.getByTestId('provisional-summary').locator('button:has-text("Review")').click();
    await expect(dialog.locator('mark:has-text("Swapped")')).toBeVisible();
    await expect(dialog.getByTestId('additions')).toContainText('Amaranth Seed');
  });
});

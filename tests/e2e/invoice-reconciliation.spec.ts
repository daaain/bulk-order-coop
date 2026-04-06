import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('Invoice-driven reconciliation', () => {
  test('uploads invoice PDF, applies match, completes order', async ({ page }) => {
    // 1. Create a new order with the invcat2.csv catalogue
    await page.goto('/orders/new');
    await page.fill('input[placeholder="e.g. January 2026 Order"]', 'Invoice Recon Order');
    await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
    await page.click('button:has-text("Create order")');
    await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

    await expect(page.getByRole('heading', { name: 'Invoice Recon Order' })).toBeVisible();

    // 2. Browse catalogue and add three items that appear on the invoice fixture
    await page.click('a:has-text("Catalogue")');
    await page.waitForURL(/\/catalogue/);

    async function addAndClaim(productCode: string, packs: string) {
      // Search by product code so the catalogue is narrowed deterministically
      const searchInput = page.locator('input[placeholder="Search products..."]');
      await searchInput.fill('');
      await searchInput.fill(productCode);

      // Pick the article whose code footer matches exactly
      const article = page.locator(`article:has-text("Code: ${productCode}")`).first();
      await expect(article).toBeVisible({ timeout: 10000 });

      const addBtn = article.locator('button:has-text("Add to order")');
      if (await addBtn.isVisible()) {
        await addBtn.click();
      }
      await expect(article.locator('button:has-text("Add claim")')).toBeVisible();

      await article.locator('button:has-text("Add claim")').click();
      await article.locator('input[type="number"]').fill(packs);
      await article.locator('button:has-text("Save claim")').click();
      await expect(article.locator('button:has-text("Edit my claim")')).toBeVisible({
        timeout: 15000,
      });
    }

    // Each item is packaged → claim form input is in packs.
    // Chia Seeds 6052 — 6×250g, full case = 6 packs
    await addAndClaim('6052', '6');
    // Olive Oil Greek Extra Virgin - tin 210525 — 1×5l, full case = 1 pack
    await addAndClaim('210525', '1');
    // Concentrated Washing Powder 830560 — 1×12.5kg, full case = 1 pack
    await addAndClaim('830560', '1');

    // 3. Close the order
    await page.click('a:has-text("Dashboard")');
    await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

    await page.click('button:has-text("Close order")');
    await page.click('button:has-text("Yes")');
    await expect(page.getByText('closed').first()).toBeVisible({ timeout: 15000 });

    // 4. Start reconciliation
    await page.click('button:has-text("Start reconciliation")');
    await page.click('button:has-text("Yes")');
    await expect(page.getByText('reconciling').first()).toBeVisible({ timeout: 15000 });

    // 5. Navigate to reconciliation page
    await page.click('a:has-text("Reconciliation")');
    await page.waitForURL(/\/reconciliation/);

    // Wait for the page to be ready
    await expect(page.locator('button:has-text("Mark all as arrived")')).toBeVisible({
      timeout: 15000,
    });

    // 6. Upload the invoice PDF
    await page.setInputFiles(
      'input#invoice-pdf',
      path.resolve('tests/fixtures/KaeridwynEftelyaClapton677901.pdf'),
    );

    // 7. Wait for match summary
    const matchedCount = page.getByTestId('invoice-matched');
    await expect(matchedCount).toBeVisible({ timeout: 30000 });
    await expect(matchedCount).toHaveText('3 matched');
    await expect(page.getByTestId('invoice-missing')).toHaveText('0 missing');

    // 8. Apply the invoice
    await page.click('button:has-text("Apply invoice")');

    // After apply, all delivery rows should have a status set (no empty selects)
    await page.waitForLoadState('networkidle');
    const selects = page.locator('select.table-input--wide');
    await expect(selects.first()).toBeVisible({ timeout: 15000 });
    const count = await selects.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const value = await selects.nth(i).inputValue();
      expect(value).not.toBe('');
    }

    // 9. Generate allocations
    const allocateBtn = page.locator('button:has-text("Generate allocations")');
    await expect(allocateBtn).toBeVisible({ timeout: 15000 });
    await allocateBtn.click();

    await expect(page.locator('details').first()).toBeVisible({ timeout: 30000 });

    // 10. Order totals section should show invoice totals row
    await expect(page.getByText('Invoice 677901').first()).toBeVisible();

    // 11. Confirm all allocations
    const confirmAllBtn = page.locator('button:has-text("Confirm all my allocations")');
    await expect(confirmAllBtn).toBeVisible({ timeout: 15000 });
    await confirmAllBtn.click();
    await expect(page.getByText('Confirmed').first()).toBeVisible({ timeout: 15000 });

    // 12. Mark order complete
    await page.click('a:has-text("Dashboard")');
    await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
    await page.click('button:has-text("Mark complete")');
    await page.click('button:has-text("Yes")');
    await expect(page.getByText('complete').first()).toBeVisible({ timeout: 15000 });
  });
});

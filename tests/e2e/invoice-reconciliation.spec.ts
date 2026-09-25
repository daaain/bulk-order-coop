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

    // 5. Navigate to invoice phase
    await page.click('a:has-text("Invoice")');
    await page.waitForURL(/\/invoice/);

    // Wait for the page to be ready
    await expect(page.locator('input#invoice-pdf')).toBeVisible({ timeout: 15000 });

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

    // While the invoice is parsed (pre-apply), the invoice-result panel and the
    // order-totals tfoot both reference the invoice number — confirms the PDF
    // was parsed correctly and matched against the order.
    await expect(page.getByText('Invoice 677901').first()).toBeVisible();

    // 8. Apply the invoice
    await page.click('button:has-text("Apply invoice")');

    // After apply, the table re-renders (loadReconciliation briefly swaps it out
    // for a loading state). Use web-first assertions that auto-retry until the
    // selects are both present and populated — don't rely on networkidle here.
    const selects = page.locator('select.table-input--wide');
    await expect(selects).toHaveCount(3, { timeout: 15000 });
    await expect(selects.first()).not.toHaveValue('', { timeout: 15000 });
    await expect(selects.nth(1)).not.toHaveValue('');
    await expect(selects.nth(2)).not.toHaveValue('');

    // 9. Generate allocations
    const allocateBtn = page.locator('button:has-text("Generate allocations")');
    await expect(allocateBtn).toBeVisible({ timeout: 15000 });
    await allocateBtn.click();

    // 10. Move to delivery phase
    await page.click('a:has-text("Delivery")');
    await page.waitForURL(/\/delivery/);
    await expect(page.locator('details').first()).toBeVisible({ timeout: 30000 });

    // 11. Confirm pickup of all my items
    const confirmAllBtn = page.locator('button:has-text("I\'ve collected everything")');
    await expect(confirmAllBtn).toBeVisible({ timeout: 15000 });
    await confirmAllBtn.click();
    await expect(page.locator('mark.badge-open:has-text("Collected")').first()).toBeVisible({
      timeout: 15000,
    });

    // 12. Mark order complete from the delivery page
    const markCompleteBtn = page.locator('button:has-text("Mark order complete")');
    await expect(markCompleteBtn).toBeVisible({ timeout: 15000 });
    await markCompleteBtn.click();
    await page.click('button:has-text("Yes")');
    await expect(page.getByText('complete').first()).toBeVisible({ timeout: 15000 });
  });

  test('offers to start reconciliation from the invoice page when the order is open', async ({
    page,
  }) => {
    await page.goto('/orders/new');
    await page.fill('input[placeholder="e.g. January 2026 Order"]', 'Invoice Early Order');
    await page.setInputFiles('input[type="file"]', path.resolve('tests/fixtures/invcat2.csv'));
    await page.click('button:has-text("Create order")');
    await page.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);

    await page.click('a:has-text("Invoice")');
    await page.waitForURL(/\/invoice/);

    const notice = page.getByTestId('start-reconciliation');
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText('This order is still open');
    await expect(page.locator('button:has-text("Mark all as arrived")')).toHaveCount(0);

    await notice.locator('button:has-text("Close order and start reconciliation")').click();
    await notice.locator('button:has-text("Yes")').click();

    await expect(notice).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('button:has-text("Mark all as arrived")')).toBeVisible();
  });
});

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

    // 6. Navigate to invoice phase
    await page.click('a:has-text("Invoice")');
    await page.waitForURL(/\/invoice/);

    // 7. Mark items as arrived (no PDF invoice in this test)
    const markAllBtn = page.locator('button:has-text("Mark all as arrived")');
    await expect(markAllBtn).toBeVisible({ timeout: 15000 });
    await markAllBtn.click();

    // 8. Generate allocations. The button is gated by `allDeliverySet`, so it
    //    only appears once markAllArrived() has finished PATCHing every item
    //    and reloaded the reconciliation.
    const allocateBtn = page.locator('button:has-text("Generate allocations")');
    await expect(allocateBtn).toBeVisible({ timeout: 30000 });
    await allocateBtn.click();

    // 9. Move to delivery phase
    await page.click('a:has-text("Delivery")');
    await page.waitForURL(/\/delivery/);
    await expect(page.locator('details').first()).toBeVisible({ timeout: 30000 });

    // 10. Confirm pickup of all my items
    const confirmAllBtn = page.locator('button:has-text("I\'ve collected everything")');
    await expect(confirmAllBtn).toBeVisible({ timeout: 15000 });
    await confirmAllBtn.click();
    await expect(page.locator('mark.badge-open:has-text("Collected")').first()).toBeVisible({
      timeout: 15000,
    });

    // 11. Mark order complete from the delivery page (gated on allConfirmed)
    const markCompleteBtn = page.locator('button:has-text("Mark order complete")');
    await expect(markCompleteBtn).toBeVisible({ timeout: 15000 });
    await markCompleteBtn.click();
    await page.click('button:has-text("Yes")');
    await expect(page.getByText('complete').first()).toBeVisible({ timeout: 15000 });
  });
});

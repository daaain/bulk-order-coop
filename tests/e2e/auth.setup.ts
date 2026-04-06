import { test as setup, expect } from '@playwright/test';
import { clearDatabase, loginAs } from './helpers';

const AUTH_FILE = 'tests/e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Clear database for a fresh start
  clearDatabase();

  // Login as the test user
  await loginAs(page, 'e2e-user@test.local', { name: 'E2E User', initials: 'EU' });

  // Verify we're on the orders page
  await expect(page).toHaveURL(/\/orders/);

  // Save authentication state
  await page.context().storageState({ path: AUTH_FILE });
});

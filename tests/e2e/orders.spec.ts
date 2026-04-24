import { test, expect } from '@playwright/test';
import path from 'node:path';
import { clearTestMember, getAuthToken } from './helpers';

test.describe('Orders', () => {
  test('creates an order with uploaded CSV', async ({ page }) => {
    await page.goto('/orders/new');

    // Fill order name
    await page.fill('input[placeholder="e.g. January 2026 Order"]', 'E2E Test Order');

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
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(page.getByText('E2E User')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invite link' })).toBeVisible();

    // Copy link button should be visible
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  });

  test('invite link round-trips a new user through sign-in back to the join page', async ({
    page,
    browser,
  }) => {
    // Read the invite URL from the order dashboard while authenticated
    await page.goto('/orders');
    await page.locator('a:has-text("E2E Test Order")').first().click();
    await expect(page.getByText('Invite link')).toBeVisible();
    const inviteUrl = await page.locator('input[readonly]').first().inputValue();
    const inviteCode = inviteUrl.split('/join/')[1];
    expect(inviteCode).toBeTruthy();

    // Fresh, unauthenticated browser context — simulates a new invitee
    const inviteEmail = 'invitee@test.local';
    clearTestMember(inviteEmail);
    const guestContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guest = await guestContext.newPage();

    try {
      // 1. Land on the join page — should prompt to sign in (and not be bounced
      // away by an unauthenticated 401 on the invite preview lookup).
      await guest.goto(`/join/${inviteCode}`);
      await expect(guest.getByText('You need to sign in')).toBeVisible();
      await expect(guest).toHaveURL(`/join/${inviteCode}`);

      // 2. Sign-in CTA carries the redirect back to the join page (it's an
      // <a role="button"> styled as a button, so query by button role).
      const signInLink = guest.getByRole('button', { name: 'Sign in' });
      await expect(signInLink).toHaveAttribute('href', `/?redirect=/join/${inviteCode}`);
      await signInLink.click();
      await expect(guest).toHaveURL(`/?redirect=/join/${inviteCode}`);

      // 3. Submit the magic-link form — still on the login page with redirect intact
      await guest.fill('input[type="email"]', inviteEmail);
      await guest.click('button:has-text("Send magic link")');
      await expect(guest.getByText('Check your email')).toBeVisible();

      // 4. Click the magic link (with redirect param, as the API embeds it in the email URL)
      const token = getAuthToken(inviteEmail);
      await guest.goto(
        `/auth/verify?token=${token}&redirect=${encodeURIComponent(`/join/${inviteCode}`)}`,
      );

      // 5. New user → profile setup, but the redirect is preserved through it
      await guest.waitForURL(/\/auth\/profile/);
      expect(guest.url()).toContain(`redirect=${encodeURIComponent(`/join/${inviteCode}`)}`);
      await guest.fill('input[placeholder="e.g. Jane Smith"]', 'Invitee User');
      await guest.fill('input[placeholder="e.g. JS"]', 'IU');
      await guest.click('button:has-text("Save and continue")');

      // 6. Lands back on the join page (NOT /orders) and can finally join
      await guest.waitForURL(`**/join/${inviteCode}`);
      await expect(guest.getByRole('button', { name: 'Join this order' })).toBeVisible();
      await guest.click('button:has-text("Join this order")');
      await guest.waitForURL(/\/orders\/[a-zA-Z0-9_-]+$/);
      await expect(guest.getByRole('heading', { name: 'E2E Test Order' })).toBeVisible();
    } finally {
      await guestContext.close();
      clearTestMember(inviteEmail);
    }
  });
});

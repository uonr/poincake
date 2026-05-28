import { expect, test } from '@playwright/test';

test('renders the hyperbolic canvas shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('.item').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

test('renders the hyperbolic canvas shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.getByTestId('note').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
});

test('edits the active note through the React overlay', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('note').and(page.locator('[data-note-render="text"]')).first().click();

  await expect(page.getByTestId('note-editor')).toBeVisible();
  await page.getByLabel('Note text').fill('Edited note');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByTestId('note-editor')).toBeHidden();
  await expect(page.getByTestId('note').filter({ hasText: 'Edited note' })).toBeVisible();
});

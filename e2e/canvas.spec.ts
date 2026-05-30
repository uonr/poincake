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
  await page.getByTestId('note').and(page.locator('[data-note-render="text"]')).last().click();

  await expect(page.getByTestId('note-editor')).toBeVisible();
  await page.getByLabel('Note text').fill('Edited note');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByTestId('note-editor')).toBeHidden();
  await expect(page.getByTestId('note').filter({ hasText: 'Edited note' })).toBeVisible();
});

test('creates a note from edit mode after distant panning', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  if (!box) {
    throw new Error('Stage is not laid out.');
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const dragY = Math.min(260, box.height * 0.35);

  await page.getByRole('button', { name: 'Navigate' }).click();
  for (let i = 0; i < 24; i += 1) {
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, centerY + dragY, { steps: 8 });
    await page.mouse.up();
  }

  await page.getByRole('button', { name: 'Edit' }).click();
  const snapPoint = await findSnapPoint(page, box);
  await page.mouse.click(snapPoint.x, snapPoint.y);

  await expect(page.getByTestId('note-editor')).toBeVisible();
  await expect(page.getByLabel('Note text')).toHaveValue('');
  await page.getByLabel('Note text').fill('Distant edit note');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByTestId('note').filter({ hasText: 'Distant edit note' })).toBeVisible();
});

const findSnapPoint = async (
  page: import('@playwright/test').Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<{ x: number; y: number }> => {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  for (let radius = 0; radius <= 220; radius += 24) {
    for (let dy = -radius; dy <= radius; dy += 24) {
      for (let dx = -radius; dx <= radius; dx += 24) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) {
          continue;
        }

        await page.mouse.move(x, y);
        const nearSnap = await page
          .locator('#stage')
          .evaluate((stage) => stage.classList.contains('near-snap'));
        if (nearSnap) {
          return { x, y };
        }
      }
    }
  }

  throw new Error('Could not find a snapped grid point near the viewport center.');
};

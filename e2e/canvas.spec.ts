import { expect, test } from '@playwright/test';

test('renders the hyperbolic canvas shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.getByTestId('note').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text' })).toBeVisible();
  await expect(page.getByTestId('coordinate-indicator')).toBeHidden();
});

test('zooms with the wheel over blank canvas space', async ({ page }) => {
  await page.goto('/');

  const point = await findBlankStagePoint(page);
  const zoomValue = page.locator('#zoom-val');
  const before = await zoomValue.textContent();

  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -300);

  await expect(zoomValue).not.toHaveText(before ?? '');
});

test('pans with the middle mouse button in non-navigation modes', async ({ page }) => {
  await page.goto('/');

  for (const mode of ['Text', 'Move', 'Arrow']) {
    await page.getByRole('button', { name: mode }).click();
    const note = page.getByTestId('note').first();
    const before = await note.boundingBox();
    if (!before) {
      throw new Error('Note is not laid out.');
    }

    const point = await findBlankStagePoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(point.x + 90, point.y + 60, { steps: 8 });
    await page.mouse.up({ button: 'middle' });

    await expect
      .poll(async () => {
        const after = await note.boundingBox();
        if (!after) {
          return 0;
        }
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        return dx * dx + dy * dy;
      })
      .toBeGreaterThan(64);
  }

  await expect(page.getByTestId('arrow-inspector')).toBeHidden();
});

test('shows view back and forward controls after a jump', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('view-history-controls')).toBeHidden();

  const point = await findBlankStagePoint(page);
  await page.mouse.click(point.x, point.y);

  const controls = page.getByTestId('view-history-controls');
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Back' })).toBeEnabled();
  await expect(controls.getByRole('button', { name: 'Forward' })).toBeDisabled();

  await controls.getByRole('button', { name: 'Back' }).click();
  await expect(controls.getByRole('button', { name: 'Forward' })).toBeEnabled();

  await controls.getByRole('button', { name: 'Forward' }).click();
  await expect(controls.getByRole('button', { name: 'Back' })).toBeEnabled();
});

test('switches modes with keyboard shortcuts', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('#stage');

  await page.keyboard.press('T');
  await expect(stage).toHaveClass(/mode-edit/);

  await page.keyboard.press('M');
  await expect(stage).toHaveClass(/mode-move/);

  await page.keyboard.press('A');
  await expect(stage).toHaveClass(/mode-arrow/);

  await page.keyboard.press('Escape');
  await expect(stage).toHaveClass(/mode-pan/);

  await page.keyboard.press('2');
  await expect(stage).toHaveClass(/mode-edit/);

  await page.keyboard.down('Space');
  await expect(stage).toHaveClass(/mode-pan/);
  await page.keyboard.up('Space');
  await expect(stage).toHaveClass(/mode-edit/);
});

test('edits the active note through the React overlay', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Text' }).click();
  await page.getByTestId('note').and(page.locator('[data-note-render="text"]')).last().click();

  await expect(page.getByTestId('note-editor')).toBeVisible();
  await page.getByLabel('Note text').fill('Edited\nnote');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByTestId('note-editor')).toBeHidden();
  const editedNote = page.getByTestId('note').filter({ hasText: 'Edited' });
  await expect(editedNote).toBeVisible();
});

test('copies the selected note coordinate from the indicator', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  await page.getByTestId('note').and(page.locator('[data-note-render="text"]')).last().click();

  const indicator = page.getByTestId('coordinate-indicator');
  await expect(indicator).toBeEnabled();
  await expect(indicator).toContainText('Selected note');
  await expect(indicator.locator('code')).toContainText(';');

  const shownCoordinate = await indicator.locator('code').textContent();
  await indicator.click();

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(shownCoordinate);
});

test('previews the target note when hovering a coordinate note', async ({ page }) => {
  await page.goto('/');

  const textNotes = page.getByTestId('note').and(page.locator('[data-note-render="text"]'));
  const targetNote = textNotes.first();
  const targetText = (await targetNote.textContent())?.trim();
  if (!targetText) {
    throw new Error('Target note has no text.');
  }

  await targetNote.click();
  const coordinate = await page.getByTestId('coordinate-indicator').locator('code').textContent();
  if (!coordinate) {
    throw new Error('Selected note coordinate is missing.');
  }

  const sourceNote = textNotes.nth(1);
  const sourceNoteId = await sourceNote.getAttribute('data-note-id');
  if (!sourceNoteId) {
    throw new Error('Source note id is missing.');
  }

  await page.getByRole('button', { name: 'Text' }).click();
  await sourceNote.click();
  await page.getByLabel('Note text').fill(coordinate);
  await page.getByRole('button', { name: 'Done' }).click();

  const coordinateNote = page.locator(`[data-testid="note"][data-note-id="${sourceNoteId}"]`);
  await expect(coordinateNote).toHaveAttribute('data-note-content-kind', 'coordinate');
  await coordinateNote.hover();

  await expect(page.getByTestId('coordinate-note-preview')).toContainText(targetText);
});

test('shows the arrow inspector after drawing an arrow', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  if (!box) {
    throw new Error('Stage is not laid out.');
  }

  await page.getByRole('button', { name: 'Arrow' }).click();
  const from = await findSnapPoint(page, box);
  const to = await findSnapPoint(page, box, from);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId('arrow-inspector')).toBeVisible();
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

  await page.getByRole('button', { name: 'Text' }).click();
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
  exclude?: { x: number; y: number },
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
        if (exclude) {
          const ex = x - exclude.x;
          const ey = y - exclude.y;
          if (ex * ex + ey * ey < 48 * 48) {
            continue;
          }
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

const findBlankStagePoint = async (
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number }> => {
  const point = await page.locator('#stage').evaluate((stage) => {
    const box = stage.getBoundingClientRect();
    for (let y = box.top + 80; y < box.bottom - 80; y += 32) {
      for (let x = box.left + 80; x < box.right - 80; x += 32) {
        const target = document.elementFromPoint(x, y);
        if (
          target instanceof Element &&
          target.closest(
            [
              '[data-testid="note"]',
              '[data-testid="app-menu"]',
              '[data-testid="history-controls"]',
              '[data-testid="mode-controls"]',
              '[data-testid="zoom-controls"]',
              '[data-testid="coordinate-indicator"]',
            ].join(', '),
          )
        ) {
          continue;
        }

        return { x, y };
      }
    }

    return null;
  });

  if (!point) {
    throw new Error('Could not find blank stage space.');
  }

  return point;
};

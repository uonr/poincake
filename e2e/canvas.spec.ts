import { expect, test } from '@playwright/test';

// A minimal serialized world (one note) in the same format export/import and the
// localStorage autosave use. Inlined so the spec needs no Node fs/url types,
// which the build's tsc does not include for e2e.
const PERSISTED_WORLD = JSON.stringify({
  format: 'poincake-world',
  version: 1,
  exportedAt: '2026-05-31T04:19:10.614Z',
  content: {
    notes: [
      {
        id: 'note-0',
        anchor: {
          chartId: 'root',
          walk: [],
          local: { kind: 'edge', index: 1, subdivision: 4, subdivisions: 6 },
        },
        content: { kind: 'plain-text', text: '你好，世界' },
        appearance: { color: 'c1' },
        createdAt: 1780201074140,
        updatedAt: 1780201081732,
      },
    ],
    arrows: [],
    charts: [
      { id: 'root', parentId: null, transition: [] },
      { id: 'chart-1', parentId: 'root', transition: [0, 2, 1, 0] },
      { id: 'chart-2', parentId: 'chart-1', transition: [0, 1, 2, 0] },
    ],
  },
});

const LINK_WORLD = JSON.stringify({
  format: 'poincake-world',
  version: 1,
  exportedAt: '2026-06-01T00:00:00.000Z',
  content: {
    notes: [
      {
        id: 'note-link',
        anchor: {
          chartId: 'root',
          walk: [],
          local: { kind: 'edge', index: 1, subdivision: 4, subdivisions: 6 },
        },
        content: { kind: 'plain-text', text: 'https://example.com/path' },
        appearance: { color: 'c2' },
        createdAt: 1780272000000,
        updatedAt: 1780272000000,
      },
      {
        id: 'note-partial-link',
        anchor: {
          chartId: 'root',
          walk: [0, 1],
          local: { kind: 'edge', index: 2, subdivision: 2, subdivisions: 6 },
        },
        content: { kind: 'plain-text', text: 'see https://example.com/path' },
        appearance: { color: 'c3' },
        createdAt: 1780272000000,
        updatedAt: 1780272000000,
      },
    ],
    arrows: [],
    charts: [
      { id: 'root', parentId: null, transition: [] },
      { id: 'chart-1', parentId: 'root', transition: [0, 2, 1, 0] },
      { id: 'chart-2', parentId: 'chart-1', transition: [0, 1, 2, 0] },
    ],
  },
});

test('restores a persisted document without leaving a screen-fixed duplicate', async ({ page }) => {
  // Pre-seed the autosave slot so the app boots through the restore path rather
  // than starting blank.
  await page.addInitScript((world) => {
    window.localStorage.setItem('poincake:world', world);
  }, PERSISTED_WORLD);
  await page.goto('/');

  const helloNotes = page.getByTestId('note').filter({ hasText: '你好，世界' });
  await expect(helloNotes.first()).toBeVisible();

  // A navigate-mode drag from blank space pans the disk. The live note follows
  // the pan; a leaked, screen-fixed clone would stay put and inflate the count.
  const blank = await findBlankStagePoint(page);
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(blank.x + 140, blank.y + 90, { steps: 10 });
  await page.mouse.up();

  await expect(helloNotes).toHaveCount(1);
});

test('underlines notes that are exactly external links', async ({ page }) => {
  await page.addInitScript((world) => {
    window.localStorage.setItem('poincake:world', world);
  }, LINK_WORLD);
  await page.goto('/');

  const linkNote = page.locator('[data-testid="note"][data-note-id="note-link"]');
  await expect(linkNote).toBeVisible();
  await expect(linkNote).toHaveAttribute('data-note-link', 'external');
  await expect(linkNote).toHaveCSS('text-decoration-line', 'underline');
  await linkNote.hover();
  await expect(linkNote).toHaveCSS('text-decoration-line', 'underline');

  const partialLinkNote = page.locator('[data-testid="note"][data-note-id="note-partial-link"]');
  await expect(partialLinkNote).not.toHaveAttribute('data-note-link', 'external');
});

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
  await page.locator('[data-testid="note"][data-note-id="note-0"]').click();

  await expect(page.getByTestId('note-editor')).toBeVisible();
  await page.getByLabel('Note text').fill('Edited\nnote');
  const blank = await findBlankStagePoint(page);
  await page.mouse.click(blank.x, blank.y);

  await expect(page.getByTestId('note-editor')).toBeHidden();
  const editedNote = page.getByTestId('note').filter({ hasText: 'Edited' });
  await expect(editedNote).toBeVisible();
});

test('copies the selected note coordinate from the indicator', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  await page.locator('[data-testid="note"][data-note-id="note-0"]').click();

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
  const blank = await findBlankStagePoint(page);
  await page.mouse.click(blank.x, blank.y);

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
  const blank = await findBlankStagePoint(page);
  await page.mouse.click(blank.x, blank.y);

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

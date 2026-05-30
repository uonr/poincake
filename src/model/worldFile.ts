import { z } from 'zod';
import type { GridChartSnapshot } from '../grid/anchoredGrid';
import {
  type GridAnchor,
  type ReducedWalk,
  ROOT_CHART_ID,
  reduceWalk,
} from '../grid/tilingAddress';
import type { Arrow } from './arrow';
import type { Note } from './note';
import type { HyperbolicWorldState } from './worldState';

export const WORLD_FILE_VERSION = 1;

export type WorldFileContent = Readonly<{
  notes: Note[];
  arrows: Arrow[];
  charts: GridChartSnapshot[];
}>;

export type WorldFile = Readonly<{
  format: 'poincake-world';
  version: typeof WORLD_FILE_VERSION;
  exportedAt: string;
  content: WorldFileContent;
}>;

const noteColorSchema = z.enum(['c1', 'c2', 'c3', 'c4']);
const arrowHeadModeSchema = z.enum(['none', 'start', 'end', 'both']);
const edgeIndexSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const reducedWalkSchema = z.array(edgeIndexSchema).transform((walk) => reduceWalk(walk));

const localAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('center') }).strict(),
  z
    .object({
      kind: z.literal('vertex'),
      index: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('edge'),
      index: z.number().int().min(0).max(2),
      subdivision: z.number().int().positive(),
      subdivisions: z.number().int().min(2),
    })
    .strict()
    .refine((anchor) => anchor.subdivision < anchor.subdivisions, {
      message: 'Edge subdivision must be inside the subdivision count.',
      path: ['subdivision'],
    }),
]);

const gridAnchorSchema = z
  .object({
    chartId: z.string().min(1),
    walk: reducedWalkSchema,
    local: localAnchorSchema,
  })
  .strict()
  .transform(
    (anchor): GridAnchor => ({
      chartId: anchor.chartId,
      walk: anchor.walk,
      local: anchor.local,
    }),
  );

const noteSchema = z
  .object({
    id: z.string().min(1),
    anchor: gridAnchorSchema,
    content: z
      .object({
        kind: z.literal('plain-text'),
        text: z.string(),
      })
      .strict(),
    appearance: z
      .object({
        color: noteColorSchema,
      })
      .strict(),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
  })
  .strict();

const arrowSchema = z
  .object({
    id: z.string().min(1),
    from: gridAnchorSchema,
    to: gridAnchorSchema,
    label: z.string(),
    appearance: z
      .object({
        color: noteColorSchema,
        headMode: arrowHeadModeSchema,
      })
      .strict(),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
  })
  .strict();

const chartSnapshotSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    transition: reducedWalkSchema,
  })
  .strict()
  .transform(
    (snapshot): GridChartSnapshot => ({
      id: snapshot.id,
      parentId: snapshot.parentId,
      transition: snapshot.transition,
    }),
  );

const worldFileContentSchema = z
  .object({
    notes: z.array(noteSchema),
    arrows: z.array(arrowSchema),
    charts: z.array(chartSnapshotSchema),
  })
  .strict()
  .superRefine((content, context) => {
    rejectDuplicateIds(content.notes, 'note', context);
    rejectDuplicateIds(content.arrows, 'arrow', context);
    rejectDuplicateIds(content.charts, 'chart', context);

    const chartIds = new Set(content.charts.map((chart) => chart.id));
    if (!chartIds.has(ROOT_CHART_ID)) {
      context.addIssue({
        code: 'custom',
        message: `Missing required "${ROOT_CHART_ID}" chart snapshot.`,
        path: ['charts'],
      });
    }

    for (const chart of content.charts) {
      if (chart.parentId && !chartIds.has(chart.parentId)) {
        context.addIssue({
          code: 'custom',
          message: `Chart "${chart.id}" references missing parent "${chart.parentId}".`,
          path: ['charts'],
        });
      }
    }

    for (const note of content.notes) {
      rejectMissingChart(note.anchor, chartIds, context, ['notes', note.id, 'anchor']);
    }
    for (const arrow of content.arrows) {
      rejectMissingChart(arrow.from, chartIds, context, ['arrows', arrow.id, 'from']);
      rejectMissingChart(arrow.to, chartIds, context, ['arrows', arrow.id, 'to']);
    }
  });

export const worldFileSchema = z
  .object({
    format: z.literal('poincake-world'),
    version: z.literal(WORLD_FILE_VERSION),
    exportedAt: z.string().min(1),
    content: worldFileContentSchema,
  })
  .strict();

export const createWorldFile = (world: HyperbolicWorldState): WorldFile => ({
  format: 'poincake-world',
  version: WORLD_FILE_VERSION,
  exportedAt: new Date().toISOString(),
  content: {
    notes: world.notes.map(cloneNote),
    arrows: world.arrows.map(cloneArrow),
    charts: world.grid.chartSnapshots().map(cloneChartSnapshot),
  },
});

export const stringifyWorldFile = (world: HyperbolicWorldState): string =>
  `${JSON.stringify(createWorldFile(world), null, 2)}\n`;

export const parseWorldFileText = (text: string): WorldFileContent => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON.');
  }

  const parsed = worldFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(z.prettifyError(parsed.error));
  }

  return cloneContent(parsed.data.content);
};

const rejectDuplicateIds = (
  items: readonly { id: string }[],
  label: string,
  context: z.RefinementCtx,
): void => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate ${label} id "${item.id}".`,
      });
    }
    seen.add(item.id);
  }
};

const rejectMissingChart = (
  anchor: GridAnchor,
  chartIds: ReadonlySet<string>,
  context: z.RefinementCtx,
  path: (string | number)[],
): void => {
  if (chartIds.has(anchor.chartId)) {
    return;
  }

  context.addIssue({
    code: 'custom',
    message: `Anchor references missing chart "${anchor.chartId}".`,
    path,
  });
};

const cloneContent = (content: WorldFileContent): WorldFileContent => ({
  notes: content.notes.map(cloneNote),
  arrows: content.arrows.map(cloneArrow),
  charts: content.charts.map(cloneChartSnapshot),
});

const cloneNote = (note: Note): Note => ({
  ...note,
  anchor: cloneAnchorForFile(note.anchor),
  content: { ...note.content },
  appearance: { ...note.appearance },
});

const cloneArrow = (arrow: Arrow): Arrow => ({
  ...arrow,
  from: cloneAnchorForFile(arrow.from),
  to: cloneAnchorForFile(arrow.to),
  appearance: { ...arrow.appearance },
});

const cloneChartSnapshot = (snapshot: GridChartSnapshot): GridChartSnapshot => ({
  id: snapshot.id,
  parentId: snapshot.parentId,
  transition: reduceWalk(snapshot.transition),
});

const cloneAnchorForFile = (anchor: GridAnchor): GridAnchor => ({
  chartId: anchor.chartId,
  walk: reduceWalk(anchor.walk) as ReducedWalk,
  local: { ...anchor.local },
});

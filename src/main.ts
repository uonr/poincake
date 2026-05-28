import './styles.css';
import { AnchoredGrid } from './grid/anchoredGrid';
import { generateHyperbolicTiling } from './grid/hyperbolicTiling';
import { HyperbolicCanvasController } from './interaction/controller';
import { seedNotes } from './demo/seedNotes';

const queryRequired = <T extends Element>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
};

const stage = queryRequired<HTMLElement>('#stage');
const canvas = queryRequired<HTMLCanvasElement>('#grid');
const tiling = generateHyperbolicTiling();
const grid = new AnchoredGrid(tiling);
const notes = seedNotes(tiling.coarseGridPoints, 700, { maxInitialRadius: 0.92 });

new HyperbolicCanvasController({
  stage,
  canvas,
  notes,
  grid,
  zoomInput: queryRequired<HTMLInputElement>('#zoom'),
  zoomValueElement: queryRequired<HTMLElement>('#zoom-val'),
  resetButton: queryRequired<HTMLButtonElement>('#reset'),
}).start();

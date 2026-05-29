import { describe, expect, it } from 'vitest';
import { fitDiskZoom } from '../src/render/viewport';

describe('viewport fitting', () => {
  it('fits the full disk inside wide, tall, and square viewports at minimum zoom', () => {
    const sizes: ReadonlyArray<readonly [number, number]> = [
      [800, 800],
      [1600, 600],
      [600, 1600],
      [3440, 900],
    ];

    for (const [width, height] of sizes) {
      const cx = width / 2;
      const cy = height / 2;
      const zoom = fitDiskZoom(width, height);
      const diskRadius = Math.sqrt(cx * cx + cy * cy) * zoom;

      expect(diskRadius).toBeLessThanOrEqual(Math.min(cx, cy) - 8 + 1e-10);
    }
  });
});

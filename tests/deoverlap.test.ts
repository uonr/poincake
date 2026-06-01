import { describe, expect, it } from 'vitest';
import { composeTransforms, identityTransform, rotationTransform } from '../src/geometry/mobius';
import { type DeoverlapNode, findBestRotation, overlapScore } from '../src/render/deoverlap';
import { createViewportFromRect } from '../src/render/viewport';

const viewport = createViewportFromRect({ width: 800, height: 800, left: 0, top: 0 }, 1);

describe('overlapScore', () => {
  it('is zero for a single label', () => {
    const nodes: DeoverlapNode[] = [{ point: [0, 0], width: 100, height: 30 }];
    expect(overlapScore(nodes, identityTransform, viewport)).toBe(0);
  });

  it('reports a positive area for two coincident labels', () => {
    const nodes: DeoverlapNode[] = [
      { point: [0, 0], width: 100, height: 30 },
      { point: [0, 0], width: 100, height: 30 },
    ];
    expect(overlapScore(nodes, identityTransform, viewport)).toBeGreaterThan(0);
  });

  it('ignores labels that collapse to dots (far from center)', () => {
    // Near the disk boundary the scale falls below the text threshold, so these
    // never render as text and contribute no overlap.
    const nodes: DeoverlapNode[] = [
      { point: [0.99, 0], width: 100, height: 30 },
      { point: [0.99, 0], width: 100, height: 30 },
    ];
    expect(overlapScore(nodes, identityTransform, viewport)).toBe(0);
  });

  it('weights a central overlap more heavily than the same overlap near the rim', () => {
    // Identical coincident pairs, one at the center and one offset toward the
    // edge. Same intersection area, but the central pair must cost more.
    const central: DeoverlapNode[] = [
      { point: [0, 0], width: 80, height: 24 },
      { point: [0, 0], width: 80, height: 24 },
    ];
    const peripheral: DeoverlapNode[] = [
      { point: [0.5, 0], width: 80, height: 24 },
      { point: [0.5, 0], width: 80, height: 24 },
    ];
    const centralScore = overlapScore(central, identityTransform, viewport);
    const peripheralScore = overlapScore(peripheral, identityTransform, viewport);
    expect(peripheralScore).toBeGreaterThan(0);
    expect(centralScore).toBeGreaterThan(peripheralScore);
  });
});

describe('findBestRotation', () => {
  it('stays put when nothing overlaps', () => {
    const nodes: DeoverlapNode[] = [
      { point: [0.1, 0.1], width: 40, height: 20 },
      { point: [-0.1, -0.1], width: 40, height: 20 },
    ];
    const best = findBestRotation(nodes, identityTransform, viewport);
    expect(best.angle).toBe(0);
    expect(best.score).toBe(0);
  });

  it('finds an angle that removes overlap between two off-center labels', () => {
    // Two wide labels at mirrored points along the x-axis overlap head-on; a
    // quarter turn moves them onto the y-axis where their boxes clear.
    const nodes: DeoverlapNode[] = [
      { point: [0.18, 0], width: 220, height: 28 },
      { point: [-0.18, 0], width: 220, height: 28 },
    ];
    const before = overlapScore(nodes, identityTransform, viewport);
    expect(before).toBeGreaterThan(0);

    const best = findBestRotation(nodes, identityTransform, viewport);
    expect(best.score).toBeLessThan(before);

    const rotated = composeTransforms(rotationTransform(best.angle), identityTransform);
    expect(overlapScore(nodes, rotated, viewport)).toBe(best.score);
  });

  it('never returns a rotation larger than the cap', () => {
    const nodes: DeoverlapNode[] = [
      { point: [0.18, 0], width: 220, height: 28 },
      { point: [-0.18, 0], width: 220, height: 28 },
    ];
    const best = findBestRotation(nodes, identityTransform, viewport);
    expect(Math.abs(best.angle)).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
  });

  it('honors a tighter custom angle cap', () => {
    const nodes: DeoverlapNode[] = [
      { point: [0.18, 0], width: 220, height: 28 },
      { point: [-0.18, 0], width: 220, height: 28 },
    ];
    const best = findBestRotation(nodes, identityTransform, viewport, {
      maxAngle: Math.PI / 6,
      minImprovement: 0,
    });
    expect(Math.abs(best.angle)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
  });

  it('stays put when no rotation meets the improvement threshold', () => {
    // Two labels straddling the center overlap at every angle (their boxes always
    // intersect near the origin), so the best achievable reduction is partial. A
    // near-total improvement requirement can never be met, forcing a stay.
    const nodes: DeoverlapNode[] = [
      { point: [0.02, 0], width: 200, height: 60 },
      { point: [-0.02, 0], width: 200, height: 60 },
    ];
    const best = findBestRotation(nodes, identityTransform, viewport, {
      minImprovement: 0.999,
    });
    expect(best.angle).toBe(0);
  });

  it('rotates when the improvement clears the threshold', () => {
    const nodes: DeoverlapNode[] = [
      { point: [0.18, 0], width: 220, height: 28 },
      { point: [-0.18, 0], width: 220, height: 28 },
    ];
    const best = findBestRotation(nodes, identityTransform, viewport, {
      minImprovement: 0.25,
    });
    expect(best.angle).not.toBe(0);
  });
});

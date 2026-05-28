// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { _safeShapeHitTest } from '../src/renderer/hooks/useDrillNavigation';
import type {
  ShapeLayout,
  ShapePluginModule,
  ShapePuckAxes,
  ShapeRingRadii,
} from '../src/shared/shape-plugin-api';

/**
 * Defensive wrap around a shape plugin's `hitTest` (#107 PR3c). The
 * wedge default's sector resolution is pure host code (axesToSector)
 * and can't throw; a shape plugin's `hitTest` is third-party code
 * called at frame rate, so it gets a try / catch plus return-shape
 * normalisation. These tests pin the contract so a future refactor
 * can't silently widen what a plugin is allowed to return.
 */

const FAKE_RING_RADII: ShapeRingRadii = {
  cancelRadius: 10,
  innerInnerRadius: 10,
  innerOuterRadius: 50,
  innerLabelRadius: 30,
  outerInnerRadius: 60,
  outerOuterRadius: 120,
  outerLabelRadius: 90,
};

const FAKE_LAYOUT: ShapeLayout = {
  nodes: Array.from({ length: 4 }, (_, i) => ({ cx: i * 10, cy: 0, r: 8 })),
  labels: Array.from({ length: 4 }, (_, i) => ({ x: i * 10, y: 20, anchor: 'middle' as const })),
};

const ZERO_AXES: ShapePuckAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };

function makeModule(hitTest: ShapePluginModule['hitTest']): ShapePluginModule {
  return {
    layout: () => FAKE_LAYOUT,
    hitTest,
  };
}

describe('_safeShapeHitTest', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('passes through a valid integer sector index', () => {
    const mod = makeModule(() => 2);
    expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBe(2);
  });

  it('passes through null (no sector hovered)', () => {
    const mod = makeModule(() => null);
    expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
  });

  it('catches a throw and folds to null', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = makeModule(() => {
      throw new Error('plugin bug');
    });
    expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hitTest() threw'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('plugin bug'));
  });

  it('folds a negative index to null', () => {
    // -1 % 5 = -1 in JS; without the guard a negative index would
    // hit currentRing[-1] downstream, which is undefined and could
    // surface as a phantom hover.
    const mod = makeModule(() => -1);
    expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
  });

  it('folds an out-of-range index to null', () => {
    const mod = makeModule(() => 99);
    expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
    // Exactly sectorCount is also out of range (sectors are 0..N-1).
    const modBoundary = makeModule(() => 4);
    expect(_safeShapeHitTest(modBoundary, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
  });

  it('folds a non-integer index to null', () => {
    // 1.5 % 5 = 1.5 → fractional index used as array key gives
    // undefined. The guard catches this before it propagates.
    const mod = makeModule(() => 1.5);
    expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
  });

  it('folds NaN / Infinity to null', () => {
    const modNaN = makeModule(() => NaN);
    expect(_safeShapeHitTest(modNaN, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
    const modInf = makeModule(() => Infinity);
    expect(_safeShapeHitTest(modInf, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
  });

  it('folds non-number returns to null (a buggy plugin returns a string / object)', () => {
    // The contract types say number | null, but a JavaScript plugin can
    // return anything. Each non-conforming type collapses to null.
    for (const bad of ['1', '2', true, false, undefined, { sector: 1 }, [1], () => 1]) {
      const mod = makeModule(() => bad as unknown as number | null);
      expect(_safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, ZERO_AXES)).toBeNull();
    }
  });

  it('passes the same arguments to the plugin that the host received', () => {
    // Smoke check that the wrap doesn't transform the axes / ringRadii /
    // layout before handing them to the plugin (a future refactor that
    // accidentally rotated or scaled the axes would change plugin
    // behaviour silently).
    let received: { axes: unknown; ringRadii: unknown; layout: unknown } | null = null;
    const mod = makeModule((axes, ringRadii, layout) => {
      received = { axes, ringRadii, layout };
      return 0;
    });
    const axes: ShapePuckAxes = { tx: 1, ty: 2, tz: 3, rx: 4, ry: 5, rz: 6 };
    _safeShapeHitTest(mod, FAKE_RING_RADII, FAKE_LAYOUT, axes);
    expect(received).not.toBeNull();
    expect(received).toEqual({ axes, ringRadii: FAKE_RING_RADII, layout: FAKE_LAYOUT });
  });
});

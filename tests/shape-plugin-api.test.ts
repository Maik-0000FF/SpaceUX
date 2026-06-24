// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { validateShapeLayout, validateShapePluginModule } from '../src/shared/shape-plugin-api';

function validLayout(sectorCount: number): unknown {
  const nodes = Array.from({ length: sectorCount }, (_, i) => ({
    cx: i * 10,
    cy: i * 5,
    r: 12,
  }));
  const labels = Array.from({ length: sectorCount }, (_, i) => ({
    x: i * 10,
    y: i * 5 + 20,
    anchor: 'middle' as const,
  }));
  return { nodes, labels };
}

/**
 * The shape-plugin module validator (#107 PR2). Narrow on purpose: only
 * checks the two function exports exist so a plugin can grow extra
 * exports without breaking load. These tests pin that contract.
 */
describe('validateShapePluginModule', () => {
  it('accepts a module with layout + hitTest as functions', () => {
    expect(validateShapePluginModule({ layout: () => ({}), hitTest: () => null })).toBeNull();
  });

  it('accepts a module that carries extra fields beyond the contract', () => {
    // Future-proofing: a plugin author may export helpers / metadata
    // alongside the contract functions. The validator must not reject
    // anything it doesn't explicitly require.
    expect(
      validateShapePluginModule({
        layout: () => ({}),
        hitTest: () => null,
        meta: { version: '0.1.0' },
        default: { name: 'whatever' },
      }),
    ).toBeNull();
  });

  it('rejects non-object inputs', () => {
    for (const bad of [null, undefined, 42, 'hello', true, []]) {
      const reason = validateShapePluginModule(bad);
      expect(reason, `input=${JSON.stringify(bad)}`).not.toBeNull();
    }
  });

  it('rejects a module missing `layout`', () => {
    expect(validateShapePluginModule({ hitTest: () => null })).toMatch(/`layout`/);
  });

  it('rejects a module missing `hitTest`', () => {
    expect(validateShapePluginModule({ layout: () => ({}) })).toMatch(/`hitTest`/);
  });

  it('rejects a module where layout is not a function (e.g. an object stub)', () => {
    expect(validateShapePluginModule({ layout: { nodes: [] }, hitTest: () => null })).toMatch(
      /`layout`/,
    );
  });

  it('rejects a module where hitTest is not a function', () => {
    expect(validateShapePluginModule({ layout: () => ({}), hitTest: 'not a function' })).toMatch(
      /`hitTest`/,
    );
  });
});

/**
 * The defensive layout-output validator (#107 PR3b). PR2's module
 * validator only checks the function exports exist; this one checks
 * what `layout(...)` actually returns at call time, so the renderer
 * never has to trust a third-party plugin's runtime output blindly.
 */
describe('validateShapeLayout', () => {
  it('accepts a layout matching the sector count', () => {
    const r = validateShapeLayout(validLayout(4), 4);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layout.nodes).toHaveLength(4);
      expect(r.layout.labels).toHaveLength(4);
    }
  });

  it('rejects non-object returns', () => {
    for (const bad of [null, undefined, 42, 'hello', true, []]) {
      expect(validateShapeLayout(bad, 1).ok, `input=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('rejects when nodes / labels are missing or not arrays', () => {
    expect(validateShapeLayout({ labels: [] }, 0).ok).toBe(false);
    expect(validateShapeLayout({ nodes: [] }, 0).ok).toBe(false);
    expect(validateShapeLayout({ nodes: 'oops', labels: [] }, 0).ok).toBe(false);
    expect(validateShapeLayout({ nodes: [], labels: 'oops' }, 0).ok).toBe(false);
  });

  it('rejects a mismatched sector count (nodes too short / too long)', () => {
    expect(validateShapeLayout(validLayout(3), 4).ok).toBe(false);
    expect(validateShapeLayout(validLayout(5), 4).ok).toBe(false);
  });

  it('rejects a node missing a coordinate or with non-finite values', () => {
    // Take a valid 1-node layout and corrupt one field at a time. Each must
    // be caught with a reason naming the offending key.
    const base = validLayout(1) as {
      nodes: Array<Record<string, unknown>>;
      labels: Array<Record<string, unknown>>;
    };
    const broken = (mutate: (n: Record<string, unknown>) => void): unknown => {
      const out = JSON.parse(JSON.stringify(base)) as typeof base;
      mutate(out.nodes[0]!);
      return out;
    };
    expect(
      validateShapeLayout(
        broken((n) => delete n.cx),
        1,
      ).ok,
    ).toBe(false);
    expect(
      validateShapeLayout(
        broken((n) => {
          n.cx = NaN;
        }),
        1,
      ).ok,
    ).toBe(false);
    expect(
      validateShapeLayout(
        broken((n) => {
          n.cy = Infinity;
        }),
        1,
      ).ok,
    ).toBe(false);
    expect(
      validateShapeLayout(
        broken((n) => {
          n.r = 'big' as unknown as number;
        }),
        1,
      ).ok,
    ).toBe(false);
  });

  it('rejects a negative node radius', () => {
    const bad = validLayout(1) as { nodes: Array<{ r: number }> };
    bad.nodes[0]!.r = -5;
    const r = validateShapeLayout(bad, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/r must be non-negative/);
  });

  it('rejects a label with a non-finite coordinate', () => {
    const bad = validLayout(1) as { labels: Array<{ x: number; y: number }> };
    bad.labels[0]!.x = NaN;
    expect(validateShapeLayout(bad, 1).ok).toBe(false);
  });

  it('rejects an unknown text anchor', () => {
    const bad = validLayout(1) as { labels: Array<{ anchor: unknown }> };
    bad.labels[0]!.anchor = 'centre'; // valid SVG-y word, but not one we accept
    const r = validateShapeLayout(bad, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/anchor/);
  });

  it('accepts all three text-anchor enum values', () => {
    for (const a of ['start', 'middle', 'end'] as const) {
      const layout = validLayout(1) as { labels: Array<{ anchor: 'start' | 'middle' | 'end' }> };
      layout.labels[0]!.anchor = a;
      expect(validateShapeLayout(layout, 1).ok, `anchor=${a}`).toBe(true);
    }
  });

  it('accepts a zero-sector layout (empty pie)', () => {
    // The active ring can be empty (a menu pruned down to just the centre);
    // the validator must not require sectors to exist.
    expect(validateShapeLayout({ nodes: [], labels: [] }, 0).ok).toBe(true);
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { buildPieSvg, pieRenderExtent, type PieSvgAppearance } from '../src/core/pie-svg';
import { depthDotLayout, ringRadii } from '../src/core/pie-geometry';
import { menuTreeDepth } from '../src/core/menu-nav';
import type { PieLabel } from '../src/shared/pie-scene';
import { BUILTIN_ACTION, DEFAULT_MENU_CONFIG, builtinAction } from '../src/shared/menu';
import type { MenuConfig, MenuNode } from '../src/shared/menu';
import type { ShapeLayout, ShapePluginModule, ShapeRingSlot } from '../src/shared/shape-plugin-api';

const APP: PieSvgAppearance = {
  theme: 'dark',
  opacity: 0.6,
  ringBalance: 0.5,
  centerBalance: 0.5,
  labelScale: 1,
  iconScale: 1,
  wedgeStyle: 'classic',
  wedgeGapStyle: 'parallel',
  wedgeGap: 0.027,
  wedgeHoverOffset: 0,
  fontFamily: 'Inter SemiBold',
  showSubmenuMarkers: true,
  showDepthDots: true,
};
const FOOTPRINT = 196;

const leaf = (label: string): MenuNode => ({ label });
const branch = (label: string, branches: MenuNode[]): MenuNode => ({ label, branches });
const cfg = (branches: MenuNode[]): MenuConfig => ({
  ...DEFAULT_MENU_CONFIG,
  root: { label: '', branches },
});
const svgFor = (
  config: MenuConfig,
  navigation: readonly number[],
  activeSector: number | null,
  appearance: PieSvgAppearance = APP,
): string => buildPieSvg({ config, navigation, activeSector, appearance, footprint: FOOTPRINT });
const circles = (svg: string): number => (svg.match(/<circle/g) ?? []).length;

describe('buildPieSvg', () => {
  it('emits a valid <svg> with a viewBox', () => {
    const svg = svgFor(cfg([leaf('A')]), [], null);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox=');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('one wedge + one label per top-level item, plus the centre disc', () => {
    const svg = svgFor(cfg([leaf('A'), leaf('B'), leaf('C')]), [], null);
    expect((svg.match(/<path/g) ?? []).length).toBe(3);
    for (const t of ['A', 'B', 'C']) expect(svg).toContain(`>${t}</text>`);
    expect(svg).toContain('<circle'); // the centre disc
  });

  it('modern wedges are rim-less + gapped; classic keeps the rim (#47)', () => {
    const config = cfg([leaf('A'), leaf('B'), leaf('C')]);
    const classic = svgFor(config, [], null);
    const parallel = svgFor(config, [], null, { ...APP, wedgeStyle: 'modern' });
    const radial = svgFor(config, [], null, {
      ...APP,
      wedgeStyle: 'modern',
      wedgeGapStyle: 'wedge',
    });
    // Classic strokes each wedge rim; the modern style drops it on the wedge
    // <path>s (the gap is the separator).
    expect(/<path[^>]*stroke=/.test(classic)).toBe(true);
    expect(/<path[^>]*stroke=/.test(parallel)).toBe(false);
    expect(/<path[^>]*stroke=/.test(radial)).toBe(false);
    // The gap geometry differs from classic and between the two gap shapes.
    expect(parallel).not.toBe(classic);
    expect(parallel).not.toBe(radial);
  });

  it('grows the hovered wedge geometry when modern + hover offset > 0 (#47 PR3)', () => {
    const config = cfg([leaf('A'), leaf('B'), leaf('C')]);
    const popped = svgFor(config, [], 0, { ...APP, wedgeStyle: 'modern', wedgeHoverOffset: 0.04 });
    const flat = svgFor(config, [], 0, { ...APP, wedgeStyle: 'modern', wedgeHoverOffset: 0 });
    const classicPop = svgFor(config, [], 0, {
      ...APP,
      wedgeStyle: 'classic',
      wedgeHoverOffset: 0.04,
    });
    const classicFlat = svgFor(config, [], 0, {
      ...APP,
      wedgeStyle: 'classic',
      wedgeHoverOffset: 0,
    });
    // The hovered wedge's path changes (the outset re-geometries it), but no SVG
    // transform is used (the form is preserved by recomputing radii/gap).
    expect(popped).not.toBe(flat);
    expect(popped).not.toContain('transform="translate(');
    // Classic wedges never pop, with or without a hover offset.
    expect(classicPop).toBe(classicFlat);
  });

  it('outsets the hovered wedge blur polygon by the same offset (#47 PR3)', () => {
    const config = cfg([leaf('A'), leaf('B'), leaf('C')]);
    const popped: number[][] = [];
    const flat: number[][] = [];
    const at = (offset: number, out: number[][]): void => {
      buildPieSvg({
        config,
        navigation: [],
        activeSector: 0,
        appearance: { ...APP, wedgeStyle: 'modern', wedgeHoverOffset: offset },
        footprint: FOOTPRINT,
        wedgePolygonsOut: out,
      });
    };
    at(0.04, popped);
    at(0, flat);
    const maxAbs = (p: number[]): number => Math.max(...p.map((v) => Math.abs(v)));
    // Sector 0 is the active wedge; its polygon grows outward, the others don't.
    expect(maxAbs(popped[0]!)).toBeGreaterThan(maxAbs(flat[0]!));
    expect(popped[1]).toEqual(flat[1]);
  });

  it('grows the hovered wedge label with the pop (#47 PR3)', () => {
    const config = cfg([leaf('AA'), leaf('BB'), leaf('CC')]);
    const labels: PieLabel[] = [];
    buildPieSvg({
      config,
      navigation: [],
      activeSector: 0,
      appearance: { ...APP, wedgeStyle: 'modern', wedgeHoverOffset: 0.1 },
      footprint: FOOTPRINT,
      emitLabelText: false,
      labelsOut: labels,
    });
    const hovered = labels.find((l) => l.text === 'AA')!;
    const idle = labels.find((l) => l.text === 'BB')!;
    // The hovered item's label is the same radius but a larger font.
    expect(hovered.fontPx).toBeGreaterThan(idle.fontPx);
  });

  it('grows the centre disc + label when the centre is the hovered target (#47 PR3)', () => {
    const config = cfg([leaf('A'), leaf('B')]);
    const at = (offset: number, labels: PieLabel[]): string =>
      buildPieSvg({
        config,
        navigation: [],
        activeSector: null, // the puck is at the centre
        appearance: { ...APP, wedgeStyle: 'modern', wedgeHoverOffset: offset },
        footprint: FOOTPRINT,
        emitLabelText: false,
        labelsOut: labels,
      });
    const popped: PieLabel[] = [];
    const flat: PieLabel[] = [];
    const poppedSvg = at(0.1, popped);
    const flatSvg = at(0, flat);
    // The centre disc circle grows, and its ✕ label with it.
    const centreR = (svg: string): number =>
      Number(/<circle cx="0" cy="0" r="([0-9.]+)"/.exec(svg)![1]);
    expect(centreR(poppedSvg)).toBeGreaterThan(centreR(flatSvg));
    const cross = (ls: PieLabel[]): PieLabel => ls.find((l) => l.text === '✕')!;
    expect(cross(popped).fontPx).toBeGreaterThan(cross(flat).fontPx);
  });

  it('uses SVG-conformant colours: rgb() + fill-opacity, never rgba', () => {
    const svg = svgFor(cfg([leaf('A'), leaf('B')]), [], 0);
    expect(svg).not.toContain('rgba');
    expect(svg).toContain('fill-opacity="0.6"');
  });

  it('paints the hovered wedge with the active fill, the rest idle', () => {
    const svg = svgFor(cfg([leaf('A'), leaf('B')]), [], 0);
    expect(svg).toContain('fill="rgb(80, 110, 180)"'); // --pie-bg-active (sector 0)
    expect(svg).toContain('fill="rgb(20, 22, 28)"'); // --pie-bg idle (sector 1)
  });

  it('paints a cancel-action sector in the red cancel palette', () => {
    const cancel: MenuNode = {
      label: 'Cancel',
      action: { id: builtinAction(BUILTIN_ACTION.CANCEL) },
    };
    const svg = svgFor(cfg([cancel, leaf('B')]), [], null);
    expect(svg).toContain('fill="rgb(40, 22, 24)"'); // --pie-cancel-bg
  });

  it('a single-item ring is one wedge (full circle), not a half segment', () => {
    const svg = svgFor(cfg([leaf('Only')]), [], null);
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
    expect(svg).toContain('>Only</text>');
  });

  it('punches the centre hole out of wedges via fill-rule (a full-circle wedge is a ring, not a disc)', () => {
    // The single-sector full-circle wedge is two concentric circles; without
    // fill-rule="evenodd" the nonzero default fills the whole disc, so a lone
    // item's fill spills over the inner ring and centre. Every wedge carries it.
    const svg = svgFor(cfg([leaf('Only')]), [], 0);
    expect(svg).toMatch(/<path d="[^"]*" fill-rule="evenodd"/);
  });

  it('renders the root label, or the ✕ glyph when unset', () => {
    expect(
      svgFor({ ...DEFAULT_MENU_CONFIG, root: { label: 'Menu', branches: [leaf('A')] } }, [], null),
    ).toContain('>Menu</text>');
    expect(svgFor(cfg([leaf('A')]), [], null)).toContain('>✕</text>');
  });

  it('top-level hover of a branch previews its children on the dimmed outer band', () => {
    const config = cfg([branch('Files', [leaf('Open'), leaf('Save')]), leaf('Edit')]);
    const svg = svgFor(config, [], 0);
    expect(svg).toContain('>Open</text>'); // preview child
    expect(svg).toContain('opacity="0.55"'); // .pie-wedge.is-preview dim
  });

  it('drilled in: active outer ring + dimmed breadcrumb with the drilled-into anchor', () => {
    const config = cfg([branch('Files', [leaf('Open'), leaf('Save')]), leaf('Edit')]);
    const svg = svgFor(config, [0], 0);
    expect(svg).toContain('>Open</text>'); // outer active ring
    expect(svg).toContain('>Files</text>'); // inner breadcrumb
    expect(svg).toContain('opacity="0.35"'); // breadcrumb dim
    expect(svg).toContain('opacity="0.7"'); // drilled-into anchor
  });

  it('scales label font with the label slider', () => {
    const full = svgFor(cfg([leaf('A'), leaf('B'), leaf('C')]), [], null);
    const half = svgFor(cfg([leaf('A'), leaf('B'), leaf('C')]), [], null, {
      ...APP,
      labelScale: 0.5,
    });
    const sizeOf = (s: string): number =>
      Number(/font-size="([\d.]+)"[^>]*>A<\/text>/.exec(s)?.[1] ?? 0);
    expect(sizeOf(full)).toBeGreaterThan(0);
    expect(sizeOf(half)).toBeCloseTo(sizeOf(full) / 2);
  });

  it('switches the palette with the theme', () => {
    const spaceux = svgFor(cfg([leaf('A')]), [], 0, { ...APP, theme: 'spaceux' });
    expect(spaceux).toContain('fill="rgb(0, 120, 170)"'); // spaceux --pie-bg-active
  });

  it('emits an <image> for a data-image icon, and none without one', () => {
    const icon = 'data:image/png;base64,AAAA';
    const withIcon = svgFor(cfg([{ label: 'Doc', icon }, leaf('B')]), [], null);
    expect(withIcon).toContain(`<image xlink:href="${icon}"`);
    expect(withIcon).toContain('>Doc</text>'); // icon stacked above the label
    expect(svgFor(cfg([leaf('A')]), [], null)).not.toContain('<image');
  });

  it('hides a labelHidden node label while the wedge stays (#515)', () => {
    expect(svgFor(cfg([leaf('Hello'), leaf('B')]), [], null)).toContain('>Hello</text>');
    const hidden = svgFor(cfg([{ label: 'Hello', labelHidden: true }, leaf('B')]), [], null);
    expect(hidden).not.toContain('>Hello</text>');
    expect(hidden).toContain('>B</text>'); // the sibling wedge is unaffected
  });

  it('hides an iconHidden node icon while its label stays (#515)', () => {
    const icon = 'data:image/png;base64,AAAA';
    const hidden = svgFor(cfg([{ label: 'Doc', icon, iconHidden: true }, leaf('B')]), [], null);
    expect(hidden).not.toContain('<image');
    expect(hidden).toContain('>Doc</text>'); // the label still renders
  });

  it('hides the centre label and its ✕ fallback when the root labelHidden (#515)', () => {
    const root = { label: 'Menu', labelHidden: true, branches: [leaf('A')] };
    const svg = svgFor({ ...DEFAULT_MENU_CONFIG, root }, [], null);
    expect(svg).not.toContain('>Menu</text>');
    expect(svg).not.toContain('>✕</text>');
  });

  it('global hideLabels removes every label, hideIcons every icon (#518)', () => {
    const icon = 'data:image/png;base64,AAAA';
    const withBoth = cfg([
      { label: 'A', icon },
      { label: 'B', icon },
    ]);
    const noLabels = svgFor(withBoth, [], null, { ...APP, hideLabels: true });
    expect(noLabels).not.toContain('>A</text>');
    expect(noLabels).not.toContain('>B</text>');
    expect(noLabels).toContain('<image'); // icons unaffected
    const noIcons = svgFor(withBoth, [], null, { ...APP, hideIcons: true });
    expect(noIcons).not.toContain('<image');
    expect(noIcons).toContain('>A</text>'); // labels unaffected
  });

  it('a per-item false flag forces a part shown over a global hide (#520)', () => {
    const icon = 'data:image/png;base64,AAAA';
    const overrides = cfg([
      { label: 'A' }, // inherits the global hide
      { label: 'B', labelHidden: false, icon, iconHidden: false }, // forced shown
    ]);
    const svg = svgFor(overrides, [], null, { ...APP, hideLabels: true, hideIcons: true });
    expect(svg).not.toContain('>A</text>'); // A inherits global hide
    expect(svg).toContain('>B</text>'); // B's label forced shown
    expect(svg).toContain(`<image xlink:href="${icon}"`); // B's icon forced shown
  });

  it('a per-item true flag hides a part with no global hide (#520)', () => {
    const svg = svgFor(cfg([{ label: 'A', labelHidden: true }, leaf('B')]), [], null);
    expect(svg).not.toContain('>A</text>'); // forced hidden
    expect(svg).toContain('>B</text>'); // sibling unaffected
  });

  it('gives icons ring-unique ids so a submenu preview cannot collide with the active ring', () => {
    // A flattenable SVG icon (carries an id), placed on items in two rings at the
    // same index. With a per-segment-only uid the flattened ids collided across
    // the inner and outer ring, and a userSpaceOnUse gradient then rendered
    // against the first occurrence's coordinates, blanking the other icon.
    const ICON =
      'data:image/svg+xml;base64,' +
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>',
      ).toString('base64');
    const ic = (label: string, branches?: MenuNode[]): MenuNode =>
      branches ? { label, icon: ICON, branches } : { label, icon: ICON };
    // Hovering P (index 0) at the top level: the inner ring shows the root items
    // and the outer ring previews P's children, both with an icon at index 0.
    const svg = svgFor(cfg([ic('P', [ic('X'), ic('Y')]), ic('Q')]), [], 0);
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0); // icons actually flattened (ids emitted)
    expect(new Set(ids).size).toBe(ids.length); // and every id is unique
  });

  it('paints the centre in the cancel palette when the root is a cancel target', () => {
    const cancelRoot: MenuConfig = {
      ...DEFAULT_MENU_CONFIG,
      root: {
        label: '',
        action: { id: builtinAction(BUILTIN_ACTION.CANCEL) },
        branches: [leaf('A')],
      },
    };
    // Centre active (nothing hovered) -> bright cancel fill on the cx=0/cy=0 disc.
    expect(svgFor(cancelRoot, [], null)).toMatch(
      /<circle cx="0" cy="0"[^>]*fill="rgb\(180, 80, 80\)"/,
    );
    // Centre idle (a sector hovered) -> dim cancel fill.
    expect(svgFor(cancelRoot, [], 0)).toMatch(/<circle cx="0" cy="0"[^>]*fill="rgb\(40, 22, 24\)"/);
  });

  it('renders the depth-dot row and grows it with menu tree depth', () => {
    const flat = svgFor(cfg([leaf('A'), leaf('B')]), [], null);
    const deep = svgFor(cfg([branch('A', [branch('B', [leaf('C')])])]), [], null);
    expect(circles(flat)).toBeGreaterThan(1); // centre disc + at least one depth dot
    expect(circles(deep)).toBeGreaterThan(circles(flat));
  });

  it('rings each branch sector with a submenu-marker arc (isolated at constant tree depth)', () => {
    // Both menus have tree depth 2 -> identical depth-dot count; the only circle
    // difference is the second branch's submenu marker. Every branch in the
    // level shows its depth arc, not just the active one.
    const oneBranch = svgFor(cfg([branch('A', [leaf('x')]), leaf('B')]), [], null);
    const twoBranch = svgFor(cfg([branch('A', [leaf('x')]), branch('B', [leaf('y')])]), [], null);
    expect(circles(twoBranch)).toBe(circles(oneBranch) + 1);
  });

  it('markers follow the hovered branch child level (preview band), not its siblings', () => {
    // Hovering branch A opens its preview band (A's children), so the markers
    // describe A's children rather than the parent ring: A's sibling B never
    // contributes. A nests a branch (so its child level has a marker); B nests
    // only a leaf (no marker). If the markers stuck on the parent ring both
    // hovers would draw A's + B's arcs and match; the engaged-band rule makes
    // hovering A draw more than hovering B.
    const config = cfg([branch('A', [branch('GA', [leaf('z')])]), branch('B', [leaf('y')])]);
    const hoverA = circles(svgFor(config, [], 0));
    const hoverB = circles(svgFor(config, [], 1));
    expect(hoverA).toBeGreaterThan(hoverB);
  });

  it('centres text via an explicit baseline offset, not dominant-baseline (Qt-safe)', () => {
    const svg = svgFor(
      { ...DEFAULT_MENU_CONFIG, root: { label: 'Menu', branches: [leaf('A')] } },
      [],
      null,
    );
    // Qt's SVG renderer ignores dominant-baseline, so the graphic must not rely
    // on it; the alphabetic baseline is offset down instead (renderer-agnostic).
    expect(svg).not.toContain('dominant-baseline');
    // The centre label's visual centre is y=0, so its baseline lands below 0.
    const m = /<text x="0" y="([\d.-]+)"[^>]*>Menu<\/text>/.exec(svg);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it('gates the submenu markers and depth dots on their appearance toggles', () => {
    const config = cfg([branch('A', [leaf('x')]), branch('B', [leaf('y')])]);
    const both = circles(svgFor(config, [], null));
    const noMarkers = circles(svgFor(config, [], null, { ...APP, showSubmenuMarkers: false }));
    const noDots = circles(svgFor(config, [], null, { ...APP, showDepthDots: false }));
    const neither = circles(
      svgFor(config, [], null, { ...APP, showSubmenuMarkers: false, showDepthDots: false }),
    );
    expect(noMarkers).toBeLessThan(both); // markers dropped
    expect(noDots).toBeLessThan(both); // dots dropped
    expect(neither).toBeLessThan(Math.min(noMarkers, noDots)); // only the centre disc-ish remains
  });

  it('drills two levels: inner = the level-1 breadcrumb, outer = the level-2 ring', () => {
    const config = cfg([
      branch('Files', [branch('Recent', [leaf('Doc1'), leaf('Doc2')]), leaf('Save')]),
      leaf('Edit'),
    ]);
    const svg = svgFor(config, [0, 0], 0);
    expect(svg).toContain('>Recent</text>'); // inner breadcrumb, drilled-into anchor
    expect(svg).toContain('>Save</text>'); // inner breadcrumb sibling
    expect(svg).toContain('>Doc1</text>'); // outer active (level-2) ring
    expect(svg).not.toContain('>Files</text>'); // level 0 is off-screen two levels down
    expect(svg).toContain('opacity="0.7"'); // Recent = drilled-into anchor
  });
});

describe('buildPieSvg native-label collection (emitLabelText / labelsOut)', () => {
  const config = cfg([leaf('A'), leaf('B'), leaf('C')]);

  it('the default path is byte-identical with or without an explicit emitLabelText:true', () => {
    const a = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    const b = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
      emitLabelText: true,
    });
    expect(b).toBe(a);
  });

  it('emitLabelText:false drops every <text> but keeps geometry (paths, circles, viewBox)', () => {
    const withText = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    const noText = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
      emitLabelText: false,
    });
    expect(noText).not.toContain('<text');
    expect(withText).toContain('<text');
    // Geometry is unchanged: strip the <text> nodes from the default SVG and the
    // remainder is exactly the emitLabelText:false output.
    expect(withText.replace(/<text[^>]*>[^<]*<\/text>/g, '')).toBe(noText);
  });

  it('labelsOut collects one descriptor per visible label, geometry still emitted', () => {
    const labels: PieLabel[] = [];
    const svg = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
      emitLabelText: false,
      labelsOut: labels,
    });
    expect(svg).not.toContain('<text');
    // The three leaves + the centre ✕ fallback label.
    expect(labels.map((l) => l.text).sort()).toEqual(['A', 'B', 'C', '✕']);
    for (const l of labels) {
      expect(l.fontPx).toBeGreaterThan(0);
      expect(l.anchor).toBe('middle');
      expect(l.opacity).toBe(1);
      expect(typeof l.color).toBe('string');
    }
  });

  it('labelsOut x / y / fontPx match the <text> the SVG would emit (visual-centre y, pre-baseline)', () => {
    const labels: PieLabel[] = [];
    buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
      emitLabelText: false,
      labelsOut: labels,
    });
    const svg = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    const a = labels.find((l) => l.text === 'A')!;
    // The SVG baseline is the visual centre shifted DOWN by the cap-height/2 em.
    // Reconstruct the descriptor's y from the SVG and confirm they agree.
    const m = new RegExp(
      `<text x="([\\d.-]+)" y="([\\d.-]+)"[^>]*font-size="([\\d.]+)"[^>]*>A</text>`,
    ).exec(svg);
    expect(m).not.toBeNull();
    const svgX = Number(m![1]);
    const svgBaselineY = Number(m![2]);
    const svgFont = Number(m![3]);
    const BASELINE_CENTER_EM = 1490 / 2048 / 2;
    expect(a.x).toBeCloseTo(svgX);
    expect(a.fontPx).toBeCloseTo(svgFont);
    expect(a.y).toBeCloseTo(svgBaselineY - svgFont * BASELINE_CENTER_EM);
  });

  it('carries per-element opacity into the descriptor (breadcrumb dimming)', () => {
    const drill = cfg([branch('Files', [leaf('Open'), leaf('Save')]), leaf('Edit')]);
    const labels: PieLabel[] = [];
    buildPieSvg({
      config: drill,
      navigation: [0],
      activeSector: 0,
      appearance: APP,
      footprint: FOOTPRINT,
      emitLabelText: false,
      labelsOut: labels,
    });
    const files = labels.find((l) => l.text === 'Files')!;
    // The inner breadcrumb label dims to BREADCRUMB_LABEL_OPACITY (0.45).
    expect(files.opacity).toBeCloseTo(0.45);
  });

  it('the default path still emits <text> labels in the SVG', () => {
    // Default (emitLabelText defaulting true, no labelsOut): unchanged behaviour.
    const svg = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    for (const t of ['A', 'B', 'C']) expect(svg).toContain(`>${t}</text>`);
  });
});

describe('pieRenderExtent', () => {
  const ext = (config: MenuConfig, nav: readonly number[], active: number | null): number =>
    pieRenderExtent({
      config,
      navigation: nav,
      activeSector: active,
      footprint: FOOTPRINT,
      ringBalance: 0.5,
      centerBalance: 0.5,
    });

  it('grows from the inner ring to the outer ring when a preview / drill shows the outer band', () => {
    const config = cfg([branch('Files', [leaf('Open'), leaf('Save')]), leaf('Edit')]);
    const rings = ringRadii(FOOTPRINT, 0.5, 0.5);
    const idle = ext(config, [], null); // top level, nothing hovered -> inner band only
    const preview = ext(config, [], 0); // hovering the Files branch -> outer band shows
    const drilled = ext(config, [0], 0); // drilled into Files -> outer band is the active ring
    // The frosted radius is the wedge outer radius itself (no stroke margin, so
    // the hard QRegion edge sits under the antialiased rim, not past it).
    expect(idle).toBeCloseTo(rings.innerOuter);
    expect(idle).toBeLessThan(rings.outerOuter);
    expect(preview).toBeCloseTo(rings.outerOuter);
    expect(preview).toBeGreaterThan(idle);
    expect(drilled).toBeCloseTo(preview);
  });

  it('stays at the inner ring when the hovered top-level sector has no children', () => {
    const config = cfg([leaf('A'), leaf('B')]);
    expect(ext(config, [], 0)).toBeCloseTo(ext(config, [], null));
  });
});

describe('buildPieSvg shape plugins (#325)', () => {
  // A deterministic stand-in for a real shape plugin: each sector is a circle
  // on a horizontal row, the label below it. `ring` shifts the row down so the
  // inner and outer bands are distinguishable, and the label anchor is 'end' so
  // the test can prove the plugin-supplied anchor reaches the SVG (the wedge
  // path always centres). Pure JSON in/out, exactly the contract's shape.
  const fakeShape = (overrides: Partial<ShapePluginModule> = {}): ShapePluginModule => ({
    layout: (sectorCount: number, _radii, ring: ShapeRingSlot): ShapeLayout => {
      const yBase = ring === 'outer' ? 100 : 0;
      return {
        nodes: Array.from({ length: sectorCount }, (_, i) => ({ cx: i * 30, cy: yBase, r: 7 })),
        labels: Array.from({ length: sectorCount }, (_, i) => ({
          x: i * 30,
          y: yBase + 20,
          anchor: 'end' as const,
        })),
      };
    },
    hitTest: () => 0,
    ...overrides,
  });
  const pathCount = (svg: string): number => (svg.match(/<path/g) ?? []).length;
  // Markers + dots are circles too; turn them off so a circle count isolates
  // the shape nodes (+ the centre disc).
  const NODOTS: PieSvgAppearance = { ...APP, showSubmenuMarkers: false, showDepthDots: false };
  const shapeSvg = (
    config: MenuConfig,
    navigation: readonly number[],
    activeSector: number | null,
    shape: ShapePluginModule | null,
  ): string =>
    buildPieSvg({
      config,
      navigation,
      activeSector,
      appearance: NODOTS,
      footprint: FOOTPRINT,
      shape,
    });

  it('renders the ring as circles, not wedges, when a shape module is active', () => {
    const config = cfg([leaf('A'), leaf('B'), leaf('C')]);
    const svg = shapeSvg(config, [], null, fakeShape());
    // No wedge <path> for the bands; the three nodes + the centre disc are circles.
    expect(pathCount(svg)).toBe(0);
    expect(circles(svg)).toBe(4);
    for (const t of ['A', 'B', 'C']) expect(svg).toContain(`>${t}</text>`);
  });

  it('places labels at the plugin-supplied anchor (not the wedge-forced middle)', () => {
    // Two sectors → two end-anchored node labels; the centre label is still
    // middle-anchored, so the plugin anchor is what reaches the node labels.
    const svg = shapeSvg(cfg([leaf('A'), leaf('B')]), [], null, fakeShape());
    expect((svg.match(/text-anchor="end"/g) ?? []).length).toBe(2);
  });

  it('omitting the shape module keeps the wedge default', () => {
    const config = cfg([leaf('A'), leaf('B'), leaf('C')]);
    expect(pathCount(shapeSvg(config, [], null, null))).toBe(3);
  });

  it('marks the hovered node with the active fill, like the wedge path', () => {
    const svg = shapeSvg(cfg([leaf('A'), leaf('B')]), [], 0, fakeShape());
    expect(svg).toContain('fill="rgb(80, 110, 180)"'); // --pie-bg-active on the hovered node
    expect(svg).toContain('fill="rgb(20, 22, 28)"'); // --pie-bg idle on the other
  });

  it('falls back to wedges for the band when layout() throws', () => {
    const thrower = fakeShape({
      layout: () => {
        throw new Error('boom');
      },
    });
    expect(pathCount(shapeSvg(cfg([leaf('A'), leaf('B')]), [], null, thrower))).toBe(2);
  });

  it('falls back to wedges when layout() returns a malformed value', () => {
    // Wrong node count for the sector count: the validator rejects it.
    const malformed = fakeShape({
      layout: () => ({ nodes: [{ cx: 0, cy: 0, r: 1 }], labels: [] }) as ShapeLayout,
    });
    expect(pathCount(shapeSvg(cfg([leaf('A'), leaf('B')]), [], null, malformed))).toBe(2);
  });

  it('renders the outer band as nodes too once drilled in', () => {
    const config = cfg([branch('Files', [leaf('Open'), leaf('Save')]), leaf('Edit')]);
    // Drilled into Files: inner band = breadcrumb (2 nodes), outer = active ring
    // (2 nodes). All four are shape circles, no wedge <path>.
    const svg = shapeSvg(config, [0], null, fakeShape());
    expect(pathCount(svg)).toBe(0);
    for (const t of ['Open', 'Save']) expect(svg).toContain(`>${t}</text>`);
  });

  it('reports a fallback with band + reason when layout() throws', () => {
    const calls: Array<[string, string]> = [];
    buildPieSvg({
      config: cfg([leaf('A'), leaf('B')]),
      navigation: [],
      activeSector: null,
      appearance: NODOTS,
      footprint: FOOTPRINT,
      shape: fakeShape({
        layout: () => {
          throw new Error('boom');
        },
      }),
      onShapeFallback: (ring, reason) => calls.push([ring, reason]),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('inner');
    expect(calls[0]![1]).toMatch(/threw.*boom/);
  });

  it('reports a fallback with the validator reason when layout() is malformed', () => {
    const calls: Array<[string, string]> = [];
    buildPieSvg({
      config: cfg([leaf('A'), leaf('B')]),
      navigation: [],
      activeSector: null,
      appearance: NODOTS,
      footprint: FOOTPRINT,
      shape: fakeShape({
        layout: () => ({ nodes: [{ cx: 0, cy: 0, r: 1 }], labels: [] }) as ShapeLayout,
      }),
      onShapeFallback: (ring, reason) => calls.push([ring, reason]),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatch(/rejected/);
  });

  it('does not report a fallback when layout() succeeds', () => {
    const calls: Array<[string, string]> = [];
    buildPieSvg({
      config: cfg([leaf('A'), leaf('B')]),
      navigation: [],
      activeSector: null,
      appearance: NODOTS,
      footprint: FOOTPRINT,
      shape: fakeShape(),
      onShapeFallback: (ring, reason) => calls.push([ring, reason]),
    });
    expect(calls).toHaveLength(0);
  });
});

const svgIconUri = (svg: string): string =>
  `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
// A Breeze-style icon (the #403 case): <style> colour scheme + currentColor.
const BREEZE_ICON = svgIconUri(
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
    '<style>.ColorScheme-Text { color: #fcfcfc; }</style>' +
    '<g class="ColorScheme-Text" fill="currentColor"><path d="m8 2-4 4v4l4 4h1v-12z"/></g></svg>',
);
const RASTER_ICON = 'data:image/png;base64,iVBORw0KGgo=';

describe('icon embedding (#403)', () => {
  it('flattens an SVG segment icon to inline vectors instead of <image>', () => {
    const svg = svgFor(cfg([{ label: 'A', icon: BREEZE_ICON }]), [], null);
    expect(svg).toContain('fill="#fcfcfc"'); // currentColor resolved inline
    expect(svg).toContain('scale('); // placed via a group transform
    expect(svg).not.toContain('<image'); // never the blurry nested-SVG path
    expect(svg.toLowerCase()).not.toContain('currentcolor');
  });

  it('keeps a raster icon on the safe <image> path', () => {
    const svg = svgFor(cfg([{ label: 'A', icon: RASTER_ICON }]), [], null);
    expect(svg).toContain('<image');
    expect(svg).toContain(RASTER_ICON);
  });

  it('flattens the centre icon too', () => {
    const config: MenuConfig = {
      ...DEFAULT_MENU_CONFIG,
      root: { label: '', icon: BREEZE_ICON, branches: [leaf('A'), leaf('B')] },
    };
    const svg = buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    expect(svg).toContain('fill="#fcfcfc"');
    expect(svg).not.toContain('<image');
  });
});

describe('buildPieSvg depth-dot active level (#457 centreActive)', () => {
  // One level deep → three depth dots [centre, ring 1, ring 2].
  const twoDeep = cfg([branch('B', [leaf('B1')]), leaf('C')]);
  const fmt = (x: number): string => (Math.round(x * 1000) / 1000).toString();
  const esc = (s: string): string => s.replace(/[-.\\]/g, (c) => '\\' + c);

  // The depth dots' fill-opacities in layout (cx) order; the active one is 1,
  // the rest 0.5. Located by the exact cx/cy depthDotLayout produces.
  const depthDotOpacities = (svg: string, config: MenuConfig): number[] => {
    const rings = ringRadii(FOOTPRINT, APP.ringBalance, APP.centerBalance);
    const dots = depthDotLayout(FOOTPRINT, rings.outerOuter, 1 + menuTreeDepth(config));
    const cy = esc(fmt(dots.cy));
    return dots.xs.map((x) => {
      const m = new RegExp(
        `<circle cx="${esc(fmt(x))}" cy="${cy}" [^>]*fill-opacity="([\\d.]+)"`,
      ).exec(svg);
      return m && m[1] !== undefined ? parseFloat(m[1]) : -1;
    });
  };

  it('lights the centre dot when the centre is the active target (overlay default)', () => {
    // activeSector null with no centreActive override → centre active at the top.
    expect(depthDotOpacities(svgFor(twoDeep, [], null), twoDeep)).toEqual([1, 0.5, 0.5]);
  });

  it('lights the viewed-ring dot when the centre is not active (editor)', () => {
    const svg = buildPieSvg({
      config: twoDeep,
      navigation: [],
      activeSector: null,
      centreActive: false,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    expect(depthDotOpacities(svg, twoDeep)).toEqual([0.5, 1, 0.5]);
  });

  it('advances the lit dot as you drill in', () => {
    const svg = buildPieSvg({
      config: twoDeep,
      navigation: [0],
      activeSector: null,
      centreActive: false,
      appearance: APP,
      footprint: FOOTPRINT,
    });
    expect(depthDotOpacities(svg, twoDeep)).toEqual([0.5, 0.5, 1]);
  });
});

describe('menu-wide label + icon size (#182)', () => {
  const ICON = 'data:image/png;base64,iVBORw0KGgo=';
  const iconLeaf = (label: string): MenuNode => ({ label, icon: ICON });
  // A ring item's font (the last label pushed is a ring item; the centre is first).
  const ringFont = (config: MenuConfig): number => {
    const labels: PieLabel[] = [];
    buildPieSvg({
      config,
      navigation: [],
      activeSector: null,
      appearance: APP,
      footprint: FOOTPRINT,
      labelsOut: labels,
    });
    return labels.at(-1)!.fontPx;
  };
  const imageWidths = (svg: string): number[] =>
    [...svg.matchAll(/<image [^>]*\bwidth="([\d.]+)"/g)].map((m) => Number(m[1]));

  it('sizes the font from the whole tree, so a deeper submenu shrinks every level', () => {
    const children = Array.from({ length: 8 }, (_, i) => leaf(`Submenu item ${i}`));
    const shallow = cfg([leaf('AB'), leaf('CD'), leaf('EF')]);
    const deep = cfg([branch('AB', children), leaf('CD'), leaf('EF')]);
    // The deep submenu isn't shown at the top level, yet it pulls the shared font
    // below the shallow tree's: the size comes from the tree, not the visible ring.
    expect(ringFont(deep)).toBeLessThan(ringFont(shallow));
  });

  it('uses one font and one icon size across the inner and outer rings', () => {
    const config = cfg([
      branch(
        'Menu',
        Array.from({ length: 8 }, (_, i) => iconLeaf(`Submenu item ${i}`)),
      ),
      iconLeaf('CD'),
      iconLeaf('EF'),
    ]);
    // Hovering sector 0 previews its children in the outer ring while the three
    // top-level items fill the inner ring: every label + icon is one size.
    const labels: PieLabel[] = [];
    const svg = buildPieSvg({
      config,
      navigation: [],
      activeSector: 0,
      appearance: APP,
      footprint: FOOTPRINT,
      labelsOut: labels,
    });
    expect(labels.length).toBeGreaterThan(8);
    expect(new Set(labels.map((l) => l.fontPx)).size).toBe(1);
    const widths = imageWidths(svg);
    expect(widths.length).toBeGreaterThan(8);
    expect(new Set(widths).size).toBe(1);
  });
});

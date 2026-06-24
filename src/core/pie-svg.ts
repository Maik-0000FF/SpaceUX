// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Single source of the pie *graphic* (#344). Builds the whole pie as one SVG
 * string from the shared geometry (pie-geometry / pie-path) and the theme
 * palette, with the colours resolved inline (Qt SVG has no external CSS, and the
 * native overlay renders the same string the editor preview does). Pure: no DOM,
 * no IPC — the renderer and the unit tests share it.
 *
 * Coordinates are pie-centre-relative in a FIXED reference space (footprint
 * passed in); the pie-size zoom happens at render time (the renderer's Qt-SVG
 * display size), so the caps and strokes
 * stay in the reference space and scale with the whole graphic — no per-value
 * pieScale needed here.
 */

import { PALETTES, type Palette, type Rgb } from './overlay-theme.js';
import {
  ASIN_DOMAIN_CAP,
  clampAbs,
  describeModernWedgePath,
  describeWedgePath,
  sampledCirclePolygon,
  sampledWedgePolygon,
} from './pie-path.js';
import { flattenIconDataUri } from './svg-flatten.js';
import {
  centerIconFitPx,
  centerLabelFontPx,
  depthDotLayout,
  pieWindowExtent,
  ringRadii,
  sectorCenterAngle,
  segmentIconScaledPx,
  segmentLabelCharCapacity,
  segmentLabelFontPx,
  shapeRingRadii,
  submenuMarkerAngles,
  submenuMarkerOrbit,
  truncatePieLabel,
} from './pie-geometry.js';
import { isRenderableIcon } from '../shared/icon.js';
import type { PieWedgeGapStyle, PieWedgeStyle } from '../shared/ipc.js';
import { isCancelNode, type MenuConfig, type MenuNode } from '../shared/menu.js';
import type { PieLabel } from '../shared/pie-scene.js';
import {
  validateShapeLayout,
  type ShapeLayout,
  type ShapePluginModule,
  type ShapeRingRadii,
  type ShapeRingSlot,
} from '../shared/shape-plugin-api.js';
import {
  currentBranches,
  menuTreeDepth,
  navigationRingRotation,
  subtreeDepth,
} from './menu-nav.js';

const TAU = 2 * Math.PI;

/** The appearance inputs the graphic needs (a subset of PieAppearance). */
export type PieSvgAppearance = {
  theme: keyof typeof PALETTES;
  /** Wedge/centre fill alpha (the opacity slider, default 0.6). */
  opacity: number;
  ringBalance: number;
  centerBalance: number;
  /** Label/icon size sliders (fraction of the per-segment fit). */
  labelScale: number;
  iconScale: number;
  /** Built-in wedge render style (#47). `modern` draws gapped, rim-less wedges;
   *  `classic` (default) the historical edge-to-edge sectors. Has no effect on a
   *  band rendered by a shape plugin. */
  wedgeStyle: PieWedgeStyle;
  /** Modern-wedge gap shape: `parallel` (constant width) or `wedge` (radial,
   *  widening). Used only when `wedgeStyle` is `modern`. */
  wedgeGapStyle: PieWedgeGapStyle;
  /** Modern-wedge gap width as a fraction of the footprint. Used only when
   *  `wedgeStyle` is `modern`. */
  wedgeGap: number;
  /** Modern-wedge hover pop: the hovered wedge grows by this constant outset on
   *  every side (a fraction of the footprint; 0 = none). Used only when
   *  `wedgeStyle` is `modern`. */
  wedgeHoverOffset: number;
  /** Hide every label / icon menu-wide (#518), independent of the size scales
   *  and of the per-item flags. Optional and additive (absent = shown). */
  hideLabels?: boolean;
  hideIcons?: boolean;
  /** Label font family (resolved, e.g. "Inter SemiBold"). */
  fontFamily: string;
  /** Draw the submenu depth markers (the arc of dots outside a branch sector).
   *  Gates drawing only; the viewBox always reserves their space (#290
   *  toggle). */
  showSubmenuMarkers: boolean;
  /** Draw the depth-dot row below the pie. Gates drawing only (#290 toggle). */
  showDepthDots: boolean;
};

// State opacities mirroring style.css (.pie-wedge.is-preview / .is-breadcrumb /
// .is-breadcrumb.is-drilled-into, and the matching label opacities). Applied as
// the SVG element `opacity`, on top of the fill's `fill-opacity`.
const PREVIEW_OPACITY = 0.55;
const BREADCRUMB_OPACITY = 0.35;
const DRILLED_INTO_OPACITY = 0.7;
const PREVIEW_LABEL_OPACITY = 0.65;
const BREADCRUMB_LABEL_OPACITY = 0.45;

// Stroke widths at the reference footprint (mirrors style.css stroke-width 1.5).
const STROKE_PX = 1.5;

/** Resolved wedge geometry for a render (#47). `modern` drops the rim and adds a
 *  gap; `gap` is the gap width in reference units (0 = none); `gapStyle` picks a
 *  constant-width parallel channel or a radial, widening one. Classic style sets
 *  `modern` false and `gap` 0. */
type WedgeShape = {
  modern: boolean;
  gap: number;
  gapStyle: PieWedgeGapStyle;
};

// Samples per arc edge when a modern wedge is also emitted as a point polygon
// (the blur region + editor tint, #47 PR2). The polygon's chords sit just inside
// the rendered arc, so too few samples leave a thin unblurred sliver at the rim
// (visible on a popped wedge, #47 PR3). 32 keeps the chord error well under a
// pixel even for wide (2-3 sector) wedges, while the payload stays small.
const BLUR_WEDGE_ARC_SAMPLES = 32;

// Fixed gap (in the SVG's reference units) between a stacked icon and its
// label. A constant — not tied to the icon size nor the font size — so the
// spacing stays even whether the icons are large or the font is small (#439).
const ICON_LABEL_GAP_PX = 4;

const rgb = ([r, g, b]: Rgb): string => `rgb(${r}, ${g}, ${b})`;

/** Escape text for an XML/SVG text node or attribute value. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Round to a few decimals so the SVG string stays compact + deterministic. */
function n(x: number): string {
  return (Math.round(x * 1000) / 1000).toString();
}

/**
 * Draw a node icon into the box (x, y, size). An SVG icon is flattened to inline
 * vectors (#403) so Qt's QSvgRenderer paints it sharp, exactly like the pie's
 * own shapes — `<image>` would make Qt rasterise the nested SVG at its tiny
 * intrinsic size and upscale it (blurry). Raster icons, and any SVG too complex
 * to flatten safely, keep the `<image>` path (Qt scales a raster cleanly). The
 * group transform reproduces `preserveAspectRatio="xMidYMid meet"`: a uniform
 * scale to fit, centred in the box. `uid` namespaces the icon's ids so two
 * icons can't collide.
 */
function iconMarkup(
  icon: string,
  x: number,
  y: number,
  size: number,
  opacityAttr: string,
  uid: string,
): string {
  const flat = flattenIconDataUri(icon, uid);
  if (flat) {
    const [vx, vy, vw, vh] = flat.viewBox;
    const s = size / Math.max(vw, vh);
    const tx = x + (size - vw * s) / 2 - vx * s;
    const ty = y + (size - vh * s) / 2 - vy * s;
    return `<g transform="translate(${n(tx)},${n(ty)}) scale(${n(s)})"${opacityAttr}>${flat.inner}</g>`;
  }
  // xlink:href, not the SVG2 href: Qt's QSvgRenderer (the native overlay) is
  // SVG 1.1 and ignores a bare href on <image>, leaving a placeholder; xlink is
  // understood by both it and browsers. The root declares the xlink namespace.
  return `<image xlink:href="${esc(icon)}" x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" preserveAspectRatio="xMidYMid meet"${opacityAttr}/>`;
}

/** Which visual state a wedge/centre is in — drives fill + opacity. */
type WedgeState = {
  active: boolean;
  cancel: boolean;
  preview: boolean;
  breadcrumb: boolean;
  drilledInto: boolean;
};

/** Resolved paint for a wedge: inline fill / fill-opacity / stroke / element
 *  opacity, mirroring the .pie-wedge CSS family (idle/active, cancel red, and
 *  the preview/breadcrumb/drilled-into dimming). */
type WedgePaint = {
  fill: string;
  fillOpacity: number;
  stroke: string | null;
  elementOpacity: number;
};

function resolveWedgePaint(p: Palette, opacity: number, st: WedgeState): WedgePaint {
  // Idle vs active fill, swapped to the red cancel pair for a cancel target.
  const bg = st.cancel ? p.cancelBg : p.bg;
  const bgActive = st.cancel ? p.cancelBgActive : p.bgActive;
  let fillRgb = st.active ? bgActive : bg;
  let stroke: string | null = rgb(p.border);
  let elementOpacity = 1;
  if (st.preview) {
    elementOpacity = PREVIEW_OPACITY;
  } else if (st.breadcrumb && st.drilledInto) {
    // The "you came from here" anchor: brighter active fill, no rim.
    fillRgb = bgActive;
    stroke = null;
    elementOpacity = DRILLED_INTO_OPACITY;
  } else if (st.breadcrumb) {
    elementOpacity = BREADCRUMB_OPACITY;
  }
  return { fill: rgb(fillRgb), fillOpacity: opacity, stroke, elementOpacity };
}

/** Pick the wedge path for the resolved {@link WedgeShape}: the classic annular
 *  sector, the parallel constant-width gapped wedge, or the radial widening one.
 *  A lone full-circle wedge (1-sector ring) has no neighbour to gap against, so
 *  it always uses the classic donut path. */
function wedgePathFor(
  rOuter: number,
  rInner: number,
  a: number,
  b: number,
  shape: WedgeShape,
): string {
  const sweep = b - a;
  if (!shape.modern || shape.gap <= 0 || sweep >= TAU - 1e-9) {
    return describeWedgePath(rOuter, rInner, a, b);
  }
  if (shape.gapStyle === 'wedge') {
    // Radial gap: trim each side by the angle that makes the channel ~gap wide at
    // the rim (so the slider means roughly the same width as the parallel style).
    const half = Math.asin(clampAbs(shape.gap / 2, rOuter * ASIN_DOMAIN_CAP) / rOuter);
    return describeWedgePath(rOuter, rInner, a + half, b - half);
  }
  return describeModernWedgePath(rOuter, rInner, a, b, shape.gap);
}

/** One wedge `<path>` with inline paint. `index`/`sectorCount`/`rotation` match
 *  the sector layout (sector 0 at 12 o'clock + rotation, each wedge a full sector
 *  wide; a 1-sector ring sweeps the full circle via describeWedgePath). For the
 *  modern style a hovered wedge "pops" by a constant `hover.offset` outset on
 *  every side (the form is unchanged, just bigger): the inner radius moves in and
 *  the outer radius out by `offset`, and each side edge moves out by `offset` via
 *  a gap shrunk by `2*offset`. The SAME expanded geometry feeds the path and the
 *  blur polygon, so the frost tracks the fill. */
function wedgeSvg(
  index: number,
  sectorCount: number,
  rOuter: number,
  rInner: number,
  rotation: number,
  paint: WedgePaint,
  shape: WedgeShape,
  hover: { active: boolean; offset: number },
  /** When a modern wedge is rendered, its matching point polygon is pushed here
   *  for the blur region + editor tint (#47 PR2). Omitted = no collection. */
  polygonsOut?: number[][],
): string {
  const sectorWidth = TAU / sectorCount;
  const startAngle = sectorCenterAngle(index, sectorCount) + rotation - sectorWidth / 2;
  const endAngle = startAngle + sectorWidth;
  // Hover pop (modern, non-full-circle only): a constant outset on every side,
  // not a scale, so the wedge keeps its shape. The radii grow by `offset`; the
  // side edges grow by `offset` too via a gap reduced by 2*offset. The gap may go
  // negative (the sides grow PAST their separators, so the popped wedge overlaps
  // its neighbours, drawn on top), which keeps the lateral growth equal to the
  // radial growth instead of saturating once the gap closes.
  const pop = shape.modern && hover.active && hover.offset > 0 && sectorWidth < TAU - 1e-9;
  const rOut = pop ? rOuter + hover.offset : rOuter;
  const rIn = pop ? Math.max(0, rInner - hover.offset) : rInner;
  const effShape: WedgeShape = pop
    ? { modern: shape.modern, gap: shape.gap - 2 * hover.offset, gapStyle: shape.gapStyle }
    : shape;
  // The blur polygon uses the SAME geometry as the painted fill (popped included),
  // so the frost is congruent with the coloured wedge. Any visible edge softness
  // is the compositor blur's falloff, not a geometry difference.
  if (polygonsOut && shape.modern) {
    polygonsOut.push(
      sectorWidth >= TAU - 1e-9
        ? sampledCirclePolygon(rOut, BLUR_WEDGE_ARC_SAMPLES)
        : sampledWedgePolygon(
            rOut,
            rIn,
            startAngle,
            endAngle,
            effShape.gap,
            effShape.gapStyle,
            BLUR_WEDGE_ARC_SAMPLES,
          ),
    );
  }
  const d = wedgePathFor(rOut, rIn, startAngle, endAngle, effShape);
  // The modern style is rim-less (the gap is the separator), so the stroke is
  // dropped there regardless of the resolved paint.
  const strokeAttr =
    !shape.modern && paint.stroke !== null
      ? ` stroke="${paint.stroke}" stroke-width="${n(STROKE_PX)}"`
      : '';
  const opacityAttr = paint.elementOpacity !== 1 ? ` opacity="${n(paint.elementOpacity)}"` : '';
  // fill-rule="evenodd" punches the centre hole out of a single-sector full-circle
  // wedge (describeWedgePath emits it as two concentric circles relying on
  // evenodd). Without it the default nonzero rule fills the whole disc, so a
  // lone item's fill spills over the inner ring and centre. The standalone SVG
  // must carry the rule on the element (Qt SVG reads no external CSS).
  return `<path d="${d}" fill-rule="evenodd" fill="${paint.fill}" fill-opacity="${n(paint.fillOpacity)}"${strokeAttr}${opacityAttr}/>`;
}

/** Build one ring of wedge paths on a band, each with its resolved paint. The
 *  hovered wedge pops (modern style) and paints on top, so it is rendered last;
 *  otherwise a later neighbour would clip the grown fill. Blur polygons are still
 *  collected in index order, which the region union is indifferent to. */
function ringWedgesSvg(
  nodes: readonly MenuNode[],
  rOuter: number,
  rInner: number,
  rotation: number,
  palette: Palette,
  opacity: number,
  stateFor: (node: MenuNode, index: number) => WedgeState,
  shape: WedgeShape,
  hoverOffset: number,
  polygonsOut?: number[][],
): string {
  const others: string[] = [];
  const actives: string[] = [];
  nodes.forEach((node, i) => {
    const st = stateFor(node, i);
    const svg = wedgeSvg(
      i,
      nodes.length,
      rOuter,
      rInner,
      rotation,
      resolveWedgePaint(palette, opacity, st),
      shape,
      { active: st.active, offset: hoverOffset },
      polygonsOut,
    );
    (st.active ? actives : others).push(svg);
  });
  // Active wedges paint last so a popped fill sits over its neighbours. Only one
  // sector is ever active today, but collecting them keeps any from vanishing if
  // that ever changes.
  return others.join('') + actives.join('');
}

// Vertical-centre offset for a `<text>` whose `y` is the intended visual centre.
// A browser's `dominant-baseline="central"` centres text on the font's central
// baseline — (typoAscender + typoDescender) / 2 above the alphabetic baseline,
// which for the bundled Inter SemiBold equals half the cap height. Qt's SVG
// renderer (the native overlay) ignores `dominant-baseline` and always draws from
// the alphabetic baseline, so relying on it makes the overlay and the browser
// disagree (the overlay text sits ~0.36em too high). Instead we drop
// `dominant-baseline` and shift the baseline DOWN by this fraction of the font
// size: both renderers then place the alphabetic baseline at the same y, so the
// editor preview and the overlay centre text identically by construction.
//
// Derived from the font's own metrics (Inter-SemiBold.ttf head/OS2 tables:
// capHeight 1490, unitsPerEm 2048), not a tuned constant, and scales with the
// font size. capHeight / 2 here equals (typoAscender + typoDescender) / 2 for
// Inter, i.e. exactly the central baseline a browser uses.
const INTER_UNITS_PER_EM = 2048;
const INTER_CAP_HEIGHT = 1490;
/** Baseline offset (em) that centres a label on its point: half the cap height.
 *  The SVG `<text>` adds `fontPx * BASELINE_CENTER_EM` to the visual-centre y to
 *  get the baseline; the native QML overlay applies the same shift (the label
 *  descriptor carries the visual centre) so its text sits identically (#344). */
export const BASELINE_CENTER_EM = INTER_CAP_HEIGHT / INTER_UNITS_PER_EM / 2;

/** A `<text>` label, weight 600 (matching the bundled SemiBold + the centre
 *  label), with optional element opacity for preview/breadcrumb dimming. `y` is
 *  the visual centre; the alphabetic baseline is offset down by
 *  BASELINE_CENTER_EM so the glyphs straddle it in every renderer (Qt ignores
 *  dominant-baseline, so we don't use it). `anchor` is the horizontal alignment:
 *  the wedge path centres every label ('middle'), while shape-plugin labels carry
 *  their own anchor from the layout. */
function labelSvg(
  text: string,
  x: number,
  y: number,
  fontPx: number,
  color: string,
  fontFamily: string,
  elementOpacity: number,
  anchor: 'start' | 'middle' | 'end' = 'middle',
): string {
  if (text.length === 0) return '';
  const opacityAttr = elementOpacity !== 1 ? ` opacity="${n(elementOpacity)}"` : '';
  const baselineY = y + fontPx * BASELINE_CENTER_EM;
  return `<text x="${n(x)}" y="${n(baselineY)}" text-anchor="${anchor}" font-family="${esc(fontFamily)}" font-weight="600" font-size="${n(fontPx)}" fill="${color}"${opacityAttr}>${esc(text)}</text>`;
}

/** Whether a part (label / icon) is hidden, combining its per-item tri-state
 *  flag with the menu-wide toggle (#520): `true` forces it hidden, `false`
 *  forces it shown (an exception to a global hide), and absent inherits the
 *  global setting. */
function effectiveHidden(flag: boolean | undefined, globalHide: boolean): boolean {
  return flag === true || (flag !== false && globalHide);
}

/** A ring's per-node labels (truncated to the segment's `charCapacity`, a hidden
 *  one as ''), plus the longest of them in code points. One uniform font per ring
 *  is sized from `maxChars` so every item renders the same and the longest still
 *  fits (#439). */
function ringLabels(
  nodes: readonly MenuNode[],
  hideLabels: boolean,
  charCapacity: number,
): { texts: string[]; maxChars: number } {
  const texts = nodes.map((node) =>
    effectiveHidden(node.labelHidden, hideLabels) ? '' : truncatePieLabel(node.label, charCapacity),
  );
  const maxChars = texts.reduce((m, t) => Math.max(m, [...t].length), 0);
  return { texts, maxChars };
}

/** A ring's natural label font (px): the per-segment fit for its longest visible
 *  label (× labelScale), or 0 with no labels. buildPieSvg takes the MIN across
 *  the rings for one menu-wide size, so the inner and outer rings (and the
 *  centre) read the same instead of each filling its own radius — the outer ring
 *  sits ~2× further out, so on its own it would dwarf the inner. Always measured
 *  with the band cap, so the size is safe to apply on the band-less shape path
 *  too (it can only come out smaller, never overflow). */
function ringNaturalFontPx(
  nodes: readonly MenuNode[],
  rLabel: number,
  count: number,
  bandInner: number,
  bandOuter: number,
  labelScale: number,
  hideLabels: boolean,
): number {
  const { maxChars } = ringLabels(nodes, hideLabels, segmentLabelCharCapacity(rLabel, count));
  return maxChars > 0
    ? segmentLabelFontPx(rLabel, count, maxChars, bandInner, bandOuter) * labelScale
    : 0;
}

/** One label font for the entire menu tree, not just the visible rings, so it
 *  stays constant as the user drills between depths instead of jumping per level.
 *  Every submenu (`branches` list) is measured in the tighter inner-ring geometry
 *  — its widest case, since the outer ring only ever has more room — and the
 *  smallest such fit wins, so every label fits at every depth. 0 if the tree has
 *  no labelled items. */
function menuWideFontPx(
  config: MenuConfig,
  innerLabel: number,
  bandInner: number,
  bandOuter: number,
  labelScale: number,
  hideLabels: boolean,
): number {
  let min = Infinity;
  const visit = (nodes: readonly MenuNode[] | undefined): void => {
    if (!nodes || nodes.length === 0) return;
    const fit = ringNaturalFontPx(
      nodes,
      innerLabel,
      nodes.length,
      bandInner,
      bandOuter,
      labelScale,
      hideLabels,
    );
    if (fit > 0 && fit < min) min = fit;
    for (const node of nodes) visit(node.branches);
  };
  visit(config.root.branches);
  return min === Infinity ? 0 : min;
}

/** One icon size for the entire menu tree, mirroring {@link menuWideFontPx}: the
 *  smallest per-segment icon fit across every submenu (measured in the tighter
 *  inner-ring geometry), so icons stay the same size at every depth instead of
 *  growing/shrinking with each level's item count. `Infinity` if the tree has no
 *  items, so the caller reads it as "no cap". */
function menuWideIconPx(
  config: MenuConfig,
  innerLabel: number,
  bandInner: number,
  bandOuter: number,
  iconScale: number,
): number {
  let min = Infinity;
  const visit = (nodes: readonly MenuNode[] | undefined): void => {
    if (!nodes || nodes.length === 0) return;
    const size = segmentIconScaledPx(innerLabel, nodes.length, bandInner, bandOuter, iconScale);
    if (size < min) min = size;
    for (const node of nodes) visit(node.branches);
  };
  visit(config.root.branches);
  return min;
}

/** Vertical layout for an icon + label stacked on a point (#439): with both, the
 *  icon+gap+label block is centred on `y` and separated by one font-relative gap
 *  (so a bigger icon doesn't widen the spacing and a smaller label re-centres the
 *  icon); icon-only centres on the point; label-only sits on it. The ONE source
 *  for this stack — the wedge items and the centre node both call it, so their
 *  icon/label spacing is identical by construction. */
function stackIconLabel(
  y: number,
  iconSize: number,
  fontPx: number,
  hasIcon: boolean,
  hasLabel: boolean,
): { iconTop: number; labelY: number } {
  const stacked = hasIcon && hasLabel;
  const blockTop = y - (iconSize + ICON_LABEL_GAP_PX + fontPx) / 2;
  return {
    iconTop: stacked ? blockTop : y - iconSize / 2,
    labelY: stacked ? blockTop + iconSize + ICON_LABEL_GAP_PX + fontPx / 2 : y,
  };
}

/** Labels + icons for one ring: each centred in its wedge at the label radius,
 *  the label sized by the per-segment fit (× labelScale) and the icon by the
 *  per-segment icon fit (× iconScale), stacked above the label like SectorLabel.
 *  Empty labels / non-renderable icons are skipped. */
function ringItemsSvg(
  nodes: readonly MenuNode[],
  rLabel: number,
  rotation: number,
  ringFontPx: number,
  iconSize: number,
  color: string,
  fontFamily: string,
  elementOpacity: number,
  emitText: boolean,
  labelsOut: PieLabel[] | undefined,
  keyPrefix: 'in' | 'out',
  hideLabels: boolean,
  hideIcons: boolean,
  /** Modern hover pop (#47 PR3): the hovered wedge's label + icon grow by
   *  `hoverFactor` (the wedge's own band-growth ratio) so they keep pace with the
   *  popped wedge. `activeIndex` is which item is hovered, or -1 for none. The
   *  label radius is unchanged (the offset is symmetric, so the band centre stays
   *  put); only the font/icon size scales. */
  activeIndex: number,
  hoverFactor: number,
): string {
  const count = nodes.length;
  const op = elementOpacity !== 1 ? ` opacity="${n(elementOpacity)}"` : '';
  // Resolve every label once (honouring the per-item / global hide). The font is
  // the menu-wide size passed in (one size for both rings + the centre, #439),
  // truncated to what fits each wedge at that ring's own capacity.
  const charCapacity = segmentLabelCharCapacity(rLabel, count);
  const { texts } = ringLabels(nodes, hideLabels, charCapacity);
  return nodes
    .map((node, i) => {
      const angle = sectorCenterAngle(i, count) + rotation;
      const x = Math.sin(angle) * rLabel;
      const y = -Math.cos(angle) * rLabel;
      const text = texts[i] ?? '';
      const hasLabel = text.trim().length > 0;
      // The hovered item's glyph + icon scale with its popped wedge.
      const scale = i === activeIndex && hoverFactor !== 1 ? hoverFactor : 1;
      const itemFontPx = ringFontPx * scale;
      const itemIconSize = iconSize * scale;
      const icon =
        !effectiveHidden(node.iconHidden, hideIcons) &&
        itemIconSize > 0 &&
        isRenderableIcon(node.icon)
          ? node.icon
          : null;
      // Vertical layout from the shared stacker, so the spacing matches the
      // centre node exactly (one source for the icon/label stack).
      const { iconTop, labelY } = stackIconLabel(
        y,
        itemIconSize,
        itemFontPx,
        icon !== null,
        hasLabel,
      );
      let out = '';
      if (icon !== null) {
        out += iconMarkup(
          icon,
          x - itemIconSize / 2,
          iconTop,
          itemIconSize,
          op,
          `${keyPrefix}${i}`,
        );
      }
      if (hasLabel) {
        if (labelsOut) {
          labelsOut.push({
            text,
            x,
            y: labelY,
            fontPx: itemFontPx,
            color,
            opacity: elementOpacity,
            anchor: 'middle',
          });
        }
        if (emitText) {
          out += labelSvg(text, x, labelY, itemFontPx, color, fontFamily, elementOpacity);
        }
      }
      return out;
    })
    .join('');
}

/** Run a shape plugin's `layout` for one band and defensively validate it
 *  (#325). Mirrors the renderer's `buildRingLayout` / the memo in ShapePie:
 *  returns the validated layout, or null when the plugin throws or returns a
 *  malformed value so the caller falls back to the wedge path and the band is
 *  never blank. Pure: no logging — instead it reports the reason through
 *  `onError` so the host (not core) can warn, keeping this side-effect-free. */
function safeShapeLayout(
  module: ShapePluginModule,
  radii: ShapeRingRadii,
  sectorCount: number,
  ring: ShapeRingSlot,
  onError?: (reason: string) => void,
): ShapeLayout | null {
  let raw: unknown;
  try {
    raw = module.layout(sectorCount, radii, ring);
  } catch (err) {
    onError?.(`layout() threw: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const validated = validateShapeLayout(raw, sectorCount);
  if (!validated.ok) {
    onError?.(`layout() output rejected: ${validated.reason}`);
    return null;
  }
  return validated.layout;
}

/** One ring of shape-plugin nodes as `<circle>`s, the node equivalent of
 *  `ringWedgesSvg`: each node painted with the SAME resolved wedge paint
 *  (idle/active fill, cancel red, preview/breadcrumb dimming) as the wedge it
 *  replaces, so a shape pie themes identically. `layout.nodes[i]` gives the
 *  circle centre + radius; `stateFor` is the caller's per-sector wedge state. */
function ringNodesSvg(
  nodes: readonly MenuNode[],
  layout: ShapeLayout,
  palette: Palette,
  opacity: number,
  stateFor: (node: MenuNode, index: number) => WedgeState,
): string {
  return nodes
    .map((node, i) => {
      const sn = layout.nodes[i]!;
      const paint = resolveWedgePaint(palette, opacity, stateFor(node, i));
      const strokeAttr =
        paint.stroke !== null ? ` stroke="${paint.stroke}" stroke-width="${n(STROKE_PX)}"` : '';
      const opacityAttr = paint.elementOpacity !== 1 ? ` opacity="${n(paint.elementOpacity)}"` : '';
      return `<circle cx="${n(sn.cx)}" cy="${n(sn.cy)}" r="${n(sn.r)}" fill="${paint.fill}" fill-opacity="${n(paint.fillOpacity)}"${strokeAttr}${opacityAttr}/>`;
    })
    .join('');
}

/** Labels + icons for one ring of shape-plugin nodes, the node equivalent of
 *  `ringItemsSvg`. The icon sits on the node centre (`layout.nodes[i]`), the
 *  label at the plugin-supplied position + anchor (`layout.labels[i]`), stacked
 *  as in ShapePie. The plugin returns label *position*, not size, so the font
 *  comes from the same `segmentLabelFontPx` the wedge path and the editor
 *  preview use — without it the label would drift (see #355). */
function ringNodeItemsSvg(
  nodes: readonly MenuNode[],
  layout: ShapeLayout,
  rLabel: number,
  ringFontPx: number,
  iconSize: number,
  color: string,
  fontFamily: string,
  elementOpacity: number,
  emitText: boolean,
  labelsOut: PieLabel[] | undefined,
  keyPrefix: 'in' | 'out',
  hideLabels: boolean,
  hideIcons: boolean,
): string {
  const count = nodes.length;
  const op = elementOpacity !== 1 ? ` opacity="${n(elementOpacity)}"` : '';
  // The font is the menu-wide size passed in (one size for both rings + the
  // centre, #439); the plugin still owns label position, only the size is set
  // here. Labels truncated to what fits each node at this ring's capacity.
  const charCapacity = segmentLabelCharCapacity(rLabel, count);
  const { texts } = ringLabels(nodes, hideLabels, charCapacity);
  return nodes
    .map((node, i) => {
      const sn = layout.nodes[i]!;
      const sl = layout.labels[i]!;
      const text = texts[i] ?? '';
      const hasLabel = text.trim().length > 0;
      const icon =
        !effectiveHidden(node.iconHidden, hideIcons) && iconSize > 0 && isRenderableIcon(node.icon)
          ? node.icon
          : null;
      // Stack the icon above the node centre; without a label, centre it on the
      // node. The label keeps its plugin-supplied position, nudged down by half
      // the icon when both show, matching ShapePie / the wedge path.
      const iconTop = hasLabel ? sn.cy - iconSize : sn.cy - iconSize / 2;
      const labelY = icon !== null && hasLabel ? sl.y + iconSize * 0.5 : sl.y;
      let out = '';
      if (icon !== null) {
        out += iconMarkup(icon, sn.cx - iconSize / 2, iconTop, iconSize, op, `${keyPrefix}${i}`);
      }
      if (hasLabel) {
        if (labelsOut) {
          labelsOut.push({
            text,
            x: sl.x,
            y: labelY,
            fontPx: ringFontPx,
            color,
            opacity: elementOpacity,
            anchor: sl.anchor,
          });
        }
        if (emitText) {
          out += labelSvg(
            text,
            sl.x,
            labelY,
            ringFontPx,
            color,
            fontFamily,
            elementOpacity,
            sl.anchor,
          );
        }
      }

      return out;
    })
    .join('');
}

/** Depth-dot row (#296): one dot per ring depth below the pie. Dot 0 is the
 *  centre (red when the root is a cancel target); the active level is full
 *  opacity, the rest at half. */
function depthDotsSvg(
  config: MenuConfig,
  navigationDepth: number,
  centreActive: boolean,
  footprint: number,
  outerOuter: number,
  palette: Palette,
): string {
  const dotCount = 1 + menuTreeDepth(config);
  const dots = depthDotLayout(footprint, outerOuter, dotCount);
  const atCentre = navigationDepth === 0 && centreActive;
  const activeDot = Math.min(atCentre ? 0 : navigationDepth + 1, dotCount - 1);
  const rootCancel = isCancelNode(config.root);
  return dots.xs
    .map((cx, i) => {
      const cancel = i === 0 && rootCancel;
      const fill = rgb(cancel ? palette.cancelBgActive : palette.marker);
      // Full alpha on the current level, half on the rest, independent of the
      // opacity slider (the dots are indicators, not pie fill; matches the
      // decoupled .pie-depth-dot CSS).
      const alpha = i === activeDot ? 1 : 0.5;
      return `<circle cx="${n(cx)}" cy="${n(dots.cy)}" r="${n(dots.radius)}" fill="${fill}" fill-opacity="${n(alpha)}"/>`;
    })
    .join('');
}

/** Submenu depth markers (#216): a small arc of dots outside the active ring for
 *  each branch sector, one orbit dot per level of subtree depth, so every item
 *  in the current level shows whether (and how deep) it nests before you
 *  navigate in. The hovered branch's arc is full alpha, the rest half, both
 *  independent of the opacity slider. */
function submenuMarkersSvg(
  activeRing: readonly MenuNode[],
  activeSector: number | null,
  rotation: number,
  footprint: number,
  innerOuter: number,
  outerOuter: number,
  outerBandVisible: boolean,
  palette: Palette,
  /** Modern hover (#47 PR3): the hovered sector's wedge grows outward by this, so
   *  its marker arc rides out by the same amount to stay just past the popped rim
   *  (0 = no pop / not modern). The other sectors keep the base orbit. */
  hoverOffset: number,
): string {
  const marker = submenuMarkerOrbit({ footprint, innerOuter, outerOuter, outerBandVisible });
  const fill = rgb(palette.marker);
  return activeRing
    .map((node, i) => {
      const depth = subtreeDepth(node);
      if (depth === 0) return '';
      const hovered = activeSector === i;
      const alpha = hovered ? 1 : 0.5;
      const orbit = hovered ? marker.orbit + hoverOffset : marker.orbit;
      return submenuMarkerAngles(i, activeRing.length, depth, rotation, marker.stepAngle)
        .map((angle) => {
          const cx = Math.sin(angle) * orbit;
          const cy = -Math.cos(angle) * orbit;
          return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(marker.dotRadius)}" fill="${fill}" fill-opacity="${n(alpha)}"/>`;
        })
        .join('');
    })
    .join('');
}

/** The resolved ring layout for one drill state, shared by the graphic and the
 *  blur-extent helper so the two can never disagree about which bands show. */
type ResolvedRings = {
  isDrilled: boolean;
  activeRing: readonly MenuNode[];
  /** Inner band: the active ring at the top level, the breadcrumb once drilled. */
  innerSectors: readonly MenuNode[];
  /** Outer band: the drilled-in active ring, or the top-level branch preview;
   *  undefined when there's nothing on the outer band. */
  outerSectors: readonly MenuNode[] | undefined;
  /** Inner-band index the drill came from (the brightened anchor), or null. */
  drilledIntoIndex: number | null;
  innerRotation: number;
  outerRotation: number;
  /** Whether the outer band actually has wedges to draw. */
  outerBandVisible: boolean;
};

/** Resolve which menu nodes sit on the inner/outer bands and their rotations for
 *  the given drill state. Pure; no geometry. */
function resolvePieRings(
  config: MenuConfig,
  navigation: readonly number[],
  activeSector: number | null,
): ResolvedRings {
  const isDrilled = navigation.length > 0;
  const activeRing = currentBranches(config, navigation);
  const parentRing = isDrilled ? currentBranches(config, navigation.slice(0, -1)) : null;
  const drilledIntoIndex = isDrilled ? navigation[navigation.length - 1]! : null;

  const previewSectors =
    !isDrilled && activeSector !== null ? activeRing[activeSector]?.branches : undefined;
  const innerSectors = isDrilled ? (parentRing ?? []) : activeRing;
  const outerSectors = isDrilled ? activeRing : previewSectors;

  const innerRotation = isDrilled ? navigationRingRotation(config, navigation.slice(0, -1)) : 0;
  let outerRotation = 0;
  if (isDrilled) {
    outerRotation = navigationRingRotation(config, navigation);
  } else if (activeSector !== null) {
    outerRotation = sectorCenterAngle(activeSector, activeRing.length);
  }
  const outerBandVisible = outerSectors !== undefined && outerSectors.length > 0;
  return {
    isDrilled,
    activeRing,
    innerSectors,
    outerSectors,
    drilledIntoIndex,
    innerRotation,
    outerRotation,
    outerBandVisible,
  };
}

/**
 * Outer radius of the *visible* pie (reference units): the inner ring at the top
 * level, growing to the outer ring once a preview / drill makes the outer band
 * visible (#324). Drives the native overlay's frosted-blur + input-region mask,
 * which track the visible pie rather than the full window (buildPieSvg's viewBox,
 * by contrast, always reserves the full submenu-marker / depth-dot window).
 *
 * Deliberately the wedge *outer radius*, NOT the stroke's outer edge: the frosted
 * region is a binary QRegion (KWin's blur takes no antialiased mask), so its hard,
 * DPR-amplified edge would stair-step in the clear margin past the rim. Ending it
 * at the wedge radius puts that hard edge under the antialiased outer stroke,
 * which hides the stepping. The stroke is input-only-masked, so the rim still
 * renders in full (Wayland setMask clips input, not the visible surface).
 */
export function pieRenderExtent(params: {
  config: MenuConfig;
  navigation: readonly number[];
  activeSector: number | null;
  footprint: number;
  ringBalance: number;
  centerBalance: number;
}): number {
  const { config, navigation, activeSector, footprint, ringBalance, centerBalance } = params;
  const rings = ringRadii(footprint, ringBalance, centerBalance);
  const { outerBandVisible } = resolvePieRings(config, navigation, activeSector);
  const visibleOuter = outerBandVisible ? rings.outerOuter : rings.innerOuter;
  return Math.max(rings.cancel, visibleOuter);
}

/**
 * The whole pie as an SVG string, in the fixed reference space (`footprint`).
 * Render order: inner-ring wedges, centre disc +
 * label, inner items (icons + labels), then the outer ring (wedges + items)
 * when a preview / drill makes it visible, and finally the submenu depth
 * markers and depth dots. `activeSector` is the hovered sector (null = the
 * centre is the active target).
 */
export function buildPieSvg(params: {
  config: MenuConfig;
  navigation: readonly number[];
  activeSector: number | null;
  /** Whether the centre/root is the active target, for the depth-dot indicator
   *  only. Defaults to `activeSector === null` (the live overlay's puck-at-centre
   *  rule); the editor passes whether the root is selected so the lit dot tracks
   *  the viewed ring instead of snapping to the centre when nothing is hovered. */
  centreActive?: boolean;
  appearance: PieSvgAppearance;
  footprint: number;
  /** Active shape plugin (#325). When set, each visible band renders the
   *  plugin's nodes (`<circle>` + label) instead of wedges; a throw or a
   *  malformed `layout()` falls back to wedges for that band so the pie is
   *  never blank. Omitted = the wedge default. */
  shape?: ShapePluginModule | null;
  /** Pre-computed shape layouts for the inner / outer bands (#344). When a
   *  layout is provided (even null), it's used directly instead of laying out
   *  `shape` here, so the caller can share ONE layout between this
   *  graphic and its puck hit-test: the plugin's `layout()` may not be
   *  deterministic, and a second call here could place nodes where the hit-test
   *  doesn't expect them. `null` means "this band has no shape" (wedges); omit
   *  both to lay out from `shape` instead. The native overlay takes that branch
   *  (passes the module, not layouts), so its graphic and the main-process
   *  hit-test still lay out independently. */
  innerShapeLayout?: ShapeLayout | null;
  outerShapeLayout?: ShapeLayout | null;
  /** Called when a band with an active shape plugin falls back to wedges
   *  because `layout()` threw or returned a malformed value, with the band and
   *  a reason. Keeps this function pure (no logging); the host throttles + logs
   *  so a broken plugin is debuggable. Omitted in test / pure contexts. */
  onShapeFallback?: (ring: ShapeRingSlot, reason: string) => void;
  /** Emit the label `<text>` nodes in the returned SVG (default true). The
   *  native overlay sets this false and renders the labels as native QML Text
   *  instead (sharp at any DPR), collecting them through `labelsOut`; the SVG
   *  then carries only the geometry. With the default the SVG is byte-identical
   *  to before this option existed. */
  emitLabelText?: boolean;
  /** When provided, every label is pushed here as a {@link PieLabel} descriptor
   *  (viewBox coords, visual-centre y), in render order, regardless of
   *  `emitLabelText`. The default callers omit it and are unaffected. */
  labelsOut?: PieLabel[];
  /** When provided and the modern wedge style is active, each rendered wedge
   *  (plus the centre disc) is pushed here as a flat point polygon in the same
   *  reference space as the labels (#47 PR2). The native overlay turns these into
   *  a per-wedge blur region; the editor preview tints them. Empty for the
   *  classic style or a shape-plugin band (those render no wedges). */
  wedgePolygonsOut?: number[][];
}): string {
  const { config, navigation, activeSector, appearance, footprint, onShapeFallback } = params;
  const emitLabelText = params.emitLabelText ?? true;
  const labelsOut = params.labelsOut;
  const palette = PALETTES[appearance.theme] ?? PALETTES.dark;
  const { opacity, labelScale, iconScale, fontFamily } = appearance;
  // Menu-wide visibility toggles (#518), combined with the per-item flags (#515)
  // at each label / icon. Coerced so an absent flag reads as shown.
  const hideLabels = appearance.hideLabels === true;
  const hideIcons = appearance.hideIcons === true;
  const rings = ringRadii(footprint, appearance.ringBalance, appearance.centerBalance);
  // Modern wedge style (#47): the gap is a footprint-scaled width so the channel
  // is identical on both ring bands and scales with the pie. Classic style sets
  // modern false and gap 0 (edge-to-edge sectors with a rim).
  const modernWedge = appearance.wedgeStyle === 'modern';
  const wedgeShape: WedgeShape = {
    modern: modernWedge,
    gap: modernWedge ? footprint * appearance.wedgeGap : 0,
    gapStyle: appearance.wedgeGapStyle,
  };
  // Hover pop is a modern-only flourish; the classic style never pops a wedge.
  // The offset is footprint-scaled like the gap, so it grows with the pie.
  const wedgeHoverOffset = modernWedge ? footprint * appearance.wedgeHoverOffset : 0;
  // Modern centre disc gets the same sharp gap to the inner ring as the wedges
  // have to each other: shrink it by one gap width (classic keeps the full disc).
  const centreRadius = modernWedge ? Math.max(0, rings.cancel - wedgeShape.gap) : rings.cancel;
  // The centre is a wedge like any other: when it is the hovered target (the puck
  // at the centre, activeSector null) it pops too, growing by the same offset,
  // with its label + icon scaled by the disc's growth ratio.
  const centrePop = modernWedge && activeSector === null && wedgeHoverOffset > 0;
  const centreDrawRadius = centrePop ? centreRadius + wedgeHoverOffset : centreRadius;
  const centreHoverFactor =
    centrePop && centreRadius > 0 ? (centreRadius + wedgeHoverOffset) / centreRadius : 1;
  // Modern: make the inner-ring -> outer-ring gap equal that centre gap (one gap
  // width) instead of the built-in band split, so every gap in the pie matches.
  // The inner band keeps its outer edge; the outer band's inner edge (and its
  // label radius) move to sit one gap past it.
  const outerInnerR = modernWedge ? rings.innerOuter + wedgeShape.gap : rings.outerInner;
  const outerLabelR = modernWedge ? (outerInnerR + rings.outerOuter) / 2 : rings.outerLabel;
  // Shape plugins draw on the contract's radii packing; derive it once. The
  // centre disc, submenu markers and depth dots stay wedge-native — only the
  // ring bands switch to plugin nodes.
  const shape = params.shape ?? null;
  const shapeRadii = shape ? shapeRingRadii(rings) : null;

  const {
    isDrilled,
    activeRing,
    innerSectors,
    outerSectors,
    drilledIntoIndex,
    innerRotation,
    outerRotation,
    outerBandVisible,
  } = resolvePieRings(config, navigation, activeSector);

  const labelColor = rgb(palette.label);

  // Modern hover: the active wedge's label + icon grow with its band. The factor
  // is the band's growth ratio (the band gains 2*offset: inner -offset, outer
  // +offset); the band centre (label radius) is unchanged. -1 = no hovered item
  // in that band, so nothing scales.
  const innerBand = rings.innerOuter - rings.cancel;
  const outerBand = rings.outerOuter - outerInnerR;
  const innerHoverFactor = innerBand > 0 ? (innerBand + 2 * wedgeHoverOffset) / innerBand : 1;
  const outerHoverFactor = outerBand > 0 ? (outerBand + 2 * wedgeHoverOffset) / outerBand : 1;
  const innerActiveIdx = !isDrilled && activeSector !== null ? activeSector : -1;
  const outerActiveIdx = isDrilled && activeSector !== null ? activeSector : -1;

  // Inner band (active ring at top level; breadcrumb once drilled). A shape
  // plugin renders it as nodes; the wedge path is the fallback when no plugin
  // is active or its layout fails validation. The per-sector state is shared by
  // both paths so the highlight / dimming is identical.
  const innerStateFor = (node: MenuNode, i: number): WedgeState => ({
    active: !isDrilled && activeSector === i,
    cancel: isCancelNode(node),
    preview: false,
    breadcrumb: isDrilled,
    drilledInto: isDrilled && i === drilledIntoIndex,
  });
  const innerShapeLayout =
    params.innerShapeLayout !== undefined
      ? params.innerShapeLayout
      : shape && shapeRadii
        ? safeShapeLayout(shape, shapeRadii, innerSectors.length, 'inner', (reason) =>
            onShapeFallback?.('inner', reason),
          )
        : null;
  const innerWedges = innerShapeLayout
    ? ringNodesSvg(innerSectors, innerShapeLayout, palette, opacity, innerStateFor)
    : ringWedgesSvg(
        innerSectors,
        rings.innerOuter,
        rings.cancel,
        innerRotation,
        palette,
        opacity,
        innerStateFor,
        wedgeShape,
        wedgeHoverOffset,
        params.wedgePolygonsOut,
      );
  // The centre disc has no gap to cut; emit it as a circle so the modern blur
  // region + tint cover the whole pie, not just the rings. Gated on a real wedge
  // render (no shape plugin) so a shape-plugin pie keeps the classic full region.
  if (params.wedgePolygonsOut && modernWedge && shape === null) {
    params.wedgePolygonsOut.push(sampledCirclePolygon(centreDrawRadius, BLUR_WEDGE_ARC_SAMPLES));
  }

  // Centre disc + label (the cancel target / root label).
  const centerPaint = resolveWedgePaint(palette, opacity, {
    active: activeSector === null,
    cancel: isCancelNode(config.root),
    preview: false,
    breadcrumb: false,
    drilledInto: false,
  });
  // The modern centre is treated like any other modern wedge: rim-less (the gap
  // to the inner ring is the separator), so its stroke is dropped too.
  const centerStroke =
    !modernWedge && centerPaint.stroke !== null
      ? ` stroke="${centerPaint.stroke}" stroke-width="${n(STROKE_PX)}"`
      : '';
  const centerCircle = `<circle cx="0" cy="0" r="${n(centreDrawRadius)}" fill="${centerPaint.fill}" fill-opacity="${n(centerPaint.fillOpacity)}"${centerStroke}/>`;
  // The centre is a node like any other (#129): its icon stacked above its
  // label when it has both, the icon centred when there's no label, or the
  // label (✕ fallback) when there's no icon, the same stack a ring item uses.
  // The centre honours the visibility toggles too: the per-node flags (#515) and
  // the global ones (#518). A hidden icon / label renders as absent, and a hidden
  // label also suppresses the ✕ fallback (the centre text was explicitly hidden).
  const centerLabelHidden = effectiveHidden(config.root.labelHidden, hideLabels);
  const centerIcon =
    !effectiveHidden(config.root.iconHidden, hideIcons) && isRenderableIcon(config.root.icon)
      ? config.root.icon
      : null;
  const centerHasLabel = !centerLabelHidden && config.root.label.trim() !== '';
  // The centre icon matches the menu-wide item icon (one size across all depths),
  // capped at its own disc inscribe so it still fits the centre — with labels
  // hidden the inscribe would otherwise fill the whole, now bigger, disc.
  const menuIconPx = menuWideIconPx(
    config,
    rings.innerLabel,
    rings.cancel,
    rings.innerOuter,
    iconScale,
  );
  const centerIconSize =
    (centerIcon !== null
      ? Math.min(centerIconFitPx(centreRadius, centerHasLabel) * iconScale, menuIconPx)
      : 0) * centreHoverFactor;
  const centerText = centerLabelHidden ? '' : config.root.label || '✕';
  const centerCharCount = [...centerText].length;
  // One font for the WHOLE menu tree (every depth), not just the visible rings,
  // so it doesn't jump as you drill in and out: the most constrained submenu
  // (measured in the tighter inner-ring geometry) sets the size every level then
  // shares. The inner and outer rings and the centre all read this one size.
  const menuFontPx = menuWideFontPx(
    config,
    rings.innerLabel,
    rings.cancel,
    rings.innerOuter,
    labelScale,
    hideLabels,
  );
  // The centre joins the menu font, shrunk only if its own text is too long for
  // the disc (centerLabelFontPx is the disc-fill cap). No rings → its own fit.
  // Fit the centre content to the actually-drawn disc: the modern style shrinks
  // it by one gap width (centreRadius), classic keeps the full cancel radius.
  const centerDiscFit = centerLabelFontPx(centreRadius, centerCharCount) * labelScale;
  const centerFontPx =
    (menuFontPx > 0 ? Math.min(menuFontPx, centerDiscFit) : centerDiscFit) * centreHoverFactor;
  // Same stacker as the wedge items, centred on the origin (the centre point), so
  // the centre's icon/label spacing is identical to the surrounding items.
  const { iconTop: centerIconTop, labelY: centerLabelY } = stackIconLabel(
    0,
    centerIconSize,
    centerFontPx,
    centerIcon !== null,
    centerHasLabel,
  );
  const showCenterLabel = !centerLabelHidden && (centerIcon === null || centerHasLabel);
  const centerLabelColor = rgb(palette.cancelLabel);
  if (showCenterLabel && labelsOut) {
    labelsOut.push({
      text: centerText,
      x: 0,
      y: centerLabelY,
      fontPx: centerFontPx,
      color: centerLabelColor,
      opacity: 1,
      anchor: 'middle',
    });
  }
  const centerLabel =
    (centerIcon !== null && centerIconSize > 0
      ? iconMarkup(centerIcon, -centerIconSize / 2, centerIconTop, centerIconSize, '', 'c')
      : '') +
    (showCenterLabel && emitLabelText
      ? labelSvg(centerText, 0, centerLabelY, centerFontPx, centerLabelColor, fontFamily, 1)
      : '');

  // Inner labels + icons (dimmed when the inner ring is the breadcrumb).
  const innerLabelOpacity = isDrilled ? BREADCRUMB_LABEL_OPACITY : 1;
  const innerItems = innerShapeLayout
    ? ringNodeItemsSvg(
        innerSectors,
        innerShapeLayout,
        rings.innerLabel,
        menuFontPx,
        menuIconPx,
        labelColor,
        fontFamily,
        innerLabelOpacity,
        emitLabelText,
        labelsOut,
        'in',
        hideLabels,
        hideIcons,
      )
    : ringItemsSvg(
        innerSectors,
        rings.innerLabel,
        innerRotation,
        menuFontPx,
        menuIconPx,
        labelColor,
        fontFamily,
        innerLabelOpacity,
        emitLabelText,
        labelsOut,
        'in',
        hideLabels,
        hideIcons,
        innerActiveIdx,
        innerHoverFactor,
      );

  // Outer band: drilled-in active ring, or the top-level branch preview. Same
  // shape-vs-wedge dispatch as the inner band.
  let outerWedges = '';
  let outerItems = '';
  if (outerBandVisible) {
    const outerStateFor = (node: MenuNode, i: number): WedgeState => ({
      active: isDrilled && activeSector === i,
      cancel: isCancelNode(node),
      preview: !isDrilled,
      breadcrumb: false,
      drilledInto: false,
    });
    const outerShapeLayout =
      params.outerShapeLayout !== undefined
        ? params.outerShapeLayout
        : shape && shapeRadii
          ? safeShapeLayout(shape, shapeRadii, outerSectors!.length, 'outer', (reason) =>
              onShapeFallback?.('outer', reason),
            )
          : null;
    const outerLabelOpacity = isDrilled ? 1 : PREVIEW_LABEL_OPACITY;
    outerWedges = outerShapeLayout
      ? ringNodesSvg(outerSectors!, outerShapeLayout, palette, opacity, outerStateFor)
      : ringWedgesSvg(
          outerSectors!,
          rings.outerOuter,
          outerInnerR,
          outerRotation,
          palette,
          opacity,
          outerStateFor,
          wedgeShape,
          wedgeHoverOffset,
          params.wedgePolygonsOut,
        );
    outerItems = outerShapeLayout
      ? ringNodeItemsSvg(
          outerSectors!,
          outerShapeLayout,
          rings.outerLabel,
          menuFontPx,
          menuIconPx,
          labelColor,
          fontFamily,
          outerLabelOpacity,
          emitLabelText,
          labelsOut,
          'out',
          hideLabels,
          hideIcons,
        )
      : ringItemsSvg(
          outerSectors!,
          outerLabelR,
          outerRotation,
          menuFontPx,
          menuIconPx,
          labelColor,
          fontFamily,
          outerLabelOpacity,
          emitLabelText,
          labelsOut,
          'out',
          hideLabels,
          hideIcons,
          outerActiveIdx,
          outerHoverFactor,
        );
  }

  // Submenu depth markers ride just outside whichever ring is the *engaged*
  // level: the items of the outer band once it's visible (the hovered branch's
  // preview children at the top level, or the drilled-in ring), and the active
  // ring otherwise. This matches the editor preview, where clicking a branch
  // drills in so its markers reflect the level you're entering, not the parent
  // siblings you came from. The depth dots row below the pie is separate. Each
  // is gated by its appearance toggle (the viewBox still reserves the space, so
  // the pie doesn't grow/shrink when toggled).
  const markerRing = outerBandVisible ? outerSectors! : activeRing;
  // No sub-sector is "active" while previewing a branch at the top level (you're
  // hovering the parent, not one of its children); drilled in, the hovered child
  // highlights.
  const markerSector = outerBandVisible && !isDrilled ? null : activeSector;
  const submenuMarkers = appearance.showSubmenuMarkers
    ? submenuMarkersSvg(
        markerRing,
        markerSector,
        outerBandVisible ? outerRotation : 0,
        footprint,
        rings.innerOuter,
        rings.outerOuter,
        outerBandVisible,
        palette,
        wedgeHoverOffset,
      )
    : '';
  const depthDots = appearance.showDepthDots
    ? depthDotsSvg(
        config,
        navigation.length,
        params.centreActive ?? activeSector === null,
        footprint,
        rings.outerOuter,
        palette,
      )
    : '';

  const ext = pieWindowExtent(footprint, rings.outerOuter);
  const body =
    innerWedges +
    centerCircle +
    centerLabel +
    innerItems +
    outerWedges +
    outerItems +
    submenuMarkers +
    depthDots;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${n(-ext)} ${n(-ext)} ${n(2 * ext)} ${n(2 * ext)}">${body}</svg>`;
}

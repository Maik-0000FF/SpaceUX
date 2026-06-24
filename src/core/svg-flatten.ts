// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Flatten an SVG icon into an inline vector fragment for the baked pie SVG
 * (#403). The pie embeds icons today as `<image href="data:image/svg+xml">`;
 * Qt's QSvgRenderer rasterises a nested SVG at its tiny intrinsic size (Breeze
 * icons are ~16 px) and upscales it, so the native overlay shows them blurry
 * while the browser preview (vector) stays sharp. Inlining the icon's drawing
 * as `<g>` vectors, exactly like the pie base shape, renders crisp in both.
 *
 * Doing that safely is the work here: the icon stops being sandboxed inside an
 * `<image>` and becomes part of the host document, so we must
 *   1. allow-list a small, static, script-free element set (anything else →
 *      bail to null so the caller keeps the safe `<image>` fallback),
 *   2. resolve `currentColor` (theme icons set it via a `<style>` colour scheme
 *      QtSvg's CSS engine can't follow) to an explicit fill and drop the
 *      `<style>`/classes, and
 *   3. namespace ids so two icons (or the pie itself) can't collide on `url(#…)`.
 *
 * DOM-less on purpose: pie-svg runs in the renderer AND in the main process
 * (the native overlay builds the same string), so this uses a tiny tokeniser,
 * not the browser DOM. When anything is unfamiliar or unresolvable it returns
 * null and the caller falls back to `<image>` — correctness over coverage.
 */

export type FlatIcon = {
  /** Inner markup, allow-listed, ids namespaced, currentColor resolved —
   *  ready to drop inside a host `<g transform>`. */
  inner: string;
  /** Source viewBox [minX, minY, width, height], for placement math. */
  viewBox: [number, number, number, number];
};

/** Elements we know are static, paint-only, and safe to inline verbatim. Their
 *  spec casing matters (camelCase ones are real SVG names). Anything outside
 *  this set makes us bail. */
const ALLOWED = new Set([
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'use',
]);

/** Elements that carry meaning but aren't drawn: read for colour, then dropped. */
const META = new Set(['style', 'title', 'desc', 'metadata']);

/** Paint attributes whose `currentColor` we resolve to an explicit colour. */
const PAINT_ATTRS = new Set([
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
]);

type Attr = { name: string; value: string };
type ElementNode = { type: 'el'; tag: string; attrs: Attr[]; children: TreeNode[] };
type TextNode = { type: 'text'; text: string };
type RawNode = { type: 'raw'; tag: string; text: string };
type TreeNode = ElementNode | TextNode | RawNode;

/** Marker thrown internally to abort the whole flatten (caller → `<image>`).
 *  An Error instance, caught by identity in `flattenSvg`, rather than a bare
 *  symbol, so it stays a proper throwable if it ever escapes the module. */
const BAIL = new Error('svg-flatten-bail');

/**
 * Flatten an `image/svg+xml` data URI into an inline fragment, or null when it
 * isn't an SVG data URI, can't be decoded, or isn't safely flattenable.
 */
export function flattenIconDataUri(dataUri: string, uid: string): FlatIcon | null {
  const svg = svgFromDataUri(dataUri);
  if (svg === null) return null;
  return flattenIconSvg(svg, uid);
}

/** Decode the SVG source from a data URI, or null for a non-SVG / raster URI. */
function svgFromDataUri(uri: string): string | null {
  const m = /^data:image\/svg\+xml([^,]*),(.*)$/s.exec(uri);
  if (!m) return null;
  const meta = m[1] ?? '';
  const payload = m[2] ?? '';
  try {
    if (/;base64/i.test(meta)) {
      // atob is global in browsers and Node ≥16 (both our runtimes).
      const bin = atob(payload);
      // atob yields a binary string; decode it as UTF-8.
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

/** Flatten raw SVG source. Exported for direct testing. */
export function flattenIconSvg(source: string, uid: string): FlatIcon | null {
  try {
    // Comments / `<?xml?>` / DOCTYPE / CDATA are skipped inside the tokeniser
    // (parse), not stripped with regexes — a regex strip is both incomplete
    // (a surviving `<!--` could re-form) and unnecessary here.
    const root = parse(source);
    if (!root || root.tag !== 'svg') return null;

    const viewBox = readViewBox(root);
    if (!viewBox) return null;

    const colorByClass = collectStyleColors(root);
    const idMap = buildIdMap(root, uid);

    const inner = root.children
      .map((c) => serialize(c, { color: undefined, colorByClass, idMap }))
      .join('');
    if (inner.trim() === '') return null; // nothing drawable survived

    return { inner, viewBox };
  } catch (err) {
    if (err === BAIL) return null;
    return null; // any parse surprise → safe fallback
  }
}

// ── Tokeniser ────────────────────────────────────────────────────────────

/** Parse a single root element (the first element found) into a tree. */
function parse(src: string): ElementNode | null {
  let i = 0;
  const len = src.length;

  /** At a `<`, skip a comment / CDATA / processing instruction / declaration,
   *  advancing past it; returns true if one was skipped. Keeps comment handling
   *  in the tokeniser instead of a pre-pass regex. */
  function skipMisc(): boolean {
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e === -1 ? len : e + 3;
      return true;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      i = e === -1 ? len : e + 3;
      return true;
    }
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      i = e === -1 ? len : e + 2;
      return true;
    }
    if (src.startsWith('<!', i)) {
      const e = src.indexOf('>', i + 2);
      i = e === -1 ? len : e + 1;
      return true;
    }
    return false;
  }

  function parseElement(): ElementNode | null {
    if (src[i] !== '<') return null;
    const tagMatch = /^<([A-Za-z][\w:-]*)/.exec(src.slice(i));
    if (!tagMatch) throw BAIL;
    const tag = stripNs(tagMatch[1]!);
    i += tagMatch[0].length;

    const attrs: Attr[] = [];
    // Attributes up to '>' or '/>'.
    for (;;) {
      skipSpace();
      if (src[i] === '/' && src[i + 1] === '>') {
        i += 2;
        return { type: 'el', tag, attrs, children: [] };
      }
      if (src[i] === '>') {
        i += 1;
        break;
      }
      const at = /^([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i));
      if (!at) {
        // A bare attribute or something unexpected — bail rather than guess.
        const bare = /^([A-Za-z_:][\w:.-]*)/.exec(src.slice(i));
        if (bare) {
          i += bare[0].length;
          continue;
        }
        throw BAIL;
      }
      attrs.push({ name: at[1]!, value: at[3] ?? at[4] ?? '' });
      i += at[0].length;
    }

    // Raw-text elements (style/script): read verbatim to the close tag.
    if (tag === 'style' || tag === 'script') {
      const close = src.indexOf(`</${tagMatch[1]!}`, i);
      const text = close === -1 ? src.slice(i) : src.slice(i, close);
      i = close === -1 ? len : src.indexOf('>', close) + 1;
      return { type: 'el', tag, attrs, children: [{ type: 'raw', tag, text }] };
    }

    const children: TreeNode[] = [];
    for (;;) {
      if (i >= len) break;
      if (src[i] === '<') {
        if (skipMisc()) continue; // comment / CDATA / PI / declaration
        if (src[i + 1] === '/') {
          // Closing tag for this element.
          const end = src.indexOf('>', i);
          i = end === -1 ? len : end + 1;
          break;
        }
        const child = parseElement();
        if (child) children.push(child);
      } else {
        const next = src.indexOf('<', i);
        const text = src.slice(i, next === -1 ? len : next);
        if (text.trim() !== '') children.push({ type: 'text', text });
        i = next === -1 ? len : next;
      }
    }
    return { type: 'el', tag, attrs, children };
  }

  function skipSpace(): void {
    while (i < len && /\s/.test(src[i]!)) i += 1;
  }

  // Skip leading text + comments/PI/declarations to the first real element.
  for (;;) {
    while (i < len && src[i] !== '<') i += 1;
    if (i >= len) return null;
    if (!skipMisc()) break;
  }
  return parseElement();
}

/** Drop an XML namespace prefix (`xlink:href` keeps its prefix; element/tag
 *  prefixes like `svg:rect` collapse to `rect`). */
function stripNs(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

// ── viewBox ──────────────────────────────────────────────────────────────

function readViewBox(root: ElementNode): [number, number, number, number] | null {
  const vb = attr(root, 'viewBox');
  if (vb) {
    const p = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (p.length === 4 && p.every((x) => Number.isFinite(x)) && p[2]! > 0 && p[3]! > 0) {
      return [p[0]!, p[1]!, p[2]!, p[3]!];
    }
    return null;
  }
  const w = parseFloat(attr(root, 'width') ?? '');
  const h = parseFloat(attr(root, 'height') ?? '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return [0, 0, w, h];
  return null;
}

// ── Colour scheme (currentColor) ───────────────────────────────────────────

/**
 * Map class name → colour, parsed from any `<style>` `.Class { color: … }`.
 *
 * We only reproduce `color` (→ currentColor). A `<style>` that sets any *other*
 * property bails the whole flatten: dropping a class-set `fill`/`stroke` would
 * render the icon with the wrong (default) paint, which is worse than the safe
 * `<image>` fallback that preserves the icon's own styling.
 */
function collectStyleColors(root: ElementNode): Map<string, string> {
  const map = new Map<string, string>();
  const css = styleText(root).replace(/\/\*[\s\S]*?\*\//g, ''); // strip CSS comments
  if (!css.trim()) return map;
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    for (const decl of m[2]!.split(';')) {
      const prop = decl.split(':')[0]?.trim().toLowerCase();
      if (prop && prop !== 'color') throw BAIL; // a property we can't reproduce
    }
    const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(m[2]!);
    if (!colorMatch) continue;
    const color = colorMatch[1]!.trim();
    for (const sel of m[1]!.split(',')) {
      const cls = /^\s*\.([\w-]+)\s*$/.exec(sel);
      if (cls) map.set(cls[1]!, color);
    }
  }
  return map;
}

function styleText(node: TreeNode): string {
  if (node.type === 'raw') return node.tag === 'style' ? node.text : '';
  if (node.type === 'text') return '';
  return node.children.map(styleText).join('\n');
}

// ── id namespacing ─────────────────────────────────────────────────────────

function buildIdMap(root: ElementNode, uid: string): Map<string, string> {
  const map = new Map<string, string>();
  walk(root, (el) => {
    const id = attr(el, 'id');
    if (id) map.set(id, `i${uid}-${id}`);
  });
  return map;
}

function walk(el: ElementNode, fn: (el: ElementNode) => void): void {
  fn(el);
  for (const c of el.children) if (c.type === 'el') walk(c, fn);
}

// ── Serialisation ──────────────────────────────────────────────────────────

type Ctx = {
  /** Effective `color` in scope, for resolving currentColor. */
  color: string | undefined;
  colorByClass: Map<string, string>;
  idMap: Map<string, string>;
};

function serialize(node: TreeNode, ctx: Ctx): string {
  if (node.type === 'text') return escapeText(node.text);
  if (node.type === 'raw') return ''; // style/script bodies are never emitted
  const el = node;

  if (META.has(el.tag)) return ''; // style/title/desc/metadata: read already, drop
  if (!ALLOWED.has(el.tag)) throw BAIL; // unknown/dangerous element → fallback

  // Resolve this element's own colour (from its class), threading inheritance.
  const ownColor = elementColor(el, ctx.colorByClass) ?? ctx.color;
  const childCtx: Ctx = { ...ctx, color: ownColor };

  const attrs = el.attrs
    .map((a) => renderAttr(a, ownColor, ctx.idMap))
    .filter((s) => s !== null)
    .join('');

  const inner = el.children.map((c) => serialize(c, childCtx)).join('');
  return inner === '' ? `<${el.tag}${attrs}/>` : `<${el.tag}${attrs}>${inner}</${el.tag}>`;
}

/** A class-derived colour for this element, if any (last class wins). */
function elementColor(el: ElementNode, colorByClass: Map<string, string>): string | undefined {
  const cls = attr(el, 'class');
  if (!cls) return undefined;
  let found: string | undefined;
  for (const token of cls.split(/\s+/)) {
    const c = colorByClass.get(token);
    if (c) found = c;
  }
  return found;
}

/** Render one attribute, or null to drop it. Bails on anything dangerous. */
function renderAttr(a: Attr, color: string | undefined, idMap: Map<string, string>): string | null {
  const name = a.name;
  const lname = name.toLowerCase();

  // Drop scripting + class (resolved away) + the now-meaningless style colour.
  if (/^on/i.test(lname)) throw BAIL;
  if (lname === 'class') return null;

  let value = a.value;
  if (/javascript:/i.test(value)) throw BAIL;
  // Only local url(#id) paint/clip/mask refs are allowed; an external
  // url(http…) paint server would trigger an outbound fetch from the host.
  if (/url\(\s*['"]?(?!#)/i.test(value)) throw BAIL;

  // References: only local (#id) hrefs are allowed; rewrite to the namespaced id.
  if (lname === 'href' || lname === 'xlink:href') {
    if (!value.startsWith('#')) throw BAIL; // external/raster ref → fallback
    value = '#' + (idMap.get(value.slice(1)) ?? value.slice(1));
    return ` ${name}="${escapeAttr(value)}"`;
  }

  if (name === 'id') {
    return ` id="${escapeAttr(idMap.get(value) ?? value)}"`;
  }

  // url(#id) references inside any attribute (fill, clip-path, mask, …).
  value = value.replace(
    /url\(\s*#([\w-]+)\s*\)/g,
    (_m, id: string) => `url(#${idMap.get(id) ?? id})`,
  );

  // currentColor → the explicit colour in scope. If none is known, we can't
  // reproduce the theme colour inline, so bail to the safe <image> path.
  if (PAINT_ATTRS.has(lname) && value.trim().toLowerCase() === 'currentcolor') {
    if (!color) throw BAIL;
    value = color;
  }
  if (lname === 'style') value = resolveStyleAttr(value, color);

  return ` ${name}="${escapeAttr(value)}"`;
}

/** Resolve currentColor inside an inline `style="fill:currentColor"` attr. */
function resolveStyleAttr(style: string, color: string | undefined): string {
  if (!/currentcolor/i.test(style)) return style;
  if (!color) throw BAIL;
  return style.replace(/currentcolor/gi, color);
}

// ── small helpers ──────────────────────────────────────────────────────────

function attr(el: ElementNode, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name || stripNs(a.name) === name)?.value;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Sector-icon helpers shared by the live pie (renderer) and the editor
 * preview, so both size and gate icons identically.
 *
 * A node's `icon` is an inline image data URI — the representation produced
 * both by a future static loader and by a runtime provider (e.g. the FreeCAD
 * bridge handing back a command's icon as `data:image/png;base64,...`). The
 * renderer just draws whatever data URI sits on the node; it never resolves
 * names or fetches files.
 */

// The renderable-icon gate lives in shared/ (the menu validator uses the same
// predicate, so "validation says it shows" and "the renderer shows it" stay
// the same statement). Re-exported here so the render-side keeps importing it
// from one icon module.
export { isRenderableIcon } from '../shared/icon.js';

/** Icon edge length as a fraction of the pie's base radius. Kept here so the
 *  overlay and the editor preview (both 240-unit based) render icons at the
 *  same proportion. */
export const ICON_SIZE_RATIO = 0.14;

/** Image file extensions the icon picker accepts, mapped to their MIME type. */
export const ICON_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Max source-image size the picker accepts. Icons are inlined into menu.json
 *  as base64 data URIs, so the *stored* cost is ~33% larger than this (≈341 KB
 *  at this cap); this bounds the source bytes, mainly for rasters (SVGs are
 *  tiny). */
export const MAX_ICON_BYTES = 256 * 1024;

/**
 * Light SVG hardening applied before an SVG is inlined as a data URI.
 *
 * NOTE: this is **defence-in-depth, not a complete sanitizer** — it strips
 * `<script>` blocks and quoted `on*=` handlers but deliberately misses
 * unquoted handlers, `href="javascript:"`, `<use>`/`<foreignObject>`, etc.
 * It is only *sufficient* because every render site draws the icon in static
 * mode — `<image href>` (pie + preview) and `<img src>` (Properties thumbnail)
 * — which never executes SVG scripts. If any future code inlines `node.icon`
 * as live `<svg>` or via dangerouslySetInnerHTML, THIS IS NOT ENOUGH; do
 * proper sanitization there.
 */
export function sanitizeSvg(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '');
}

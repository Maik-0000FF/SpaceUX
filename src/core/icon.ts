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

/** Icon edge length as a fraction of the pie's base radius. Kept here so the
 *  overlay and the editor preview (both 240-unit based) render icons at the
 *  same proportion. */
export const ICON_SIZE_RATIO = 0.14;

/**
 * Whether a node's `icon` is safe to draw in an `<image>`. Only inline image
 * data URIs are accepted: that's exactly what the icon pipeline produces, and
 * it stops a stray value from making the renderer fetch an external URL.
 * SVG loaded through `<image>` runs in secure static mode (no scripts), so
 * `data:image/svg+xml` is safe too.
 */
export function isRenderableIcon(icon: string | undefined): icon is string {
  return typeof icon === 'string' && icon.startsWith('data:image/');
}

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

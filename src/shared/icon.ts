// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The renderable-icon predicate, in the shared (lowest) layer so the menu
 * validator and the renderer agree on exactly what counts as a drawable icon.
 *
 * A node's `icon` is an inline image data URI — the representation produced by
 * a runtime provider (e.g. a FreeCAD bridge handing back a command's icon as
 * `data:image/png;base64,...`). Only inline image data URIs are accepted: that
 * is what the icon pipeline produces, and it stops a stray value from making
 * the renderer fetch an external URL. SVG loaded through `<image>` runs in
 * secure static mode (no scripts), so `data:image/svg+xml` is safe too.
 *
 * Accepts `unknown` so it works both on a typed `node.icon` and on a raw
 * parsed-JSON value during config validation.
 */
export function isRenderableIcon(icon: unknown): icon is string {
  return typeof icon === 'string' && icon.startsWith('data:image/');
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Parse the SPACEUX_OVERLAY_MODE env var.
 *
 * Kept as a pure function (no electron import) so the parsing can be unit-
 * tested in node, and so index.ts has a single, named place that turns the
 * raw string into intent.
 *
 * An env var is always a string and every non-empty string is truthy, so a
 * naive Boolean() coercion would treat SPACEUX_OVERLAY_MODE=0 / =false / =off
 * as "on", the opposite of what those values intuitively mean. We therefore
 * parse rather than coerce: the empty string and the falsy-looking words count
 * as off, anything else as on. The value is trimmed and lower-cased first, so
 * `DEBUG` or ` 1 ` behave like `debug` / `1`.
 *
 * `requested` is only the env's request; the caller still ORs it with
 * app.isPackaged (packaged installs always run the overlay). `debug` selects
 * the dev-chrome overlay variant and implies the overlay is on.
 */
export function parseOverlayMode(value: string | undefined): {
  requested: boolean;
  debug: boolean;
} {
  const normalized = (value ?? '').trim().toLowerCase();
  const requested = !['', '0', 'false', 'off', 'no'].includes(normalized);
  const debug = normalized === 'debug';
  return { requested, debug };
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Convert an unknown caught error into a printable string. Replaces
 * the recurring `err instanceof Error ? err.message : String(err)`
 * pattern that was inlined across the main process — one place to
 * change if we ever want richer error reporting (stack, code, etc.).
 */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

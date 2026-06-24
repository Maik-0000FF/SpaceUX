// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { InputSettings } from './ipc.js';

/**
 * Defaults + validation for the global SpaceMouse input settings (#327).
 * Kept pure (no IO) so the core and the tests share it, the same split
 * as pie-appearance: the `InputSettings`
 * type lives in ipc.ts, the runtime defaults and the trust-boundary
 * sanitiser live here.
 */

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  grabWhilePieOpen: true,
};

/**
 * Validate an untrusted partial patch from the editor renderer (the trust
 * boundary, same as `sanitizePieAppearancePatch`): keep only known fields
 * with the right type, drop everything else. A non-boolean grab flag is
 * dropped rather than coerced, so a malformed message can't flip behaviour.
 */
export function sanitizeInputSettingsPatch(patch: unknown): Partial<InputSettings> {
  if (typeof patch !== 'object' || patch === null) return {};
  const p = patch as Record<string, unknown>;
  const clean: Partial<InputSettings> = {};
  if (typeof p.grabWhilePieOpen === 'boolean') {
    clean.grabWhilePieOpen = p.grabWhilePieOpen;
  }
  return clean;
}

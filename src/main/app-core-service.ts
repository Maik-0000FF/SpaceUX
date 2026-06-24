// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The app-settings slice of the core service: pie appearance, input + desktop
 * settings, and autostart. The editor-input sanitisation is folded in here so
 * every transport inherits it; the underlying apply / persist stays in the
 * injected `deps`.
 */

import { sanitizeDesktopSettings } from '../shared/desktop-settings.js';
import type { DesktopSettings, InputSettings, PieAppearance } from '../shared/ipc.js';
import { sanitizeInputSettingsPatch } from '../shared/input-settings.js';
import { sanitizePieAppearancePatch } from '../shared/pie-appearance.js';

import { isAutostartEnabled, setAutostartEnabled } from './autostart.js';
import type { CoreService } from './core-service.js';
import { resourcePath } from './resources.js';

export interface AppIpcDeps {
  getAppearance: () => PieAppearance;
  /** Apply a validated partial change: merge, persist, broadcast. */
  setAppearance: (patch: Partial<PieAppearance>) => void;
  getInputSettings: () => InputSettings;
  /** Apply a validated partial input-settings change: merge, persist, and
   *  apply live (e.g. (un)grab the device if the pie is open). */
  setInputSettings: (patch: Partial<InputSettings>) => void;
  getDesktopSettings: () => DesktopSettings;
  /** Apply a validated full desktop-settings value: replace, persist, and (in
   *  the runtime work) re-arm the desktop interpreter. */
  setDesktopSettings: (settings: DesktopSettings) => void;
}

export type AppCoreService = Pick<
  CoreService,
  | 'GetPieAppearance'
  | 'SetPieAppearance'
  | 'GetInputSettings'
  | 'SetInputSettings'
  | 'GetDesktopSettings'
  | 'SetDesktopSettings'
  | 'GetAutostart'
  | 'SetAutostart'
>;

export function createAppCoreService(deps: AppIpcDeps): AppCoreService {
  return {
    GetPieAppearance: () => deps.getAppearance(),
    SetPieAppearance: (patch) => {
      const clean = sanitizePieAppearancePatch(patch);
      if (Object.keys(clean).length > 0) deps.setAppearance(clean);
    },
    GetInputSettings: () => deps.getInputSettings(),
    SetInputSettings: (patch) => {
      const clean = sanitizeInputSettingsPatch(patch);
      if (Object.keys(clean).length > 0) deps.setInputSettings(clean);
    },
    GetDesktopSettings: () => deps.getDesktopSettings(),
    // Full object, not a partial patch (the config nests): sanitise the whole
    // thing, filling defaults for anything missing or malformed.
    SetDesktopSettings: (settings) => deps.setDesktopSettings(sanitizeDesktopSettings(settings)),
    GetAutostart: () => isAutostartEnabled(),
    // `enabled` is already boolean (the contract types it); the unknown -> boolean
    // coercion is the wiring's job at the IPC boundary.
    SetAutostart: (enabled) => setAutostartEnabled(enabled, resourcePath('assets', 'icon.png')),
  };
}

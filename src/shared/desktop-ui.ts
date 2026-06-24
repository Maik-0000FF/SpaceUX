// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire types of the desktop-tab UI model (#457 C4): what the core's
 * `InspectDesktopSettings` returns and what `EditDesktopSettings` takes.
 * Declared in shared (the dependency leaf) so the core contract can reference
 * them; the builder/transform logic lives in `core/desktop-model.ts`. Conflict
 * markers reuse the unified `UiConflict` shape (see nav-ui.ts).
 */

import type { DesktopActivationMode, DesktopAxisFunctionKind, DesktopSettings } from './ipc.js';
import type { ActionRef, MenuAxisName } from './menu.js';
import type { UiConflict } from './nav-ui.js';

/** One function-specific control on an axis card, render-ready. `key` names
 *  the field the matching `setAxisField` op writes. */
export type DesktopFieldModel =
  | {
      control: 'select';
      key: string;
      label: string;
      value: string;
      options: { value: string; label: string }[];
    }
  | {
      control: 'slider';
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      value: number;
      /** Read-out format: value.toFixed(decimals) + suffix ("1.0x", "300 ms"),
       *  so the editor can render the LIVE drag value without a model trip. */
      decimals: number;
      suffix: string;
    }
  | { control: 'toggle'; key: string; label: string; value: boolean };

export type DesktopAxisCardModel = {
  axis: MenuAxisName;
  /** Plain-language motion name; the raw axis code renders dimmed beside it. */
  name: string;
  code: string;
  kind: DesktopAxisFunctionKind;
  kindOptions: { value: string; label: string }[];
  fields: DesktopFieldModel[];
};

export type DesktopButtonRowModel = {
  index: number;
  label: string;
  /** The dropdown choice; `action` reveals the action picker + config. */
  choice: 'none' | 'overview' | 'showDesktop' | 'action';
  options: { value: string; label: string; disabled?: boolean }[];
  conflict: UiConflict | null;
  /** Hint when the row is the pie trigger under always-on (options blocked). */
  blockedNote: string | null;
  /** The bound action when `choice === 'action'`. */
  action: ActionRef | null;
};

export type DesktopUiModel = {
  /** The tab intro ("Drive the desktop ... KDE only."). */
  description: string;
  activation: {
    /** 'off' | the activation mode while enabled. */
    value: string;
    options: { value: string; label: string }[];
  };
  /** The toggle-button picker; null while not in (enabled) toggle mode. */
  toggle: {
    value: string;
    options: { value: string; label: string; disabled?: boolean; conflict?: UiConflict | null }[];
    conflict: UiConflict | null;
  } | null;
  suspend: { value: boolean; label: string; note: string };
  /** False while desktop mode is off: the axes/buttons/reset dim + disable. */
  controlsEnabled: boolean;
  axes: { heading: string; description: string; cards: DesktopAxisCardModel[] };
  buttons: { heading: string; description: string; rows: DesktopButtonRowModel[] };
  resetLabel: string;
  /** Debounce before an edit persists. */
  persistDebounceMs: number;
};

/** One desktop-settings edit (the `EditDesktopSettings` arg). The structural
 *  rules (function defaults on a kind change, unbinding, the toggle-button
 *  seed) live in the core transform. */
export type DesktopEditOp =
  | { kind: 'setActivation'; value: 'off' | DesktopActivationMode }
  | { kind: 'setToggleButton'; button: number }
  | { kind: 'setSuspend'; value: boolean }
  | { kind: 'setAxisKind'; axis: MenuAxisName; fn: DesktopAxisFunctionKind }
  | { kind: 'setAxisField'; axis: MenuAxisName; key: string; value: number | boolean | string }
  | { kind: 'setButtonChoice'; index: number; choice: DesktopButtonRowModel['choice'] }
  | { kind: 'setButtonActionId'; index: number; id: string }
  | { kind: 'setButtonActionConfig'; index: number; config?: Record<string, unknown> }
  | { kind: 'clearButton'; index: number }
  | { kind: 'reset' };

/** What `EditDesktopSettings` returns: the next settings to adopt + persist,
 *  with `changed: false` for a rejected/no-op edit (nothing to write). */
export type DesktopEditResult = { settings: DesktopSettings; changed: boolean };

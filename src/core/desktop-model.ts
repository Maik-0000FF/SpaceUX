// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The desktop-tab UI model + its edit transforms (#457 C4): everything the
 * Desktop tab renders comes out of `inspectDesktopSettings` as ONE
 * ready-to-display model (axis cards with only the chosen function's fields,
 * button rows, copy, and the unified conflict markers), and every mutation
 * goes through `editDesktopSettings` as one typed operation. Conflicts reduce to
 * the same `UiConflict` shape the navigation editor uses (see nav-model.ts),
 * so ConflictMark renders them identically.
 */

import {
  CURVE_MAX,
  CURVE_MIN,
  DEADZONE_MAX,
  DEADZONE_MIN,
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_PERSIST_DEBOUNCE_MS,
  SPEED_MAX,
  SPEED_MIN,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  defaultAxisFunction,
} from '../shared/desktop-settings.js';
import type {
  DesktopAxisFunction,
  DesktopAxisFunctionKind,
  DesktopSettings,
} from '../shared/ipc.js';
import { MENU_AXES, type MenuAxisName } from '../shared/menu.js';
import type {
  DesktopAxisCardModel,
  DesktopButtonRowModel,
  DesktopEditOp,
  DesktopEditResult,
  DesktopFieldModel,
  DesktopUiModel,
} from '../shared/desktop-ui.js';
import type { UiConflict } from '../shared/nav-ui.js';

import {
  desktopButtonConflicts,
  desktopConflictMessage,
  type DesktopButtonConflict,
} from './desktop-conflicts.js';
import { FALLBACK_BUTTON_COUNT } from './nav-input.js';

// ── UI bands ─────────────────────────────────────────────────────────────────
// Deadzone/threshold/speed/curve share the schema's bounds (shared
// desktop-settings); only cooldown narrows the UI to a usable band (the schema
// clamps at 5 s, the slider offers 2 s) and so stays a UI constant.
const COOLDOWN_UI_MAX_MS = 2000;
const DEADZONE_STEP = 5;
const SPEED_STEP = 0.1;
const CURVE_STEP = 0.1;
const THRESHOLD_STEP = 10;
const COOLDOWN_STEP_MS = 50;

// ── Copy (the one place the wording lives) ───────────────────────────────────

const PAGE_DESCRIPTION =
  "Drive the desktop with the SpaceMouse while the pie isn't open: assign a function to each axis and button. KDE only.";
const AXES_DESCRIPTION =
  'Assign a function to each axis. The settings below each axis change to match the function you pick.';
const BUTTONS_DESCRIPTION = 'Bind device buttons to one-shot desktop actions.';
const SUSPEND_LABEL = 'Suspend while pie open';
const SUSPEND_NOTE =
  'While the pie is open it owns the puck; desktop mode pauses and resumes when the pie closes.';
const RESET_LABEL = 'Reset to Classic preset';
const BLOCKED_AS_TRIGGER_NOTE =
  'This is the pie trigger; with desktop mode always on, binding it would block the pie.';
const PIE_TRIGGER_SUFFIX = ' (pie trigger)';

const AXIS_NAMES: Record<MenuAxisName, string> = {
  tx: 'Slide left / right',
  ty: 'Slide forward / back',
  tz: 'Press / lift',
  rx: 'Tilt forward / back',
  ry: 'Tilt left / right',
  rz: 'Twist',
};

const AXIS_FUNCTION_KINDS: DesktopAxisFunctionKind[] = [
  'none',
  'scroll',
  'zoom',
  'volume',
  'brightness',
  'workspace',
  'overview',
  'showDesktop',
];

const AXIS_FUNCTION_LABELS: Record<DesktopAxisFunctionKind, string> = {
  none: 'None',
  scroll: 'Scroll',
  zoom: 'Zoom',
  volume: 'Volume',
  brightness: 'Brightness',
  workspace: 'Switch workspace',
  overview: 'Overview',
  showDesktop: 'Show desktop',
};

const BUTTON_FUNCTION_VALUES = ['none', 'overview', 'showDesktop', 'action'] as const;
const BUTTON_FUNCTION_LABELS: Record<(typeof BUTTON_FUNCTION_VALUES)[number], string> = {
  none: 'None',
  overview: 'Overview',
  showDesktop: 'Show desktop',
  action: 'Action…',
};

/** The desktop conflict in the unified marking shape (severity + message). */
function toUiConflict(conflict: DesktopButtonConflict | undefined): UiConflict | null {
  if (!conflict) return null;
  return { severity: conflict.hard ? 'hard' : 'soft', message: desktopConflictMessage(conflict) };
}

// ── Field models per function kind ───────────────────────────────────────────

function sliderField(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  decimals: number,
  suffix: string,
): DesktopFieldModel {
  return { control: 'slider', key, label, min, max, step, value, decimals, suffix };
}

/** The function-specific controls for one axis (only the parameters the chosen
 *  function uses). */
function axisFields(fn: DesktopAxisFunction): DesktopFieldModel[] {
  switch (fn.kind) {
    case 'none':
      return [];
    case 'scroll':
      return [
        {
          control: 'select',
          key: 'orientation',
          label: 'Direction',
          value: fn.orientation,
          options: [
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
          ],
        },
        sliderField(
          'deadzone',
          'Deadzone',
          DEADZONE_MIN,
          DEADZONE_MAX,
          DEADZONE_STEP,
          fn.deadzone,
          0,
          '',
        ),
        sliderField('speed', 'Speed', SPEED_MIN, SPEED_MAX, SPEED_STEP, fn.speed, 1, 'x'),
        sliderField('curve', 'Curve', CURVE_MIN, CURVE_MAX, CURVE_STEP, fn.curve, 1, ''),
        { control: 'toggle', key: 'invert', label: 'Invert', value: fn.invert },
      ];
    case 'zoom':
    case 'volume':
    case 'brightness':
      return [
        sliderField(
          'deadzone',
          'Deadzone',
          DEADZONE_MIN,
          DEADZONE_MAX,
          DEADZONE_STEP,
          fn.deadzone,
          0,
          '',
        ),
        sliderField('speed', 'Speed', SPEED_MIN, SPEED_MAX, SPEED_STEP, fn.speed, 1, 'x'),
        { control: 'toggle', key: 'invert', label: 'Invert', value: fn.invert },
      ];
    case 'workspace':
      return [
        sliderField(
          'threshold',
          'Threshold',
          THRESHOLD_MIN,
          THRESHOLD_MAX,
          THRESHOLD_STEP,
          fn.threshold,
          0,
          '',
        ),
        sliderField(
          'cooldownMs',
          'Cooldown',
          0,
          COOLDOWN_UI_MAX_MS,
          COOLDOWN_STEP_MS,
          fn.cooldownMs,
          0,
          ' ms',
        ),
        { control: 'toggle', key: 'invert', label: 'Swap direction', value: fn.invert },
      ];
    case 'overview':
    case 'showDesktop':
      return [
        sliderField(
          'threshold',
          'Threshold',
          THRESHOLD_MIN,
          THRESHOLD_MAX,
          THRESHOLD_STEP,
          fn.threshold,
          0,
          '',
        ),
        sliderField(
          'cooldownMs',
          'Cooldown',
          0,
          COOLDOWN_UI_MAX_MS,
          COOLDOWN_STEP_MS,
          fn.cooldownMs,
          0,
          ' ms',
        ),
      ];
  }
}

// ── The inspect model ────────────────────────────────────────────────────────

/**
 * Build the whole Desktop-tab model. `triggerButton` is the active menu's
 * pie-open trigger (drives the conflict marking + the blocked rows);
 * `buttonCount` the connected device's button count (0 = none/unknown → the
 * fallback range).
 */
export function inspectDesktopSettings(
  settings: DesktopSettings,
  triggerButton: number,
  buttonCount: number,
): DesktopUiModel {
  const buttonsOffered = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;
  const conflicts = desktopButtonConflicts(settings, triggerButton);

  const toggleVisible = settings.enabled && settings.activationMode === 'toggle';
  const toggleValue = settings.toggleButton ?? 0;
  const toggleOptions = Array.from({ length: buttonsOffered }, (_, i) => ({
    value: String(i),
    // The pie trigger can't be the toggle button: the pie always wins, so the
    // toggle would never engage.
    label: `Button ${i}${i === triggerButton ? PIE_TRIGGER_SUFFIX : ''}`,
    disabled: i === triggerButton,
  }));
  if (toggleValue >= buttonsOffered) {
    // A persisted button beyond the connected device's count (a smaller device
    // / profile switch): show it so the picker reflects the stored value.
    toggleOptions.push({
      value: String(toggleValue),
      label: `Button ${toggleValue} (unavailable)`,
      disabled: true,
    });
  }

  const cards: DesktopAxisCardModel[] = MENU_AXES.map((axis) => {
    const fn = settings.axes[axis];
    return {
      axis,
      name: AXIS_NAMES[axis],
      code: axis.toUpperCase(),
      kind: fn.kind,
      kindOptions: AXIS_FUNCTION_KINDS.map((k) => ({ value: k, label: AXIS_FUNCTION_LABELS[k] })),
      fields: axisFields(fn),
    };
  });

  const rows: DesktopButtonRowModel[] = Array.from({ length: buttonsOffered }, (_, index) => {
    const fn = settings.buttons[index] ?? 'none';
    const choice = typeof fn === 'object' ? 'action' : fn;
    // This button is the pie trigger and desktop mode is always on: binding a
    // function would make the pie unreachable, so the options are blocked (a
    // hard conflict is prevented, not just warned).
    const blocked = settings.activationMode === 'always' && index === triggerButton;
    return {
      index,
      label: `Button ${index}`,
      choice,
      options: BUTTON_FUNCTION_VALUES.map((v) => ({
        value: v,
        label: `${BUTTON_FUNCTION_LABELS[v]}${blocked && v !== 'none' ? PIE_TRIGGER_SUFFIX : ''}`,
        disabled: blocked && v !== 'none',
      })),
      conflict: toUiConflict(conflicts.get(index)),
      blockedNote: blocked ? BLOCKED_AS_TRIGGER_NOTE : null,
      action: typeof fn === 'object' ? fn.ref : null,
    };
  });

  return {
    description: PAGE_DESCRIPTION,
    activation: {
      value: settings.enabled ? settings.activationMode : 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'always', label: 'Always on' },
        { value: 'toggle', label: 'Toggle with a button' },
      ],
    },
    toggle: toggleVisible
      ? {
          value: String(toggleValue),
          options: toggleOptions,
          conflict: toUiConflict(conflicts.get('toggle')),
        }
      : null,
    suspend: { value: settings.suspendWhilePieOpen, label: SUSPEND_LABEL, note: SUSPEND_NOTE },
    controlsEnabled: settings.enabled,
    axes: { heading: 'Axes', description: AXES_DESCRIPTION, cards },
    buttons: { heading: 'Buttons', description: BUTTONS_DESCRIPTION, rows },
    resetLabel: RESET_LABEL,
    persistDebounceMs: DESKTOP_PERSIST_DEBOUNCE_MS,
  };
}

// ── Edit transforms ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Per-kind clamp bounds for a numeric axis field (the slider bands above). */
const FIELD_BOUNDS: Record<string, { min: number; max: number }> = {
  deadzone: { min: DEADZONE_MIN, max: DEADZONE_MAX },
  speed: { min: SPEED_MIN, max: SPEED_MAX },
  curve: { min: CURVE_MIN, max: CURVE_MAX },
  threshold: { min: THRESHOLD_MIN, max: THRESHOLD_MAX },
  cooldownMs: { min: 0, max: COOLDOWN_UI_MAX_MS },
};

/**
 * Apply one desktop edit, returning the next settings to adopt + persist.
 * `changed: false` = rejected/no-op (a stale axis field, an unknown key), so
 * the editor writes nothing. A kind
 * change seeds the function's canonical defaults, `none` unbinds a button,
 * picking `action` seeds an empty ref the picker then fills (the persist-side
 * sanitiser drops an id-less action, but the working copy keeps it so the
 * picker stays open), and activation seeds the first toggle button.
 */
export function editDesktopSettings(
  settings: DesktopSettings,
  op: DesktopEditOp,
): DesktopEditResult {
  const next = structuredClone(settings);
  switch (op.kind) {
    case 'setActivation': {
      if (op.value !== 'off' && op.value !== 'always' && op.value !== 'toggle')
        return { settings, changed: false };
      if (op.value === 'off') {
        next.enabled = false;
      } else {
        next.enabled = true;
        next.activationMode = op.value;
        // Toggle mode needs a button to flip it; seed the first one so it
        // can't land in an unusable no-button state.
        if (next.activationMode === 'toggle' && next.toggleButton === null) next.toggleButton = 0;
      }
      return { settings: next, changed: true };
    }
    case 'setToggleButton':
      if (!Number.isInteger(op.button) || op.button < 0) return { settings, changed: false };
      next.toggleButton = op.button;
      return { settings: next, changed: true };
    case 'setSuspend':
      next.suspendWhilePieOpen = op.value;
      return { settings: next, changed: true };
    case 'setAxisKind':
      if (!MENU_AXES.includes(op.axis) || !AXIS_FUNCTION_KINDS.includes(op.fn))
        return { settings, changed: false };
      next.axes[op.axis] = defaultAxisFunction(op.fn);
      return { settings: next, changed: true };
    case 'setAxisField': {
      if (!MENU_AXES.includes(op.axis)) return { settings, changed: false };
      const fn = next.axes[op.axis] as unknown as Record<string, unknown>;
      // Only a field the chosen function actually carries is editable; a stale
      // op (the function changed under the control) is rejected.
      if (!(op.key in fn) || op.key === 'kind') return { settings, changed: false };
      if (typeof op.value === 'number') {
        const bounds = FIELD_BOUNDS[op.key];
        if (!bounds || !Number.isFinite(op.value)) return { settings, changed: false };
        fn[op.key] = clamp(op.value, bounds.min, bounds.max);
      } else if (typeof fn[op.key] === typeof op.value) {
        fn[op.key] = op.value;
      } else {
        return { settings, changed: false };
      }
      return { settings: next, changed: true };
    }
    case 'setButtonChoice':
      if (!Number.isInteger(op.index) || op.index < 0) return { settings, changed: false };
      if (op.choice === 'none') delete next.buttons[op.index];
      else if (op.choice === 'action') next.buttons[op.index] = { kind: 'action', ref: { id: '' } };
      else next.buttons[op.index] = op.choice;
      return { settings: next, changed: true };
    case 'setButtonActionId': {
      const cur = next.buttons[op.index];
      if (typeof cur === 'object') cur.ref.id = op.id;
      else next.buttons[op.index] = { kind: 'action', ref: { id: op.id } };
      return { settings: next, changed: true };
    }
    case 'setButtonActionConfig': {
      const cur = next.buttons[op.index];
      if (typeof cur !== 'object') return { settings, changed: false };
      if (op.config === undefined) delete cur.ref.config;
      else cur.ref.config = op.config;
      return { settings: next, changed: true };
    }
    case 'clearButton':
      if (next.buttons[op.index] === undefined) return { settings, changed: false };
      delete next.buttons[op.index];
      return { settings: next, changed: true };
    case 'reset':
      return { settings: structuredClone(DEFAULT_DESKTOP_SETTINGS), changed: true };
  }
}

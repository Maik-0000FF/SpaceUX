// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The navigation/input UI model + its edit transforms (#457 C3): everything the
 * editor's "Menu settings" / "Navigation" sections, the per-item gesture lists
 * and the centre trigger render comes out of `inspectNavInput` as ONE
 * ready-to-display model (options, labels, notes, warnings, conflicts), and
 * every mutation goes through `editNavigation` as one typed operation. The Qt
 * editor calls both over D-Bus and renders dumbly, so the binding semantics,
 * the option set and every warning copy live here once.
 *
 * UNIFIED CONFLICT MARKING: `UiConflict` is the one shape every flagged binding
 * reduces to, regardless of which detector found it (the navigation-gesture
 * rivalry in gesture-collision, the physical-button double-booking in
 * button-conflicts, and the desktop-mode bindings when that tab lands). The
 * severity drives the one marker style the editor has (soft = amber ⚠, hard =
 * red ⚠, message on hover), so changing how conflicts LOOK is one QML
 * component (ConflictMark) and changing what they SAY or WHEN they fire is
 * this module + the detectors it folds in.
 */

import {
  AIM_SOURCES,
  ACTIVATION_DIRECTIONS,
  DEFAULT_GESTURE_THRESHOLD,
  DEFAULT_TRIGGER_BUTTON,
  DEFAULT_TRIGGER_MODE,
  DEFAULT_TWIST_CYCLE_THRESHOLD,
  MAGNITUDE_SOURCES,
  MAX_LATERAL_DEADZONE,
  MENU_AXES,
  MIN_LATERAL_DEADZONE,
  TRIGGER_MODES,
  TWIST_CYCLE_PRIORITIES,
  isCancelNode,
  resolveNavigation,
  type AimSource,
  type GestureBinding,
  type InputBinding,
  type MenuConfig,
  type MenuNavigation,
  type TriggerMode,
  type TwistCyclePriority,
} from '../shared/menu.js';
import type { PluginsState } from '../shared/ipc.js';
import { NAVIGATION_PRESETS, matchNavigationPreset } from '../shared/navigation-presets.js';
import { formatPluginKey } from '../shared/plugin-key.js';
import type {
  GestureListModel,
  NavEditOp,
  NavEditTarget,
  NavOption,
  NavUiModel,
  UiConflict,
} from '../shared/nav-ui.js';

import { collectButtonBindings, conflictsOn, severityOf } from './button-conflicts.js';
import {
  NAV_GESTURE_LABELS,
  gestureShadows,
  inputConflict,
  unreachableThresholdHint,
} from './gesture-collision.js';
import {
  FALLBACK_BUTTON_COUNT,
  MAGNITUDE_LABEL,
  axisOptionLabel,
  inputFromValue,
  inputThreshold,
  inputValue,
} from './nav-input.js';
import { nodeAt } from './menu-edit.js';

// The wire types (UiConflict, NavOption, NavUiModel, NavEditOp, ...) live in
// shared/nav-ui.ts so the core contract can reference them; this module is
// their builder + transform.

// ── Copy (the one place the wording lives) ───────────────────────────────────

const AIM_LABELS: Record<AimSource, string> = {
  push: 'Push (TX / TY)',
  tilt: 'Tilt (RX / RY)',
  both: 'Push + Tilt (equal)',
  twist: 'Twist (RZ, step only)',
};

const TRIGGER_MODE_LABELS: Record<TriggerMode, string> = {
  toggle: 'Toggle (open, then commit / close)',
  open: 'Open only',
};

const TRIGGER_MODE_NOTES: Record<TriggerMode, string> = {
  toggle:
    'Press to open; press again to commit the highlighted item (the centre when nothing is aimed).',
  open: 'The button only opens the menu; commit and close with gestures. The trigger is then free to bind as an input.',
};

const DEADZONE_NOTE =
  'Hover starts past the low value; aiming firmly past the high value opens the hovered submenu (no separate input needed).';

const TWIST_WARNING =
  'Twist aiming only steps through items: bind an axis (e.g. Twist RZ) under "Step through items", or the selection can\'t leave the centre.';

const DRILL_NOTE =
  'Optional: aiming firmly already opens the hovered submenu. Bind an input only for an extra way in.';

const CUSTOM_STYLE_DESCRIPTION = 'Your own combination of navigation gestures.';

const PRIORITY_LABELS: Record<TwistCyclePriority, string> = {
  lateral: 'Lateral aiming wins',
  twist: 'Twist wins',
};

function reachWarning(warn: { threshold: number; reference: number } | null): string | null {
  if (!warn) return null;
  return `May never fire: its threshold (${warn.threshold}) is firmer than any navigation gesture (up to ${warn.reference}). Lower it.`;
}

function shadowsWarning(shadows: string[], verb: string): string | null {
  if (shadows.length === 0) return null;
  return `Shares an input with ${shadows.join(', ')}; this item's ${verb} wins here.`;
}

// ── Option lists ─────────────────────────────────────────────────────────────

const GROUP_BUTTONS = 'Buttons';
const GROUP_AXES = 'Axes';
const GROUP_MAGNITUDE = 'Magnitude';

/**
 * The input dropdown's option list for one row:
 * None, the device's buttons, every split axis, the 2D magnitudes. `axisOnly`
 * (the cycle step needs a sign) offers None + Axes only. A saved value with no
 * live option (a button the device lacks; a non-axis under axisOnly) is
 * appended disabled so the dropdown shows the truth instead of silently
 * snapping elsewhere.
 */
export function navInputOptions(
  current: InputBinding,
  buttonsOffered: number,
  axisOnly: boolean,
): NavOption[] {
  const options: NavOption[] = [{ value: 'none', label: 'None' }];
  if (axisOnly && current.kind !== 'axis' && current.kind !== 'none') {
    options.push({ value: inputValue(current), label: "Can't step: pick an axis", disabled: true });
  }
  if (!axisOnly) {
    for (let b = 0; b < buttonsOffered; b++) {
      options.push({ value: `button:${b}`, label: `Button ${b}`, group: GROUP_BUTTONS });
    }
    if (current.kind === 'button' && current.button >= buttonsOffered) {
      options.push({
        value: `button:${current.button}`,
        label: `Button ${current.button} (unavailable)`,
        group: GROUP_BUTTONS,
        disabled: true,
      });
    }
  }
  for (const axis of MENU_AXES) {
    for (const dir of ACTIVATION_DIRECTIONS) {
      options.push({
        value: `axis:${axis}:${dir}`,
        label: axisOptionLabel(axis, dir),
        group: GROUP_AXES,
      });
    }
  }
  if (!axisOnly) {
    for (const source of MAGNITUDE_SOURCES) {
      options.push({
        value: `magnitude:${source}`,
        label: MAGNITUDE_LABEL[source],
        group: GROUP_MAGNITUDE,
      });
    }
  }
  return options;
}

// ── The inspect model ────────────────────────────────────────────────────────

const RING_GESTURES = ['drillIn', 'activate', 'back', 'cycle'] as const;
type RingGesture = (typeof RING_GESTURES)[number];

/** Default threshold to seed a fresh analog input with, per gesture: cycle
 *  sits below the drill range (gentle twist steps, firm twist drills). */
function defaultThresholdFor(gesture: string): number {
  return gesture === 'cycle' ? DEFAULT_TWIST_CYCLE_THRESHOLD : DEFAULT_GESTURE_THRESHOLD;
}

/** Plugin-contributed navigation-style presets (#195), flattened with their
 *  namespaced dropdown keys (`<pluginId>/<presetId>`, so two plugins shipping
 *  a preset called "twist" stay distinguishable and a built-in id can never be
 *  shadowed). The plugin name disambiguates duplicate labels. */
function pluginNavPresets(plugins: PluginsState | null) {
  if (!plugins) return [];
  return plugins.plugins.flatMap((p) =>
    p.kind === 'nav-style' && p.navStylePresets
      ? p.navStylePresets.map((preset) => ({
          key: formatPluginKey(p.id, preset.id),
          label: p.name && p.name !== preset.label ? `${preset.label} · ${p.name}` : preset.label,
          description: preset.description,
          navigation: preset.navigation,
        }))
      : [],
  );
}

/** The gesture-list model for a navigation gesture: rows with their unified
 *  conflict markers plus the section's conflict lines. */
function navGestureList(
  key: RingGesture | 'commitCenter',
  nav: MenuNavigation,
  buttonsOffered: number,
  centreIsCancel: boolean,
): GestureListModel {
  const axisOnly = key === 'cycle';
  const warnings: string[] = [];
  const rows = nav[key].inputs.map((input) => {
    const conflict = inputConflict(key, input, nav, centreIsCancel);
    const ui: UiConflict | null = conflict
      ? {
          severity: 'soft',
          message: `${conflict.trigger} also fires ${conflict.gestures.join(', ')}; they may fight. ${conflict.fix}`,
        }
      : null;
    if (ui) warnings.push(ui.message);
    return {
      value: inputValue(input),
      threshold: inputThreshold(input),
      options: navInputOptions(input, buttonsOffered, axisOnly),
      conflict: ui,
    };
  });
  if (key === 'activate' || key === 'commitCenter') {
    const reach = reachWarning(unreachableThresholdHint(nav[key], nav));
    if (reach) warnings.push(reach);
  }
  return { rows, warnings };
}

/** The gesture-list model for a per-item binding (activation / exit): no
 *  rivalry conflicts (the per-item input deliberately wins), but the shadow
 *  note + the reachability hint. */
function nodeGestureList(
  binding: GestureBinding | undefined,
  nav: MenuNavigation,
  buttonsOffered: number,
  verb: string,
): GestureListModel {
  const rows = (binding?.inputs ?? []).map((input) => ({
    value: inputValue(input),
    threshold: inputThreshold(input),
    options: navInputOptions(input, buttonsOffered, false),
    conflict: null,
  }));
  const warnings: string[] = [];
  const shadow = shadowsWarning(gestureShadows(binding, nav), verb);
  if (shadow) warnings.push(shadow);
  const reach = reachWarning(unreachableThresholdHint(binding, nav));
  if (reach) warnings.push(reach);
  return { rows, warnings };
}

/**
 * Build the whole navigation/input UI model. `path` selects the per-item
 * section: null = nothing selected, [] = the centre (its commit trigger),
 * a ring path = that node's activation/exit lists. `buttonCount` is the
 * connected device's button count (0 = none/unknown → the fallback range).
 */
export function inspectNavInput(
  config: MenuConfig,
  path: readonly number[] | null,
  buttonCount: number,
  plugins: PluginsState | null = null,
): NavUiModel {
  const buttonsOffered = buttonCount > 0 ? buttonCount : FALLBACK_BUTTON_COUNT;
  const nav = resolveNavigation(config);
  // Whether the centre is a cancel node decides if commitCenter+back on a
  // shared input is a real clash or a runtime-safe pairing (#404, see
  // navigationConflicts), so the same flag drives every gesture list here.
  const centreIsCancel = isCancelNode(config.root);
  const triggerMode = config.triggerMode ?? DEFAULT_TRIGGER_MODE;
  const trigger = config.triggerButton ?? DEFAULT_TRIGGER_BUTTON;

  // Trigger picker (#75): every offered button carries its double-booking
  // severity + message through the one UiConflict shape. Only meaningful in
  // toggle mode (open-only frees the trigger to double as an input).
  const bindings = collectButtonBindings(config);
  const triggerConflict = (b: number): UiConflict | null => {
    if (triggerMode !== 'toggle') return null;
    const hits = conflictsOn(bindings, b, 'Trigger button');
    const severity = severityOf(hits);
    if (severity === 'free') return null;
    return {
      severity,
      message: `Also used by ${hits.map((c) => c.source).join(', ')}. The same press would do both.`,
    };
  };
  const triggerOptions: NavOption[] = Array.from({ length: buttonsOffered }, (_, b) => ({
    value: String(b),
    label: `Button ${b}`,
    conflict: triggerConflict(b),
  }));
  const maxButton = buttonCount > 0 ? buttonCount - 1 : null;
  const triggerOutOfRange = maxButton !== null && trigger > maxButton;
  if (trigger >= buttonsOffered) {
    triggerOptions.push({
      value: String(trigger),
      label: `Button ${trigger}${triggerOutOfRange ? ' (unavailable)' : ''}`,
      disabled: true,
    });
  }

  // Navigation style (#160): built-ins + plugin-contributed presets (#195,
  // appended after the built-ins in install order) + a disabled "Custom"
  // entry while the bindings match no preset.
  const fromPlugins = pluginNavPresets(plugins);
  const styleId = matchNavigationPreset(
    nav,
    fromPlugins.map((p) => ({ id: p.key, navigation: p.navigation })),
  );
  const customOption = {
    value: 'custom',
    label: 'Custom',
    description: CUSTOM_STYLE_DESCRIPTION,
    disabled: true,
  };
  const styleOptions = [
    ...(styleId === null ? [customOption] : []),
    ...NAVIGATION_PRESETS.map((p) => ({ value: p.id, label: p.label, description: p.description })),
    ...fromPlugins.map((p) => ({
      value: p.key,
      label: p.label,
      description: p.description,
      group: 'From plugins',
    })),
  ];
  const currentStyle =
    NAVIGATION_PRESETS.find((p) => p.id === styleId) ?? fromPlugins.find((p) => p.key === styleId);

  // Twist aiming has no lateral pointer: without a cycle axis the selection
  // can't leave the centre (#160), flagged inline.
  const twistNeedsCycle =
    nav.aim === 'twist' && !nav.cycle.inputs.some((input) => input.kind === 'axis');

  const node = path !== null && path.length > 0 ? nodeAt(config, path) : null;

  return {
    buttonsOffered,
    menuSettings: {
      trigger: {
        value: trigger,
        options: triggerOptions,
        rangeError: triggerOutOfRange
          ? `This device has ${buttonCount} buttons (0-${maxButton}). Pick a lower button.`
          : null,
        conflictNote: triggerConflict(trigger)?.message ?? null,
      },
      mode: {
        value: triggerMode,
        options: TRIGGER_MODES.map((m) => ({ value: m, label: TRIGGER_MODE_LABELS[m] })),
        note: TRIGGER_MODE_NOTES[triggerMode],
      },
    },
    style: {
      value: styleId ?? 'custom',
      options: styleOptions,
      description: currentStyle?.description ?? CUSTOM_STYLE_DESCRIPTION,
      customOption,
    },
    aim: {
      value: nav.aim,
      options: AIM_SOURCES.map((a) => ({ value: a, label: AIM_LABELS[a] })),
    },
    deadzone: {
      hover: nav.hoverDeadzone,
      open: nav.deadzone,
      min: MIN_LATERAL_DEADZONE,
      max: MAX_LATERAL_DEADZONE,
      step: DEADZONE_STEP,
      disabled: nav.aim === 'twist',
      note: nav.aim === 'twist' ? null : DEADZONE_NOTE,
    },
    twistWarning: twistNeedsCycle ? TWIST_WARNING : null,
    gestures: RING_GESTURES.map((key) => ({
      key,
      label: NAV_GESTURE_LABELS[key],
      note: key === 'drillIn' && nav.aim !== 'twist' ? DRILL_NOTE : null,
      list: navGestureList(key, nav, buttonsOffered, centreIsCancel),
      priority:
        key === 'cycle'
          ? {
              value: nav.cycle.priority,
              options: TWIST_CYCLE_PRIORITIES.map((p) => ({
                value: p,
                label: PRIORITY_LABELS[p],
              })),
            }
          : null,
    })),
    node: node
      ? {
          activation: nodeGestureList(node.activation, nav, buttonsOffered, 'activation'),
          exit: nodeGestureList(node.exit, nav, buttonsOffered, 'exit'),
        }
      : null,
    centre:
      path !== null && path.length === 0
        ? { commit: navGestureList('commitCenter', nav, buttonsOffered, centreIsCancel) }
        : null,
  };
}

/** Deadzone slider granularity (the DualRange's step). */
const DEADZONE_STEP = 5;

// ── Edit transforms ──────────────────────────────────────────────────────────

/**
 * Whether an edit op touches the `navigation` block the style presets match
 * against (so the editor knows when to flip its sticky-custom display): the
 * aim/deadzone/priority sets, a preset apply, and the input ops on a NAV
 * gesture. Trigger button/mode and the per-node activation/exit bindings are
 * outside the matched block.
 */
export function navEditTouchesNavigation(op: NavEditOp): boolean {
  switch (op.kind) {
    case 'setAim':
    case 'setDeadzone':
    case 'setCyclePriority':
    case 'applyPreset':
      return true;
    case 'setTriggerButton':
    case 'setTriggerMode':
      return false;
    default:
      return op.target.scope === 'nav';
  }
}

/** The seed threshold for a fresh analog input at `target`. */
function targetDefaultThreshold(target: NavEditTarget): number {
  return target.scope === 'nav' ? defaultThresholdFor(target.gesture) : DEFAULT_GESTURE_THRESHOLD;
}

/**
 * Apply one navigation/input edit, returning a NEW config (the input is never
 * mutated; an invalid op returns it by identity, like the move transforms).
 * Navigation-block edits materialise the resolved navigation
 * (clone-resolved-then-mutate), so editing a config
 * that was riding on defaults pins them; node edits create the binding on the
 * first add and drop it when its last input is removed.
 */
export function editNavigation(
  config: MenuConfig,
  op: NavEditOp,
  plugins: PluginsState | null = null,
): MenuConfig {
  const copy = structuredClone(config);

  if (op.kind === 'setTriggerButton') {
    copy.triggerButton = op.button;
    return copy;
  }
  if (op.kind === 'setTriggerMode') {
    copy.triggerMode = op.mode;
    return copy;
  }
  if (op.kind === 'applyPreset') {
    const navigation =
      NAVIGATION_PRESETS.find((p) => p.id === op.presetId)?.navigation ??
      pluginNavPresets(plugins).find((p) => p.key === op.presetId)?.navigation;
    if (!navigation) return config;
    copy.navigation = structuredClone(navigation);
    return copy;
  }

  if (op.kind === 'setAim' || op.kind === 'setDeadzone' || op.kind === 'setCyclePriority') {
    const nav = structuredClone(resolveNavigation(copy));
    if (op.kind === 'setAim') nav.aim = op.aim;
    else if (op.kind === 'setDeadzone') {
      nav.hoverDeadzone = op.hover;
      nav.deadzone = op.open;
    } else nav.cycle.priority = op.priority;
    copy.navigation = nav;
    return copy;
  }

  // Input-list ops: resolve the binding the target names, then splice/set.
  if (op.target.scope === 'nav') {
    const nav = structuredClone(resolveNavigation(copy));
    const binding = nav[op.target.gesture];
    if (!applyInputOp(binding, op)) return config;
    copy.navigation = nav;
    return copy;
  }
  const node = nodeAt(copy, op.target.path);
  if (!node || op.target.path.length === 0) return config;
  const key = op.target.binding;
  if (op.kind === 'addInput' && node[key] === undefined) node[key] = { inputs: [] };
  const binding = node[key];
  if (!binding || !applyInputOp(binding, op)) return config;
  // A per-item binding with no inputs left is dropped entirely (the saved
  // config never carries an empty binding).
  if (binding.inputs.length === 0) delete node[key];
  return copy;
}

/** Apply a set/add/remove/threshold op to a binding's input list in place.
 *  False = invalid (out-of-range index / threshold on a non-analog input). */
function applyInputOp(binding: { inputs: InputBinding[] }, op: NavEditOp): boolean {
  if (op.kind === 'addInput') {
    binding.inputs.push({ kind: 'none' });
    return true;
  }
  if (op.kind === 'removeInput') {
    if (op.index < 0 || op.index >= binding.inputs.length) return false;
    binding.inputs.splice(op.index, 1);
    return true;
  }
  if (op.kind === 'setInput') {
    if (op.index < 0 || op.index >= binding.inputs.length) return false;
    const prev = binding.inputs[op.index]!;
    binding.inputs[op.index] = inputFromValue(
      op.value,
      inputThreshold(prev),
      targetDefaultThreshold(op.target),
    );
    return true;
  }
  if (op.kind === 'setThreshold') {
    if (op.index < 0 || op.index >= binding.inputs.length) return false;
    const input = binding.inputs[op.index]!;
    if (input.kind !== 'axis' && input.kind !== 'magnitude') return false;
    if (!Number.isFinite(op.threshold) || op.threshold <= 0) return false;
    input.threshold = op.threshold;
    return true;
  }
  return false;
}

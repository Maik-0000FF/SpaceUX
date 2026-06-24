// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { MENU_AXES } from './menu.js';
import type { ActionRef } from './menu.js';
import type {
  DesktopAxisFunction,
  DesktopAxisFunctionKind,
  DesktopAxisMap,
  DesktopButtonFunction,
  DesktopSettings,
} from './ipc.js';

/**
 * Defaults + validation for the global desktop-mode settings (#199). Kept pure
 * (no IO) so the core and the tests share it, the same split as
 * pie-appearance / input-settings: the `DesktopSettings`
 * type lives in ipc.ts, the runtime defaults and the trust-boundary sanitiser
 * live here.
 *
 * The config is axis-centric: every axis maps to a function (a discriminated
 * union carrying only that function's parameters), and buttons map to discrete
 * one-shots. `sanitizeDesktopSettings` is a full validator (fills defaults for
 * anything missing or malformed) rather than a partial-patch filter, so the
 * renderer sends the whole object and one rule validates both the IPC write and
 * the blob read back from disk.
 */

// Clamp bounds. Deadzone and threshold are raw axis units and cap at the
// SpaceMouse's full deflection (~400): the puck can't push past it, so a larger
// deadzone would never let the function start and a larger threshold would never
// fire. Speed / curve / cooldown are picked to keep values finite and sane
// without constraining the live tuning later. Exported so the editor's sliders
// share these bounds instead of re-declaring them.
export const DEADZONE_MIN = 0;
export const DEADZONE_MAX = 400;
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 400;
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 10;
export const CURVE_MIN = 0.5;
export const CURVE_MAX = 5;
const COOLDOWN_MIN_MS = 0;
const COOLDOWN_MAX_MS = 5000;
const BUTTON_MIN = 0;
const BUTTON_MAX = 63;

/** Debounce before a desktop-settings edit persists: sliders fire a change per
 *  drag step, so the editors update optimistically and write once the drag
 *  settles instead of ~16x per second. */
export const DESKTOP_PERSIST_DEBOUNCE_MS = 300;

// Canonical per-function defaults, independent of which axis carries the
// function (so assigning a fresh function to an axis seeds sensible values).
const SCROLL_DEFAULTS = {
  orientation: 'vertical' as const,
  deadzone: 50,
  speed: 1,
  curve: 1,
  invert: false,
};
const ZOOM_DEFAULTS = { deadzone: 50, speed: 1, invert: false };
const VOLUME_DEFAULTS = { deadzone: 50, speed: 1, invert: false };
const BRIGHTNESS_DEFAULTS = { deadzone: 50, speed: 1, invert: false };
const WORKSPACE_DEFAULTS = { threshold: 200, cooldownMs: 300, invert: false };
const DISCRETE_DEFAULTS = { threshold: 200, cooldownMs: 300 };

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  enabled: false,
  activationMode: 'always',
  toggleButton: null,
  suspendWhilePieOpen: true,
  // Classic preset: tilt scrolls, push/pull zooms, slide controls volume, twist
  // switches workspaces; the rest unbound.
  axes: {
    tx: { kind: 'volume', ...VOLUME_DEFAULTS },
    ty: { kind: 'none' },
    tz: { kind: 'zoom', ...ZOOM_DEFAULTS },
    rx: { kind: 'scroll', ...SCROLL_DEFAULTS },
    ry: { kind: 'none' },
    rz: { kind: 'workspace', ...WORKSPACE_DEFAULTS },
  },
  // No buttons bound by default: the pie trigger is button 0, so a default
  // overview/show-desktop there would clash with it. The user binds buttons in
  // the editor, where the conflict check blocks a clash with the trigger.
  buttons: {},
};

/** A fresh axis function of the given kind, seeded with its canonical defaults.
 *  Used by the editor when the user assigns a new function to an axis. */
export function defaultAxisFunction(kind: DesktopAxisFunctionKind): DesktopAxisFunction {
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'scroll':
      return { kind: 'scroll', ...SCROLL_DEFAULTS };
    case 'zoom':
      return { kind: 'zoom', ...ZOOM_DEFAULTS };
    case 'volume':
      return { kind: 'volume', ...VOLUME_DEFAULTS };
    case 'brightness':
      return { kind: 'brightness', ...BRIGHTNESS_DEFAULTS };
    case 'workspace':
      return { kind: 'workspace', ...WORKSPACE_DEFAULTS };
    case 'overview':
      return { kind: 'overview', ...DISCRETE_DEFAULTS };
    case 'showDesktop':
      return { kind: 'showDesktop', ...DISCRETE_DEFAULTS };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A finite-number field, clamped; falls back to `fallback` when absent or not
 *  a finite number (so a malformed value can't store a NaN or out-of-range). */
function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Validate one axis function. The discriminator picks the shape; each field is
 * kept only with the right type/range, else it takes the function's canonical
 * default. An unknown / missing kind falls back to `fallback` (the axis's own
 * default function), so a malformed entry can't blank an axis.
 */
function sanitizeAxisFunction(value: unknown, fallback: DesktopAxisFunction): DesktopAxisFunction {
  if (!isObject(value)) return fallback;
  switch (value.kind) {
    case 'none':
      return { kind: 'none' };
    case 'scroll':
      return {
        kind: 'scroll',
        orientation: value.orientation === 'horizontal' ? 'horizontal' : 'vertical',
        deadzone: num(value.deadzone, DEADZONE_MIN, DEADZONE_MAX, SCROLL_DEFAULTS.deadzone),
        speed: num(value.speed, SPEED_MIN, SPEED_MAX, SCROLL_DEFAULTS.speed),
        curve: num(value.curve, CURVE_MIN, CURVE_MAX, SCROLL_DEFAULTS.curve),
        invert: bool(value.invert, SCROLL_DEFAULTS.invert),
      };
    case 'zoom':
      return {
        kind: 'zoom',
        deadzone: num(value.deadzone, DEADZONE_MIN, DEADZONE_MAX, ZOOM_DEFAULTS.deadzone),
        speed: num(value.speed, SPEED_MIN, SPEED_MAX, ZOOM_DEFAULTS.speed),
        invert: bool(value.invert, ZOOM_DEFAULTS.invert),
      };
    case 'volume':
      return {
        kind: 'volume',
        deadzone: num(value.deadzone, DEADZONE_MIN, DEADZONE_MAX, VOLUME_DEFAULTS.deadzone),
        speed: num(value.speed, SPEED_MIN, SPEED_MAX, VOLUME_DEFAULTS.speed),
        invert: bool(value.invert, VOLUME_DEFAULTS.invert),
      };
    case 'brightness':
      return {
        kind: 'brightness',
        deadzone: num(value.deadzone, DEADZONE_MIN, DEADZONE_MAX, BRIGHTNESS_DEFAULTS.deadzone),
        speed: num(value.speed, SPEED_MIN, SPEED_MAX, BRIGHTNESS_DEFAULTS.speed),
        invert: bool(value.invert, BRIGHTNESS_DEFAULTS.invert),
      };
    case 'workspace':
      return {
        kind: 'workspace',
        threshold: num(value.threshold, THRESHOLD_MIN, THRESHOLD_MAX, WORKSPACE_DEFAULTS.threshold),
        cooldownMs: num(
          value.cooldownMs,
          COOLDOWN_MIN_MS,
          COOLDOWN_MAX_MS,
          WORKSPACE_DEFAULTS.cooldownMs,
        ),
        invert: bool(value.invert, WORKSPACE_DEFAULTS.invert),
      };
    case 'overview':
    case 'showDesktop':
      return {
        kind: value.kind,
        threshold: num(value.threshold, THRESHOLD_MIN, THRESHOLD_MAX, DISCRETE_DEFAULTS.threshold),
        cooldownMs: num(
          value.cooldownMs,
          COOLDOWN_MIN_MS,
          COOLDOWN_MAX_MS,
          DISCRETE_DEFAULTS.cooldownMs,
        ),
      };
    default:
      return fallback;
  }
}

/** Validate one button function: the first-class strings, or an `action`
 *  variant carrying an {@link ActionRef}. The id must be a non-empty string;
 *  `config` is kept only when it's a non-array object (its inner shape is the
 *  action's own concern), otherwise dropped so the id-only action survives.
 *  Returns null for `none` / anything malformed, so the index reads as unbound. */
function sanitizeButtonFunction(fn: unknown): DesktopButtonFunction | null {
  if (fn === 'overview' || fn === 'showDesktop') return fn;
  if (isObject(fn) && fn.kind === 'action' && isObject(fn.ref)) {
    const ref = fn.ref;
    if (typeof ref.id !== 'string' || ref.id.trim() === '') return null;
    const out: ActionRef = { id: ref.id };
    // Reject an array config the way the menu loader does (isObject alone is
    // array-permissive); keep the id-only action rather than dropping the whole
    // binding.
    if (isObject(ref.config) && !Array.isArray(ref.config)) {
      out.config = ref.config;
    }
    return { kind: 'action', ref: out };
  }
  return null;
}

function sanitizeButtons(value: unknown): Record<number, DesktopButtonFunction> {
  const out: Record<number, DesktopButtonFunction> = {};
  if (!isObject(value)) return out;
  for (const [key, fn] of Object.entries(value)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < BUTTON_MIN || idx > BUTTON_MAX) continue;
    const clean = sanitizeButtonFunction(fn);
    if (clean !== null) out[idx] = clean;
  }
  return out;
}

function activationMode(value: unknown): DesktopSettings['activationMode'] {
  return value === 'toggle' || value === 'always' ? value : DEFAULT_DESKTOP_SETTINGS.activationMode;
}

function toggleButton(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value)
    ? clamp(value, BUTTON_MIN, BUTTON_MAX)
    : DEFAULT_DESKTOP_SETTINGS.toggleButton;
}

/**
 * Validate an untrusted desktop-settings object (from the editor renderer over
 * IPC, or read back from app-settings.json) into a complete `DesktopSettings`.
 * Every field is kept only when it has the right type/range, else it takes the
 * default, so a malformed or partial blob always resolves to a usable config
 * rather than being rejected.
 */
export function sanitizeDesktopSettings(value: unknown): DesktopSettings {
  const o = isObject(value) ? value : {};
  const def = DEFAULT_DESKTOP_SETTINGS;
  const axesIn = isObject(o.axes) ? o.axes : {};
  const axes = {} as DesktopAxisMap;
  for (const axis of MENU_AXES) {
    axes[axis] = sanitizeAxisFunction(axesIn[axis], def.axes[axis]);
  }
  const mode = activationMode(o.activationMode);
  // Toggle mode needs a button to flip it on/off; a null button there is an
  // unusable dead-end, so default it to the first button.
  let toggleBtn = toggleButton(o.toggleButton);
  if (mode === 'toggle' && toggleBtn === null) toggleBtn = 0;
  return {
    enabled: bool(o.enabled, def.enabled),
    activationMode: mode,
    toggleButton: toggleBtn,
    suspendWhilePieOpen: bool(o.suspendWhilePieOpen, def.suspendWhilePieOpen),
    axes,
    // Absent buttons key → the default bindings (a blob that predates buttons,
    // or the whole-object default); an explicit object (even `{}`) is taken as
    // the user's set, so clearing every button persists.
    buttons: o.buttons === undefined ? { ...def.buttons } : sanitizeButtons(o.buttons),
  };
}

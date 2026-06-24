// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { SixAxes } from '../core/pie-geometry.js';
import type { DesktopAxisFunction, DesktopSettings } from '../shared/ipc.js';
import { MENU_AXES, type MenuAxisName } from '../shared/menu.js';
import type { AxesEvent } from '../shared/protocol.js';

import type { DesktopBackend } from './desktop-actions.js';
import type { SystemControlBackend } from './system-control.js';

/**
 * Desktop-mode runtime interpreter (#199). Reads the SpaceMouse axes/buttons
 * while the pie isn't in control and drives the desktop from the axis-centric
 * config: continuous functions (scroll/zoom/volume/brightness) integrate
 * deflection into an output rate on a ~60Hz tick (armed on deflection, stopped
 * once the puck settles, so it costs nothing at rest); discrete functions
 * (workspace/overview/show-desktop) fire once per threshold crossing with a
 * cooldown, event-driven off the incoming axes. Scroll injects a relative wheel,
 * zoom taps Ctrl+Shift+= / Ctrl+-, volume + brightness go through the
 * per-compositor system-control backend, and the workspace/overview/show-desktop
 * functions go through the per-compositor desktop backend.
 *
 * Activation: `always` runs whenever enabled; `toggle` flips on a button. The
 * grab is held the whole time desktop mode is on (so a 3D app underneath never
 * sees the puck), and suspension (pie open) only pauses emission, it doesn't
 * drop the grab. The shaping maths is pure (`shapedAxisRate`) so it's testable
 * on its own.
 */

// Calibration constants. The base rates are starting points tuned live via the
// per-axis speed slider; the reference deflection normalises the curve input.
const AXIS_REFERENCE = 350;
const TICK_MS = 16;
const SCROLL_HIRES_PER_SEC = 600; // hi-res wheel units/s at full deflection, speed 1
const ZOOM_STEPS_PER_SEC = 6; // Ctrl+= / Ctrl+- taps/s
const VOLUME_STEPS_PER_SEC = 8; // media-key taps/s
const BRIGHTNESS_STEPS_PER_SEC = 8; // brightness steps/s
const MAX_CHORD_TAPS_PER_TICK = 20; // safety cap on a chord burst

// Linux input-event-codes for the chord-based dispatch (raw, since injectChord
// takes keycodes directly). Zoom-in is Ctrl+Shift+= (Ctrl with the '+'
// character): most apps bind zoom-in to '+', not to a bare '=' (Ctrl+= only
// zooms in some apps, e.g. Firefox). Zoom-out is Ctrl+-.
const KEY_LEFTCTRL = 29;
const KEY_LEFTSHIFT = 42;
const KEY_EQUAL = 13;
const KEY_MINUS = 12;

type ContinuousFunction = Extract<
  DesktopAxisFunction,
  { kind: 'scroll' | 'zoom' | 'volume' | 'brightness' }
>;
type DiscreteFunction = Extract<
  DesktopAxisFunction,
  { kind: 'workspace' | 'overview' | 'showDesktop' }
>;

function isContinuous(fn: DesktopAxisFunction): fn is ContinuousFunction {
  return (
    fn.kind === 'scroll' || fn.kind === 'zoom' || fn.kind === 'volume' || fn.kind === 'brightness'
  );
}

function isDiscrete(fn: DesktopAxisFunction): fn is DiscreteFunction {
  return fn.kind === 'workspace' || fn.kind === 'overview' || fn.kind === 'showDesktop';
}

/**
 * Signed output rate for a continuous deflection: 0 inside the deadzone, else
 * the deadzone-clipped magnitude normalised against {@link AXIS_REFERENCE},
 * shaped by the response `curve` exponent, scaled by `speed`, and signed by the
 * deflection direction (flipped by `invert`). Pure, so the shaping is testable.
 */
export function shapedAxisRate(
  deflection: number,
  deadzone: number,
  speed: number,
  curve: number,
  invert: boolean,
): number {
  const mag = Math.abs(deflection);
  if (mag <= deadzone) return 0;
  const span = AXIS_REFERENCE - deadzone;
  const norm = span > 0 ? Math.min(1, (mag - deadzone) / span) : 1;
  const shaped = Math.pow(norm, curve);
  const dir = (deflection < 0 ? -1 : 1) * (invert ? -1 : 1);
  return dir * shaped * speed;
}

/** A 60Hz tick the interpreter starts while the puck is deflected and stops once
 *  it settles. Injectable so tests drive `pump` directly without a real timer. */
export type TickScheduler = {
  start: (tick: () => void) => void;
  stop: () => void;
};

function defaultScheduler(): TickScheduler {
  let handle: ReturnType<typeof setInterval> | null = null;
  return {
    start: (tick) => {
      if (handle === null) handle = setInterval(tick, TICK_MS);
    },
    stop: () => {
      if (handle !== null) {
        clearInterval(handle);
        handle = null;
      }
    },
  };
}

/** The states the tray icon reflects (#199, #498): `off` (desktop mode
 *  disabled), `engaged` (enabled and both the pie and the desktop are reachable,
 *  i.e. always-on, or toggle-with-button while still off), `active` (engaged via
 *  the toggle button, the desktop is the live surface), `suspended` (on but
 *  paused by an open pie). The tray maps `engaged` to the split icon, `active` to
 *  the colourful one; `off`/`suspended` show the normal icon. */
export type DesktopState = 'off' | 'engaged' | 'active' | 'suspended';

/** What caused a state change, so the LED feedback can differ: `config` = a
 *  config/dropdown write (editor or tray checkbox), `button` = the SpaceMouse
 *  toggle button, `pie` = the pie opening/closing (suspend/resume). */
export type DesktopStateCause = 'config' | 'button' | 'pie';

export type DesktopInterpreterDeps = {
  injectScroll: (dx: number, dy: number) => void;
  injectChord: (modifiers: number[], key: number) => void;
  backend: DesktopBackend;
  /** Per-compositor system controls (volume, brightness): KDE injects the media
   *  key, wlroots drives wpctl/brightnessctl. Shared with the pie-menu `desktop`
   *  action. */
  systemControl: SystemControlBackend;
  /** Fire a built-in/plugin action by "pluginId/actionName" key for an
   *  action-bound button. Fire-and-forget and fail-soft (the caller logs). */
  runAction: (id: string, config: Record<string, unknown>) => void;
  /** Acquire / release the desktop grab (the grab-intent arbiter's 'desktop'
   *  owner). Held the whole time desktop mode is on. */
  acquireGrab: () => void;
  releaseGrab: () => void;
  /** Notified whenever the effective state changes (for tray icon + LED), with
   *  what caused it so the LED feedback can differ per cause. */
  onStateChanged?: (state: DesktopState, cause: DesktopStateCause) => void;
  /** Monotonic-ish clock for discrete cooldowns; defaults to Date.now. */
  now?: () => number;
  /** Tick scheduler; defaults to a setInterval loop. */
  scheduler?: TickScheduler;
};

const ZERO_AXES: SixAxes = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };

export class DesktopInterpreter {
  private settings: DesktopSettings;
  private readonly now: () => number;
  private readonly scheduler: TickScheduler;

  private pieOpen = false;
  private toggledOn = false;
  private grabbed = false;
  private lastState: DesktopState = 'off';
  private ticking = false;
  private showDesktopOn = false;
  private axes: SixAxes = ZERO_AXES;

  /** Per-axis fractional output accumulators (continuous functions). */
  private readonly accum = new Map<MenuAxisName, number>();
  /** Per-axis rising-edge + cooldown state (discrete functions). */
  private readonly edges = new Map<MenuAxisName, { armed: boolean; lastFire: number }>();

  constructor(
    private readonly deps: DesktopInterpreterDeps,
    settings: DesktopSettings,
  ) {
    this.settings = settings;
    this.now = deps.now ?? Date.now;
    this.scheduler = deps.scheduler ?? defaultScheduler();
    this.reconcileGrab();
    this.lastState = this.currentState();
  }

  /** The current effective state, for the initial tray icon at startup. */
  getState(): DesktopState {
    return this.currentState();
  }

  /** Whether desktop mode owns a button right now: it's emitting (on, not
   *  suspended) and the button is bound to a desktop function. The pie trigger
   *  handler checks this so a button that doubles as the trigger fires the
   *  desktop function instead of opening the pie while desktop mode is on. */
  consumesButton(bnum: number): boolean {
    if (!this.emitActive()) return false;
    const fn = this.settings.buttons[bnum];
    return fn !== undefined && fn !== 'none';
  }

  /** Replace the live config (an editor write). Re-evaluates grab + tick. */
  setSettings(next: DesktopSettings): void {
    this.settings = next;
    this.reconcileGrab();
    this.maybeArm();
    this.emitState('config');
  }

  /** Mark the pie open or closed. Whether that suspends desktop mode is gated by
   *  the `suspendWhilePieOpen` setting; suspension pauses emission, keeps grab. */
  setPieOpen(open: boolean): void {
    this.pieOpen = open;
    if (this.pieSuspended()) this.stopTick();
    else this.maybeArm();
    this.emitState('pie');
  }

  /** Feed a daemon axes frame. */
  onAxes(values: AxesEvent['values']): void {
    this.axes = {
      tx: values[0],
      ty: values[1],
      tz: values[2],
      rx: values[3],
      ry: values[4],
      rz: values[5],
    };
    if (!this.emitActive()) return;
    this.dispatchDiscreteAxes();
    this.maybeArm();
  }

  /** Feed a daemon button event (rising edge = pressed). */
  onButton(bnum: number, pressed: boolean): void {
    if (!pressed) return;
    // While the pie is open and has priority (suspendWhilePieOpen), the buttons
    // belong to the pie: desktop mode ignores them, including its toggle button.
    if (this.pieSuspended()) return;
    const s = this.settings;
    // The toggle button flips desktop mode and takes precedence over a function
    // bound to the same button.
    if (s.enabled && s.activationMode === 'toggle' && s.toggleButton === bnum) {
      this.toggledOn = !this.toggledOn;
      this.reconcileGrab();
      if (!this.isOn()) this.resetMotion();
      this.maybeArm();
      this.emitState('button');
      return;
    }
    if (!this.emitActive()) return;
    const fn = s.buttons[bnum];
    if (fn === 'overview') {
      void this.deps.backend.toggleOverview();
    } else if (fn === 'showDesktop') {
      this.showDesktopOn = !this.showDesktopOn;
      void this.deps.backend.showDesktop(this.showDesktopOn);
    } else if (typeof fn === 'object' && fn.kind === 'action') {
      this.deps.runAction(fn.ref.id, fn.ref.config ?? {});
    }
  }

  /** Stop the tick and drop the grab. Call on app quit. */
  dispose(): void {
    this.stopTick();
    if (this.grabbed) {
      this.deps.releaseGrab();
      this.grabbed = false;
    }
  }

  /**
   * One continuous-integration step (the tick body). Public so tests drive it
   * without a real timer. Emits scroll/zoom/volume from the cached axes and
   * stops the tick once every continuous axis has settled into its deadzone.
   */
  pump(dtMs: number): void {
    if (!this.emitActive()) {
      this.stopTick();
      return;
    }
    const dtSec = dtMs / 1000;
    let anyActive = false;
    for (const axis of MENU_AXES) {
      const fn = this.settings.axes[axis];
      if (!isContinuous(fn)) continue;
      // Only scroll has a response curve; zoom/volume are linear (exponent 1).
      const curve = fn.kind === 'scroll' ? fn.curve : 1;
      const rate = shapedAxisRate(this.axes[axis], fn.deadzone, fn.speed, curve, fn.invert);
      if (rate === 0) continue;
      anyActive = true;
      const base =
        fn.kind === 'scroll'
          ? SCROLL_HIRES_PER_SEC
          : fn.kind === 'zoom'
            ? ZOOM_STEPS_PER_SEC
            : fn.kind === 'volume'
              ? VOLUME_STEPS_PER_SEC
              : BRIGHTNESS_STEPS_PER_SEC;
      const acc = (this.accum.get(axis) ?? 0) + rate * base * dtSec;
      const steps = Math.trunc(acc);
      this.accum.set(axis, acc - steps);
      if (steps !== 0) this.dispatchContinuous(fn, steps);
    }
    if (!anyActive) this.stopTick();
  }

  // ── internal ───────────────────────────────────────────────────────────

  private isOn(): boolean {
    const s = this.settings;
    return s.enabled && (s.activationMode === 'always' || this.toggledOn);
  }

  /** Suspended only when the pie is open AND the user wants desktop mode to yield
   *  to it (the `suspendWhilePieOpen` toggle). */
  private pieSuspended(): boolean {
    return this.pieOpen && this.settings.suspendWhilePieOpen;
  }

  private emitActive(): boolean {
    return this.isOn() && !this.pieSuspended();
  }

  private currentState(): DesktopState {
    if (!this.settings.enabled) return 'off';
    // An open pie takes precedence and the icon goes neutral, whether or not
    // the desktop is currently engaged (a toggle-with-button armed but off still
    // yields to the pie). Gated only by suspendWhilePieOpen: if the user lets the
    // two coexist, the pie doesn't override the desktop state.
    if (this.pieSuspended()) return 'suspended';
    // Toggle-with-button engaged = the desktop is the live surface.
    if (this.settings.activationMode === 'toggle' && this.toggledOn) return 'active';
    // Always-on, or toggle-with-button while still off: both the pie and the
    // desktop are reachable, which the split icon signals as "both usable".
    return 'engaged';
  }

  /** Fire the state-change callback when the effective state actually changes. */
  private emitState(cause: DesktopStateCause): void {
    const state = this.currentState();
    if (state === this.lastState) return;
    this.lastState = state;
    this.deps.onStateChanged?.(state, cause);
  }

  private reconcileGrab(): void {
    if (this.isOn() && !this.grabbed) {
      this.deps.acquireGrab();
      this.grabbed = true;
    } else if (!this.isOn() && this.grabbed) {
      this.deps.releaseGrab();
      this.grabbed = false;
    }
  }

  /** Clear accumulated motion so a re-activation starts clean. */
  private resetMotion(): void {
    this.accum.clear();
    for (const st of this.edges.values()) st.armed = true;
  }

  private maybeArm(): void {
    if (!this.emitActive()) {
      this.stopTick();
      return;
    }
    if (this.anyContinuousDeflected()) this.startTick();
  }

  private anyContinuousDeflected(): boolean {
    for (const axis of MENU_AXES) {
      const fn = this.settings.axes[axis];
      if (isContinuous(fn) && Math.abs(this.axes[axis]) > fn.deadzone) return true;
    }
    return false;
  }

  private startTick(): void {
    if (this.ticking) return;
    this.ticking = true;
    this.scheduler.start(() => this.pump(TICK_MS));
  }

  private stopTick(): void {
    if (!this.ticking) return;
    this.ticking = false;
    this.scheduler.stop();
  }

  private dispatchContinuous(fn: ContinuousFunction, steps: number): void {
    if (fn.kind === 'scroll') {
      if (fn.orientation === 'horizontal') this.deps.injectScroll(steps, 0);
      else this.deps.injectScroll(0, steps);
      return;
    }
    // Burst guard: cap the taps per tick. Intentionally lossy (the surplus over
    // the cap is dropped, not carried in the accumulator), but unreachable in
    // practice, a normal deflection accrues well under one step per tick.
    const taps = Math.min(Math.abs(steps), MAX_CHORD_TAPS_PER_TICK);
    if (fn.kind === 'zoom') {
      // Zoom-in: Ctrl+Shift+= (the '+' character). Zoom-out: Ctrl+-.
      const mods = steps > 0 ? [KEY_LEFTCTRL, KEY_LEFTSHIFT] : [KEY_LEFTCTRL];
      const key = steps > 0 ? KEY_EQUAL : KEY_MINUS;
      for (let i = 0; i < taps; i += 1) this.deps.injectChord(mods, key);
    } else if (fn.kind === 'volume') {
      // Volume + brightness route through the per-compositor system-control
      // backend (KDE injects the media key, wlroots uses wpctl/brightnessctl), so
      // they work without the compositor binding the media keys. One call carries
      // the signed step count.
      void this.deps.systemControl.adjustVolume(steps > 0 ? taps : -taps);
    } else if (fn.kind === 'brightness') {
      void this.deps.systemControl.adjustBrightness(steps > 0 ? taps : -taps);
    }
  }

  private dispatchDiscreteAxes(): void {
    const now = this.now();
    for (const axis of MENU_AXES) {
      const fn = this.settings.axes[axis];
      if (!isDiscrete(fn)) continue;
      const value = this.axes[axis];
      const mag = Math.abs(value);
      let st = this.edges.get(axis);
      if (!st) {
        st = { armed: true, lastFire: 0 };
        this.edges.set(axis, st);
      }
      if (mag < fn.threshold) {
        st.armed = true; // eased back below threshold, re-arm
        continue;
      }
      if (!st.armed || now - st.lastFire < fn.cooldownMs) continue;
      st.armed = false;
      st.lastFire = now;
      this.fireDiscrete(fn, value < 0 ? -1 : 1);
    }
  }

  private fireDiscrete(fn: DiscreteFunction, dir: number): void {
    if (fn.kind === 'workspace') {
      void this.deps.backend.switchWorkspace(fn.invert ? -dir : dir);
    } else if (fn.kind === 'overview') {
      void this.deps.backend.toggleOverview();
    } else {
      this.showDesktopOn = !this.showDesktopOn;
      void this.deps.backend.showDesktop(this.showDesktopOn);
    }
  }
}

/** Construct a desktop interpreter (#199). */
export function createDesktopInterpreter(
  deps: DesktopInterpreterDeps,
  settings: DesktopSettings,
): DesktopInterpreter {
  return new DesktopInterpreter(deps, settings);
}

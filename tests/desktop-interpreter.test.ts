// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_DESKTOP_SETTINGS } from '../src/shared/desktop-settings';
import type { DesktopSettings } from '../src/shared/ipc';
import {
  createDesktopInterpreter,
  shapedAxisRate,
  type DesktopInterpreterDeps,
} from '../src/main/desktop-interpreter';

// Axis order for the daemon axes frame: [tx, ty, tz, rx, ry, rz].
function frame(part: Partial<Record<'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz', number>>) {
  return [part.tx ?? 0, part.ty ?? 0, part.tz ?? 0, part.rx ?? 0, part.ry ?? 0, part.rz ?? 0] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
}

function makeHarness() {
  const calls = {
    scroll: [] as [number, number][],
    chords: [] as [number[], number][],
    workspace: [] as number[],
    overview: 0,
    showDesktop: [] as boolean[],
    volume: [] as number[],
    brightness: [] as number[],
    mute: 0,
    actions: [] as [string, Record<string, unknown>][],
    grab: 0,
    release: 0,
  };
  let nowVal = 1000;
  const deps: DesktopInterpreterDeps = {
    injectScroll: (dx, dy) => calls.scroll.push([dx, dy]),
    injectChord: (m, k) => calls.chords.push([m, k]),
    systemControl: {
      adjustVolume: async (steps) => void calls.volume.push(steps),
      toggleMute: async () => void (calls.mute += 1),
      adjustBrightness: async (steps) => void calls.brightness.push(steps),
    },
    backend: {
      switchWorkspace: async (d) => void calls.workspace.push(d),
      toggleOverview: async () => void (calls.overview += 1),
      showDesktop: async (a) => void calls.showDesktop.push(a),
    },
    runAction: (id, config) => void calls.actions.push([id, config]),
    acquireGrab: () => void (calls.grab += 1),
    releaseGrab: () => void (calls.release += 1),
    now: () => nowVal,
    scheduler: { start: () => {}, stop: () => {} },
  };
  return { deps, calls, setNow: (n: number) => void (nowVal = n) };
}

function activeSettings(): DesktopSettings {
  const s = structuredClone(DEFAULT_DESKTOP_SETTINGS);
  s.enabled = true;
  s.activationMode = 'always';
  return s;
}

describe('shapedAxisRate', () => {
  it('is zero inside the deadzone', () => {
    expect(shapedAxisRate(40, 50, 1, 1, false)).toBe(0);
    expect(shapedAxisRate(-50, 50, 1, 1, false)).toBe(0);
  });

  it('is signed by deflection and clamps at the reference', () => {
    expect(shapedAxisRate(350, 50, 1, 1, false)).toBeCloseTo(1);
    expect(shapedAxisRate(-350, 50, 1, 1, false)).toBeCloseTo(-1);
    expect(shapedAxisRate(9999, 50, 1, 1, false)).toBeCloseTo(1); // clamped to 1
  });

  it('applies the response curve exponent and speed', () => {
    // Half deflection (norm 0.5) with curve 2 → 0.25, times speed 4 → 1.
    const halfDefl = 50 + 0.5 * (350 - 50);
    expect(shapedAxisRate(halfDefl, 50, 4, 2, false)).toBeCloseTo(1);
  });

  it('flips sign on invert', () => {
    expect(shapedAxisRate(350, 50, 1, 1, true)).toBeCloseTo(-1);
  });
});

describe('continuous dispatch', () => {
  it('scrolls vertically from a deflected scroll axis (rx)', () => {
    const { deps, calls } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings()); // rx defaults to scroll
    interp.onAxes(frame({ rx: 350 }));
    interp.pump(16);
    expect(calls.scroll.length).toBe(1);
    const first = calls.scroll[0]!;
    expect(first[0]).toBe(0); // vertical, no horizontal
    expect(first[1]).toBeGreaterThan(0);
  });

  it('does not emit when the axis is inside the deadzone', () => {
    const { deps, calls } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings());
    interp.onAxes(frame({ rx: 30 })); // below the 50 deadzone
    interp.pump(16);
    expect(calls.scroll.length).toBe(0);
  });

  it('taps Ctrl+Shift+= (zoom in) for a positive zoom axis once enough has accumulated', () => {
    const { deps, calls } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings()); // tz defaults to zoom
    interp.onAxes(frame({ tz: 350 }));
    for (let i = 0; i < 30; i += 1) interp.pump(16);
    expect(calls.chords.length).toBeGreaterThan(0);
    expect(calls.chords[0]).toEqual([[29, 42], 13]); // Ctrl+Shift+= → '+'
  });
});

describe('discrete dispatch', () => {
  it('switches workspace once per threshold crossing, re-arming on ease-back', () => {
    const { deps, calls, setNow } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings()); // rz defaults to workspace
    setNow(1000);
    interp.onAxes(frame({ rz: 300 })); // crosses threshold 200 → fire next (+1)
    expect(calls.workspace).toEqual([1]);
    interp.onAxes(frame({ rz: 300 })); // held → no re-fire
    expect(calls.workspace).toEqual([1]);
    interp.onAxes(frame({ rz: 0 })); // ease back → re-arm
    setNow(1500); // past the 300ms cooldown
    interp.onAxes(frame({ rz: 300 }));
    expect(calls.workspace).toEqual([1, 1]);
  });

  it('honours the cooldown after ease-back', () => {
    const { deps, calls, setNow } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings());
    setNow(1000);
    interp.onAxes(frame({ rz: 300 }));
    interp.onAxes(frame({ rz: 0 }));
    setNow(1100); // only 100ms since the fire, < 300ms cooldown
    interp.onAxes(frame({ rz: 300 }));
    expect(calls.workspace).toEqual([1]); // blocked by cooldown
  });

  it('inverts the workspace direction when configured', () => {
    const { deps, calls, setNow } = makeHarness();
    const s = activeSettings();
    s.axes.rz = { kind: 'workspace', threshold: 200, cooldownMs: 300, invert: true };
    const interp = createDesktopInterpreter(deps, s);
    setNow(1000);
    interp.onAxes(frame({ rz: 300 })); // +deflection, inverted → previous (-1)
    expect(calls.workspace).toEqual([-1]);
  });
});

describe('activation + grab', () => {
  it('acquires the grab when on and releases when turned off', () => {
    const { deps, calls } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings());
    expect(calls.grab).toBe(1);
    const off = structuredClone(DEFAULT_DESKTOP_SETTINGS); // enabled false
    interp.setSettings(off);
    expect(calls.release).toBe(1);
  });

  it('does not emit when disabled', () => {
    const { deps, calls } = makeHarness();
    const interp = createDesktopInterpreter(deps, structuredClone(DEFAULT_DESKTOP_SETTINGS));
    interp.onAxes(frame({ rx: 350 }));
    interp.pump(16);
    expect(calls.scroll.length).toBe(0);
    expect(calls.grab).toBe(0);
  });

  it('toggle mode: a button press flips on/off and the grab follows', () => {
    const { deps, calls } = makeHarness();
    const s = activeSettings();
    s.activationMode = 'toggle';
    s.toggleButton = 3;
    const interp = createDesktopInterpreter(deps, s);
    expect(calls.grab).toBe(0); // toggled off initially
    interp.onButton(3, true); // toggle on
    expect(calls.grab).toBe(1);
    interp.onAxes(frame({ rx: 350 }));
    interp.pump(16);
    expect(calls.scroll.length).toBe(1);
    interp.onButton(3, false); // release is ignored
    interp.onButton(3, true); // toggle off
    expect(calls.release).toBe(1);
  });

  it('suspension pauses emission but keeps the grab', () => {
    const { deps, calls } = makeHarness();
    const interp = createDesktopInterpreter(deps, activeSettings());
    interp.setPieOpen(true);
    interp.onAxes(frame({ rx: 350 }));
    interp.pump(16);
    expect(calls.scroll.length).toBe(0);
    expect(calls.release).toBe(0); // grab kept
    interp.setPieOpen(false);
    interp.onAxes(frame({ rx: 350 }));
    interp.pump(16);
    expect(calls.scroll.length).toBe(1);
  });

  it('keeps emitting while the pie is open when suspend-while-pie-open is off', () => {
    const { deps, calls } = makeHarness();
    const s = activeSettings();
    s.suspendWhilePieOpen = false;
    const interp = createDesktopInterpreter(deps, s);
    interp.setPieOpen(true);
    interp.onAxes(frame({ rx: 350 }));
    interp.pump(16);
    expect(calls.scroll.length).toBe(1); // the toggle is off → not suspended
  });
});

describe('button functions', () => {
  it('fires overview / show-desktop on a bound button press', () => {
    const { deps, calls } = makeHarness();
    const s = activeSettings();
    s.buttons = { 0: 'overview', 1: 'showDesktop' };
    const interp = createDesktopInterpreter(deps, s);
    interp.onButton(0, true);
    expect(calls.overview).toBe(1);
    interp.onButton(1, true);
    expect(calls.showDesktop).toEqual([true]);
    interp.onButton(1, true);
    expect(calls.showDesktop).toEqual([true, false]); // toggles the tracked state
  });

  it('fires an action-bound button via runAction (config passed through)', () => {
    const { deps, calls } = makeHarness();
    const s = activeSettings();
    s.buttons = { 4: { kind: 'action', ref: { id: 'plugin/act', config: { keys: 'alt+Tab' } } } };
    createDesktopInterpreter(deps, s).onButton(4, true);
    expect(calls.actions).toEqual([['plugin/act', { keys: 'alt+Tab' }]]);
  });

  it('passes an empty config object when an action has none', () => {
    const { deps, calls } = makeHarness();
    const s = activeSettings();
    s.buttons = { 4: { kind: 'action', ref: { id: 'plugin/act' } } };
    createDesktopInterpreter(deps, s).onButton(4, true);
    expect(calls.actions).toEqual([['plugin/act', {}]]);
  });

  it('consumesButton only while active and bound to a function', () => {
    const { deps } = makeHarness();
    const s = activeSettings();
    s.buttons = { 2: 'overview' };
    const interp = createDesktopInterpreter(deps, s);
    expect(interp.consumesButton(2)).toBe(true); // active + bound → the trigger handler yields
    expect(interp.consumesButton(0)).toBe(false); // not bound
    interp.setPieOpen(true); // suspended (suspendWhilePieOpen default on)
    expect(interp.consumesButton(2)).toBe(false); // not emitting → the pie keeps the button
  });
});

describe('state changes (tray/LED feedback)', () => {
  it('exposes the initial state via getState', () => {
    const { deps } = makeHarness();
    // Disabled = off; always-on = engaged (both the pie and the desktop reachable).
    expect(
      createDesktopInterpreter(deps, structuredClone(DEFAULT_DESKTOP_SETTINGS)).getState(),
    ).toBe('off');
    expect(createDesktopInterpreter(deps, activeSettings()).getState()).toBe('engaged');
  });

  it('maps the activation modes to the tray states', () => {
    const { deps } = makeHarness();
    // Always-on is always "engaged" (split icon: both surfaces usable).
    expect(createDesktopInterpreter(deps, activeSettings()).getState()).toBe('engaged');
    // Toggle-with-button: engaged while off, active once toggled on.
    const toggle = activeSettings();
    toggle.activationMode = 'toggle';
    toggle.toggleButton = 3;
    const interp = createDesktopInterpreter(deps, toggle);
    expect(interp.getState()).toBe('engaged'); // toggled off → both usable
    interp.onButton(3, true);
    expect(interp.getState()).toBe('active'); // toggled on → desktop is live
    interp.onButton(3, true);
    expect(interp.getState()).toBe('engaged'); // toggled back off
  });

  it('fires off→engaged on enable and engaged→off on disable', () => {
    const states: string[] = [];
    const { deps } = makeHarness();
    deps.onStateChanged = (s) => states.push(s);
    const interp = createDesktopInterpreter(deps, structuredClone(DEFAULT_DESKTOP_SETTINGS));
    interp.setSettings(activeSettings());
    expect(states).toEqual(['engaged']);
    interp.setSettings(structuredClone(DEFAULT_DESKTOP_SETTINGS));
    expect(states).toEqual(['engaged', 'off']);
  });

  it('fires engaged↔suspended on pie open/close', () => {
    const states: string[] = [];
    const { deps } = makeHarness();
    deps.onStateChanged = (s) => states.push(s);
    const interp = createDesktopInterpreter(deps, activeSettings());
    interp.setPieOpen(true);
    interp.setPieOpen(false);
    expect(states).toEqual(['suspended', 'engaged']);
  });

  it('shows the neutral icon while the pie is open even when not engaged', () => {
    // Toggle-with-button armed but off: still "engaged" (both usable) until the
    // pie opens, which takes precedence and goes neutral (the pie is the live
    // surface), then back. Regression for the pie showing the split icon.
    const { deps } = makeHarness();
    const s = activeSettings();
    s.activationMode = 'toggle';
    s.toggleButton = 3;
    const interp = createDesktopInterpreter(deps, s);
    expect(interp.getState()).toBe('engaged'); // armed, both usable
    interp.setPieOpen(true);
    expect(interp.getState()).toBe('suspended'); // pie open → neutral
    interp.setPieOpen(false);
    expect(interp.getState()).toBe('engaged');
  });

  it('does not fire when the effective state is unchanged', () => {
    const states: string[] = [];
    const { deps } = makeHarness();
    deps.onStateChanged = (s) => states.push(s);
    const interp = createDesktopInterpreter(deps, activeSettings());
    interp.onAxes(frame({ rx: 350 })); // emits scroll, but always-on stays 'engaged'
    interp.pump(16);
    expect(states).toEqual([]);
  });

  it('ignores the SpaceMouse buttons while suspended (the pie has priority)', () => {
    const states: string[] = [];
    const { deps, calls } = makeHarness();
    deps.onStateChanged = (s) => states.push(s);
    const s = activeSettings();
    s.activationMode = 'toggle';
    s.toggleButton = 3;
    const interp = createDesktopInterpreter(deps, s); // toggle mode, off until pressed
    interp.onButton(3, true); // engage → active
    interp.setPieOpen(true); // pie open with priority → suspended
    expect(states).toEqual(['active', 'suspended']);
    interp.onButton(3, true); // toggle button suppressed while suspended
    interp.onButton(0, true); // a function button (overview) also suppressed
    expect(states).toEqual(['active', 'suspended']);
    expect(calls.overview).toBe(0);
  });
});

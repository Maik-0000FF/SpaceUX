// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The editor's live preview, resolved CORE-side (#177 / #457 D5): the core
 * already owns the daemon's axes/button stream, the active config and the
 * shared puck resolver, so instead of forwarding raw 60Hz frames over the bus
 * it runs the navigation here and pushes only outcome deltas (`LiveNav`).
 *
 * Sandbox semantics: the full
 * configured navigation works (aim, drill, cycle, twist, back), but the
 * terminal outcomes that would close a pie or fire an action (`activate`,
 * `commitCenter`, back-`dismiss`) are suppressed; a back-pop lands the
 * highlight on the sector it came from (#185); the rising edges arm on enable
 * so a still-deflected puck can't fire on the first frame; and a real
 * movement hands a manual click selection back to the puck (#447) via the
 * pushed `movement` flag.
 */

import {
  currentBranches,
  isMovementOutcome,
  resolvePuckFrame,
  type PuckEdges,
} from '../core/menu-nav.js';
import type { SixAxes } from '../core/pie-geometry.js';
import { DEFAULT_TRIGGER_BUTTON } from '../shared/menu.js';
import type { AxesEvent } from '../shared/protocol.js';

import type { EmitSignal } from './core-service-builder.js';
import type { CoreState } from './core-state.js';

export type LivePreview = {
  /** The editor's live state; `focused` gates the preview's own trigger
   *  branch-drill. The real pie's trigger deliberately stays live alongside,
   *  so the pie remains openable during a focused live session. Enabling
   *  (re)arms the edges and clears the highlight. */
  setLive: (on: boolean, focused: boolean) => void;
  /** The editor's click-driven view path while live. */
  setView: (navigation: number[]) => void;
  onAxes: (values: AxesEvent['values']) => void;
  onButton: (bnum: number, pressed: boolean) => void;
};

/** Rising-edge memory armed to "already over":
 *  each gesture must dip under its threshold once before it can fire. */
function armedEdges(): PuckEdges {
  return { activate: true, exit: true, commit: true, back: true, drill: true, cycle: true };
}

export function createLivePreview(state: CoreState, emit: EmitSignal): LivePreview {
  let on = false;
  let focused = false;
  let navigation: number[] = [];
  let sticky: number | null = null;
  let edges: PuckEdges = armedEdges();
  const buttons: boolean[] = [];
  // One movement announcement per click: a manual selection is cleared on the
  // next real movement, then stays the puck's until the editor reports the
  // next click (setView / setLive re-arm it).
  let announceMovement = false;

  function push(movement: boolean): void {
    emit('LiveNav', { navigation: [...navigation], sticky, movement });
  }

  function applyFrame(values: AxesEvent['values']): void {
    const cfg = state.menuConfig;
    if (!on || !cfg) return;
    const [tx, ty, tz, rx, ry, rz] = values;
    const axes: SixAxes = { tx, ty, tz, rx, ry, rz };
    const result = resolvePuckFrame({
      menuConfig: cfg,
      axes,
      buttons,
      navigation,
      sticky,
      edges,
    });
    edges = result.edges;
    const outcome = result.outcome;
    const movement = isMovementOutcome(outcome.kind);
    const prevNav = navigation.join(',');
    const prevSticky = sticky;
    switch (outcome.kind) {
      case 'hover':
        sticky = outcome.index;
        break;
      case 'drill':
        navigation = [...navigation, outcome.index];
        sticky = null;
        break;
      case 'back':
        // 'dismiss' (from the centre) is suppressed: the sandbox never
        // closes. A pop lands the highlight on the sector it came from, so
        // the now-active ring shows it as the breadcrumb (#185).
        if (outcome.mode === 'pop' && navigation.length > 0) {
          sticky = navigation[navigation.length - 1] ?? null;
          navigation = navigation.slice(0, -1);
        }
        break;
      case 'exitToCenter':
        sticky = null;
        break;
      // Terminal commits stay suppressed; 'none' does nothing.
      case 'activate':
      case 'commitCenter':
      case 'none':
        break;
    }
    const changed = navigation.join(',') !== prevNav || sticky !== prevSticky;
    if (changed || (movement && announceMovement)) {
      if (movement) announceMovement = false;
      push(movement);
    }
  }

  return {
    setLive: (nextOn, nextFocused) => {
      const enabling = nextOn && !on;
      on = nextOn;
      focused = nextFocused;
      if (enabling) {
        // (Re)arm + clear, like the hook's enable effect.
        edges = armedEdges();
        sticky = null;
        announceMovement = true;
        push(false);
      }
      if (!nextOn) {
        sticky = null;
        buttons.length = 0;
      }
    },
    setView: (nav) => {
      navigation = [...nav];
      sticky = null;
      announceMovement = true;
    },
    onAxes: (values) => applyFrame(values),
    onButton: (bnum, pressed) => {
      if (!on) return;
      if (buttons[bnum] === pressed) return; // ignore no-op repeats
      buttons[bnum] = pressed;
      if (!pressed) return;
      const cfg = state.menuConfig;
      if (!cfg) return;
      // Trigger press while driving the preview: only the branch-drill half
      // of the overlay's commit — a leaf or the centre stays a no-op, the
      // sandbox never fires or closes.
      if (bnum !== (cfg.triggerButton ?? DEFAULT_TRIGGER_BUTTON)) return;
      if (!focused) return;
      if (sticky === null) return;
      const ring = currentBranches(cfg, navigation);
      if (ring.length === 0) return;
      const idx = sticky % ring.length; // 1-child ring guard (matches the overlay)
      if (ring[idx]?.branches) {
        navigation = [...navigation, idx];
        sticky = null;
        push(false);
      }
    },
  };
}

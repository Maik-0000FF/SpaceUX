// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

import { currentBranches, resolvePuckFrame, type PuckEdges } from '@/core/menu-nav';
import type { SixAxes } from '@/core/pie-geometry';
import { DEFAULT_TRIGGER_BUTTON, type MenuConfig } from '@/shared/menu';

import { useAppState } from '../state/app-state';

// Rising-edge memory armed to "already over" so a still-deflected puck at
// enable time can't fire a gesture on the first frame — the user has to dip
// each gesture back under its threshold and re-engage. Mirrors
// useDrillNavigation's resetTransientRefs.
const ARMED_EDGES: PuckEdges = {
  activate: true,
  exit: true,
  commit: true,
  back: true,
  drill: true,
  cycle: true,
};

/**
 * Drives the editor preview with the *full* live navigation while live
 * preview is on (#177): the same pure resolver the overlay uses
 * (`resolvePuckFrame`) decides each puck frame, and its outcome is applied to
 * the editor's own `viewPath` navigation plus a transient highlight.
 *
 * The author feels the complete configured navigation style — drill in/out,
 * sector cycling, twist-drill, back-to-parent, aim mode + deadzone — but the
 * preview is a non-destructive sandbox: the terminal outcomes that would close
 * the pie or fire an action (`activate`, `commitCenter`, back-`dismiss`) are
 * suppressed. Drilling into submenus works (so exploration is possible);
 * committing a leaf, the centre, or dismissing from the centre is a no-op.
 *
 * Returns the highlighted child index (the live "sticky"), or null when the
 * centre is the focus / the puck is in the deadzone. Off (or no config) it
 * returns null and does nothing.
 */
export function useLivePreviewNavigation(
  enabled: boolean,
  config: MenuConfig | null,
): number | null {
  const drillInto = useAppState((s) => s.drillInto);
  const drillTo = useAppState((s) => s.drillTo);

  const [axes, setAxes] = useState<SixAxes | null>(null);
  const [buttons, setButtons] = useState<readonly boolean[]>([]);
  const [sticky, setSticky] = useState<number | null>(null);

  // Refs the long-lived button listener / frame effect read without
  // re-subscribing every frame.
  const stickyRef = useRef<number | null>(null);
  stickyRef.current = sticky;
  const configRef = useRef<MenuConfig | null>(config);
  configRef.current = config;
  const edgesRef = useRef<PuckEdges>({ ...ARMED_EDGES });

  // Subscribe to axes + buttons only while enabled, and report live state to
  // main (suppresses the real overlay). Arming the edges + clearing the
  // highlight on (re)enable keeps a still-deflected puck from firing a gesture
  // on the first frame.
  useEffect(() => {
    window.editor.setLive(enabled);
    if (!enabled) {
      setAxes(null);
      setButtons([]);
      setSticky(null);
      edgesRef.current = { ...ARMED_EDGES };
      return () => window.editor.setLive(false);
    }
    edgesRef.current = { ...ARMED_EDGES };
    setSticky(null);
    const offAxes = window.editor.onAxes((v) =>
      setAxes({ tx: v[0], ty: v[1], tz: v[2], rx: v[3], ry: v[4], rz: v[5] }),
    );
    const offButton = window.editor.onButton(({ bnum, pressed }) => {
      setButtons((prev) => {
        if (prev[bnum] === pressed) return prev; // ignore no-op repeats
        const next = prev.slice();
        next[bnum] = pressed;
        return next;
      });
      // Trigger-button commit, mirroring the overlay's MENU_COMMIT — but only
      // the branch-drill half: a branch drills in (exploration); a leaf or the
      // centre is suppressed (no action, no close), keeping the sandbox open.
      if (!pressed) return;
      const cfg = configRef.current;
      if (!cfg) return;
      if (bnum !== (cfg.triggerButton ?? DEFAULT_TRIGGER_BUTTON)) return;
      const sec = stickyRef.current;
      if (sec === null) return; // centre → suppressed
      const ring = currentBranches(cfg, useAppState.getState().viewPath);
      if (ring.length === 0) return;
      const idx = sec % ring.length; // 1-child ring guard (matches the overlay)
      if (ring[idx]?.branches) {
        drillInto(idx);
        setSticky(null);
      }
      // leaf → suppressed
    });
    return () => {
      window.editor.setLive(false);
      offAxes();
      offButton();
    };
  }, [enabled, drillInto]);

  // Per-frame navigation: feed the live state to the pure resolver and apply
  // the outcome to the editor's viewPath + highlight. viewPath is read fresh
  // (getState) so a drill this frame is picked up on the next.
  useEffect(() => {
    if (!enabled || !config || !axes) return;
    const navigation = useAppState.getState().viewPath;
    const { outcome, edges } = resolvePuckFrame({
      menuConfig: config,
      axes,
      buttons,
      navigation,
      sticky: stickyRef.current,
      edges: edgesRef.current,
    });
    edgesRef.current = edges;
    switch (outcome.kind) {
      case 'hover':
        setSticky(outcome.index);
        break;
      case 'drill':
        // Land at the child ring's centre (no highlight), like the overlay —
        // aim or twist onto an item from there.
        drillInto(outcome.index);
        setSticky(null);
        break;
      case 'back':
        // Pop a level toward the centre. 'dismiss' (from the centre) is
        // suppressed: the sandbox never closes. Mirror the overlay's
        // `drillReducer` pop action (src/core/menu-nav.ts): after the pop,
        // sticky lands on the index we just came from, so the now-active
        // ring shows that sector as a breadcrumb. Without this the editor
        // preview dropped the highlight on every back step (#185) and one
        // level on a deep back-out felt skipped.
        if (outcome.mode === 'pop') {
          const poppedIndex = navigation[navigation.length - 1] ?? null;
          drillTo(navigation.length - 1);
          setSticky(poppedIndex);
        }
        break;
      case 'exitToCenter':
        // Soft back to the centre: deselect, stay open.
        setSticky(null);
        break;
      // Terminal commits are suppressed in the editor; 'none' does nothing.
      case 'activate':
      case 'commitCenter':
      case 'none':
        break;
    }
  }, [enabled, config, axes, buttons, drillInto, drillTo]);

  return enabled ? sticky : null;
}

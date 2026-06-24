// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire types of the navigation/input UI model (#457 C3): what the core's
 * `InspectNavInput` returns and what `EditNavInput` takes. Declared in shared
 * (the dependency leaf) so the core contract can reference them without a
 * shared -> core inversion; the builder/transform logic lives in
 * `core/nav-model.ts`.
 */

import type { AimSource, TriggerMode, TwistCyclePriority } from './menu.js';

/**
 * THE unified conflict marking (one shape for every detector: navigation
 * gesture rivalry, physical-button double-booking, and the desktop-mode
 * bindings when that tab lands): `soft` = works but worth knowing (amber),
 * `hard` = breaks something outright (red). The message is the hover text,
 * already worded for the user.
 */
export type UiConflict = { severity: 'soft' | 'hard'; message: string };

/** One dropdown option. `group` renders as a non-selectable header above its
 *  run; `disabled` shows the option but refuses the pick (a stale/unfit saved
 *  value); `conflict` puts the unified marker on the option row. */
export type NavOption = {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
  conflict?: UiConflict | null;
};

/** One input-binding row: the encoded current value, its threshold (null for
 *  button/none), the full option list for its dropdown, and the row's own
 *  conflict marker. */
export type NavInputRowModel = {
  value: string;
  threshold: number | null;
  options: NavOption[];
  conflict: UiConflict | null;
};

/** One gesture's binding list plus the pre-worded notes/warnings that belong
 *  under it (conflict lines, the shadow note, the reachability hint). */
export type GestureListModel = {
  rows: NavInputRowModel[];
  warnings: string[];
};

export type NavUiModel = {
  /** Buttons the pickers offer (the device count, or the fallback). */
  buttonsOffered: number;
  menuSettings: {
    trigger: {
      value: number;
      options: NavOption[];
      /** Set when the saved trigger exceeds the connected device's buttons. */
      rangeError: string | null;
      /** Set when the current trigger is double-booked ("Also used by ..."). */
      conflictNote: string | null;
    };
    mode: {
      value: TriggerMode;
      options: { value: string; label: string }[];
      /** The explainer for the CURRENT mode. */
      note: string;
    };
  };
  /** Navigation-style quick-pick (#160): built-ins (+ "Custom" while nothing
   *  matches) and the current selection's description. `customOption` is the
   *  prebuilt "Custom" entry the editor shows while the style is sticky-custom
   *  (a session decision, so the editor composes it; the copy stays here).
   *  Plugin presets join in the plugin slice. */
  style: {
    value: string;
    options: { value: string; label: string; description: string; disabled?: boolean }[];
    description: string;
    customOption: { value: string; label: string; description: string; disabled: boolean };
  };
  aim: { value: AimSource; options: { value: string; label: string }[] };
  deadzone: {
    hover: number;
    open: number;
    min: number;
    max: number;
    step: number;
    /** Inert for twist aiming (no lateral pointer). */
    disabled: boolean;
    /** The two-thresholds explainer, or null when hidden (twist aiming). */
    note: string | null;
  };
  /** The twist-aiming soft-lock warning (#160), or null. */
  twistWarning: string | null;
  /** The ring gestures, in display order. */
  gestures: {
    key: 'drillIn' | 'activate' | 'back' | 'cycle';
    label: string;
    /** Optional intro note (the drill-in "optional with aiming" hint). */
    note: string | null;
    list: GestureListModel;
    /** Cycle only: the when-also-aiming priority dropdown. */
    priority: { value: TwistCyclePriority; options: { value: string; label: string }[] } | null;
  }[];
  /** Per-item gesture lists for the selected ring node, or null (nothing
   *  selected / the centre). */
  node: { activation: GestureListModel; exit: GestureListModel } | null;
  /** The centre's commit-gesture list when the centre is selected, else null. */
  centre: { commit: GestureListModel } | null;
};

/** Where an input-binding edit lands: a global navigation gesture (the centre's
 *  commit included), or a node's per-item activation/exit binding. */
export type NavEditTarget =
  | { scope: 'nav'; gesture: 'drillIn' | 'activate' | 'back' | 'cycle' | 'commitCenter' }
  | { scope: 'node'; path: number[]; binding: 'activation' | 'exit' };

/** One navigation/input edit (the `EditNavInput` arg). The editor sends the
 *  op; the decode (encoded dropdown value -> InputBinding, carrying a
 *  threshold across a kind change) and every structural rule live in the
 *  core transform. */
export type NavEditOp =
  | { kind: 'setAim'; aim: AimSource }
  | { kind: 'setDeadzone'; hover: number; open: number }
  | { kind: 'setCyclePriority'; priority: TwistCyclePriority }
  | { kind: 'setTriggerButton'; button: number }
  | { kind: 'setTriggerMode'; mode: TriggerMode }
  | { kind: 'applyPreset'; presetId: string }
  | { kind: 'setInput'; target: NavEditTarget; index: number; value: string }
  | { kind: 'setThreshold'; target: NavEditTarget; index: number; threshold: number }
  | { kind: 'addInput'; target: NavEditTarget }
  | { kind: 'removeInput'; target: NavEditTarget; index: number };

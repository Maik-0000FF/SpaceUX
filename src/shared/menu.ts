// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Menu config schema + factory defaults shared between Electron main
 * and renderer.
 *
 * The on-disk config (Phase 2: ~/.config/spaceux/menu.json) follows
 * the :type:`MenuConfig` shape exactly. The loader validates incoming
 * JSON against this shape; the renderer receives the validated config
 * over IPC and renders the pie from it.
 *
 * Bumping :data:`MENU_CONFIG_VERSION` is a breaking change — the
 * loader's migrator must learn to convert the previous version. Adding
 * an optional field is *not* a breaking change.
 */

/** Bumped on every backwards-incompatible schema change. Adding an
 *  optional field is *not* a breaking change — the `navigation` block
 *  (issue #105) is additive and stays at v1. The bump + a legacy→
 *  navigation migrator land in the later PR that removes the legacy
 *  gesture fields and switches the runtime over (that is the breaking
 *  change). */

import { isRenderableIcon } from './icon.js';

export const MENU_CONFIG_VERSION = 1;

/** Hard cap on how deeply menus can nest. Each level inside a node's
 *  `branches` array counts as +1; the top-level pie (root.branches) is
 *  depth 0. The validator refuses configs that go past this and
 *  surfaces a clear reason rather than crashing the loader with a
 *  recursion-stack overflow on pathological inputs.
 *
 *  16 is chosen as well beyond any plausible user-authored menu
 *  shape (real-world radial menus rarely exceed 3–4 deep) while still
 *  catching obvious authoring mistakes — e.g. a hand-edited config
 *  that accidentally self-references a fragment via copy/paste. */
export const MAX_MENU_DEPTH = 16;

/** Bounds for the pie size multiplier (MenuConfig.scale). */
export const MIN_PIE_SCALE = 0.5;
export const MAX_PIE_SCALE = 2;

/** Bounds + default for the lateral aiming deadzone (navigation.deadzone),
 *  in the same raw axis units the daemon broadcasts. A puck deflection
 *  below this magnitude selects no sector — the dead spot around centre.
 *  Default 50 matches the historical fixed value (DEFAULT_PIE_GEOMETRY). */
export const MIN_LATERAL_DEADZONE = 0;
export const MAX_LATERAL_DEADZONE = 500;
export const DEFAULT_LATERAL_DEADZONE = 50;

/** Default *hover* (maintain) threshold — the lower end of the aim
 *  hysteresis (#160). Once a sector is held, the deflection only needs to
 *  stay above this (instead of the higher `deadzone` engage threshold) to
 *  keep aiming, so moving between items is lighter than entering a ring.
 *  Always clamped to ≤ the engage `deadzone`. */
export const DEFAULT_HOVER_DEADZONE = 25;

/** Reverse-DNS-style namespace under which built-in actions live in
 *  the action registry. Identical in shape to a 3rd-party plugin id
 *  so the dispatch path (invokeAction("<plugin>/<action>", config))
 *  is the same for both. */
export const BUILTIN_PLUGIN_ID = 'org.spaceux.builtins';

/** Action identifiers shipped with the app. Composed with
 *  :data:`BUILTIN_PLUGIN_ID` to form the registry key used by
 *  invokeAction. Centralised here so a typo in the default config
 *  is a compile error, not a runtime "unknown action". */
export const BUILTIN_ACTION = {
  KEY_COMBO: 'key-combo',
  EXEC: 'exec',
  /** Dismiss the menu without doing anything else. A no-op at
   *  dispatch time (the renderer already hides the menu on commit);
   *  exists as a named, assignable action so the user can place an
   *  explicit Cancel on a node, including the root/centre — with its own
   *  label/icon — rather than relying on the implicit "leave the puck
   *  centered" gesture. */
  CANCEL: 'cancel',
} as const;

/** Zero-based button index that opens the pie menu when no user
 *  config overrides it. SpaceNavigator's primary button is bnum 0;
 *  pucks with more buttons inherit the same default so a fresh
 *  install always has *something* to react to. */
export const DEFAULT_TRIGGER_BUTTON = 0;

/** What the trigger button does once the pie is open.
 *  - `toggle`: a second press commits the highlighted selection (centred
 *    = the centre's action / dismiss) — the historical click-to-toggle.
 *  - `open`: the button only opens the pie; committing and closing are
 *    left entirely to the SpaceMouse gestures, freeing the button to be
 *    bound like any other input. */
export const TRIGGER_MODES = ['toggle', 'open'] as const;
export type TriggerMode = (typeof TRIGGER_MODES)[number];
export const DEFAULT_TRIGGER_MODE: TriggerMode = 'toggle';

// ── Schema types ────────────────────────────────────────────────────

/** Reference to an action, including the per-instance config the
 *  action handler will receive. */
export type ActionRef = {
  /** Composite "pluginId/actionName" key. Built-in actions use
   *  :data:`BUILTIN_PLUGIN_ID`; plugins use whatever they declare in
   *  their manifest. */
  id: string;
  /** Optional per-instance config. Shape depends on the action; the
   *  menu loader doesn't validate it because each action owns its
   *  own schema (see PluginManifest.actions.config). */
  config?: Record<string, unknown>;
};

/** One node in the menu tree. A node is either a *leaf* (no branches,
 *  optional action fires on commit) or a *submenu* (carries a non-empty
 *  `branches` array which becomes the next-level ring when the user
 *  commits on this node). For non-root nodes the two are mutually
 *  exclusive — the validator rejects nodes that declare both `action`
 *  and `branches` so the renderer doesn't have to guess which one wins
 *  on commit. The single exception is the config's `root` node, which
 *  may carry both (its `branches` are the top-level ring and its
 *  optional `action` is the centre's commit target). */
export type MenuNode = {
  /** Short display string for the node. The renderer puts this inside
   *  the wedge — keep it 1–2 words so the label fits. On the root this
   *  is the centre label and may be empty/absent (renderer falls back
   *  to the ✕ glyph).
   *
   *  Any non-empty Unicode string is accepted: ASCII, Latin-1
   *  accented characters, CJK, RTL scripts, and Emojis (including
   *  Variation-Selector-modified glyphs and ZWJ composites) all
   *  pass the validator and render through the same SVG `<text>`
   *  element. Visual width depends on the sector count + radius;
   *  at the default 8-sector / 240 px geometry, ~10 characters
   *  is a safe upper bound before glyphs overflow the wedge.
   *  Composite Emojis depend on the system Emoji font — on Linux
   *  that's typically Noto Color Emoji. */
  label: string;
  /** Optional icon name resolved by the renderer's theme. v0
   *  ignores this — labels are enough to demo the dispatch path. */
  icon?: string;
  /** Action invoked when this node wins on MENU_COMMIT. Omitted
   *  actions render a label but commit silently — useful for
   *  visual-only nodes or as the placeholder state on a node
   *  being authored. Mutually exclusive with `branches` on non-root
   *  nodes; on the root, the optional centre-commit action that may
   *  coexist with the top-level `branches`. */
  action?: ActionRef;
  /** Nested nodes that become the next-level ring when the user
   *  commits on this node. The schema is recursive: a branch can
   *  itself carry further branches for arbitrary depth. Mutually
   *  exclusive with `action` on non-root nodes; on the root these are
   *  the always-present top-level ring. */
  branches?: MenuNode[];
  /** Leaf-with-action only: keep the menu open after this node's
   *  action fires instead of dismissing. Lets a continuous action (e.g.
   *  nudging volume via twist) be re-committed without reopening the
   *  pie. The validator drops it on a submenu (committing a submenu
   *  drills in, never dismisses) and on an action-less label-only leaf
   *  (which commits to nothing). Omitted/false → historical
   *  close-on-commit. */
  keepOpen?: boolean;
  /** Leaf-with-action only: a per-item *activation* input that fires
   *  this node's `action` while it is the hovered selection — e.g.
   *  bind TZ− so pushing the puck down on this item runs its action,
   *  on top of the global trigger/commit. Resolved relative to the
   *  hovered item and checked ahead of the global gestures, so a
   *  per-item activation wins over a colliding global gesture (e.g.
   *  back) for this item (#130 R2). The validator drops it on a submenu
   *  or an action-less leaf. */
  activation?: GestureBinding;
  /** A per-item *exit* input that returns focus to the centre (deselect,
   *  pie stays open) while this node is hovered — the per-item way back
   *  alongside the global back, e.g. when an `activation` has shadowed the
   *  global back's input on this item. Applies to any node (leaf or
   *  submenu); checked ahead of the global gestures so it wins on a shared
   *  input. The validator drops it when it binds no inputs (#130 R3). */
  exit?: GestureBinding;
  /** Editor-only stable identity. Assigned by the editor when a config
   *  is adopted (and to newly-added nodes); used for React keys and
   *  the tree's expand state. Because it lives on the object, immer
   *  copies it across edits/reorders, so identity survives where an
   *  object-identity WeakMap would not. **Never persisted** — the
   *  validator reconstructs nodes from the structural fields and
   *  drops it, so it never reaches `menu.json`. */
  id?: string;
};

/** Per-axis sign overrides for the pie geometry. The default
 *  geometry assumes "push the puck forward = select the top sector"
 *  but every SpaceMouse model wires its TX/TY signs slightly
 *  differently and KDE Plasma's tilt sense varies too — these
 *  toggles let the user flip whichever feels wrong without a code
 *  change. */
export type MenuAxisInvert = {
  x?: boolean;
  y?: boolean;
};

/** Which gesture wins when the puck is both twisted (cycling) and
 *  pushed laterally (aiming) in the same frame. `lateral` keeps aiming
 *  authoritative — twist only steps while the puck is laterally
 *  centred; `twist` lets a cycle step override the lateral hover for
 *  that frame. Carried on :type:`CycleBinding`. */
export const TWIST_CYCLE_PRIORITIES = ['lateral', 'twist'] as const;
export type TwistCyclePriority = (typeof TWIST_CYCLE_PRIORITIES)[number];

/** Threshold the editor seeds a fresh twist-cycle gesture with. Sits
 *  above the lateral deadzone (50) yet below the typical drill range
 *  (~200) so a threshold split (gentle twist steps, firmer twist
 *  drills) works out of the box. */
export const DEFAULT_TWIST_CYCLE_THRESHOLD = 100;

// ── Navigation input bindings (issue #105) ──────────────────────────
//
// A unified way to bind a navigation *gesture* (drill in, back/pop,
// cycle, commit-center) to an *input* — a device button, a split axis,
// or a 2D magnitude — configurable globally and (later) per node.
// This is the runtime driver: the renderer hook resolves gestures from
// `navigation` (see resolveNavigation + the pie-geometry resolver). It
// replaced the scattered legacy fields (tzDeadzone, the *Drill knobs,
// twistCycle, centerField.activation) in #109 — removed in place at v1
// (no migration, pre-release) rather than via a version bump.

/** A single thing that can fire a gesture. Tagged union so one editor
 *  dropdown can offer every input kind, and one resolver can test them
 *  uniformly. */
export const INPUT_KINDS = ['button', 'axis', 'magnitude', 'none'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** 2D magnitude sources — the omnidirectional gestures that aren't a
 *  single-axis split. `lateral` = hypot(tx, ty) (today's
 *  magnitudeDrill), `tilt` = hypot(rx, ry) (today's tiltDrill). */
export const MAGNITUDE_SOURCES = ['lateral', 'tilt'] as const;
export type MagnitudeSource = (typeof MAGNITUDE_SOURCES)[number];

/** Where aiming (which sector the puck hovers) reads from — the source
 *  that steers the selection. `push` = TX/TY lateral push (the historical,
 *  previously hardwired behaviour); `tilt` = RX/RY tilt; `both` sums the
 *  two so push and tilt aim equally and in parallel — neither dominates.
 *  `twist` turns lateral pointing off entirely and steps the selection by
 *  RZ twist alone, via the `cycle` gesture (so that gesture must be bound
 *  to an axis for twist-only to navigate). Issue #159. */
export const AIM_SOURCES = ['push', 'tilt', 'both', 'twist'] as const;
export type AimSource = (typeof AIM_SOURCES)[number];

/** Press of a device button (zero-based index; valid range depends on
 *  the connected device's button count). */
export type ButtonInput = { kind: 'button'; button: number };
/** A single axis past a threshold on one side (`positive`/`negative`)
 *  or either (`both`). Generalises the old `AxisActivation`. For the
 *  *cycle* gesture a `both`-direction axis steps by the deflection's
 *  sign. */
export type AxisInput = {
  kind: 'axis';
  axis: MenuAxisName;
  direction: ActivationDirection;
  threshold: number;
};
/** A 2D push/tilt magnitude past a threshold (direction-agnostic). */
export type MagnitudeInput = { kind: 'magnitude'; source: MagnitudeSource; threshold: number };
/** Explicitly unbound. */
export type NoInput = { kind: 'none' };

export type InputBinding = ButtonInput | AxisInput | MagnitudeInput | NoInput;

/** One gesture's binding: a *list* of inputs — ANY of them fires it.
 *  A list (not a single input) because today several drills can be
 *  enabled at once; the common case is a one-element list. */
export type GestureBinding = {
  inputs: InputBinding[];
};

/** The cycle gesture additionally needs the lateral-vs-twist priority
 *  (carried over from `MenuTwistCycle`). Its inputs are interpreted
 *  directionally — a `both` axis steps next/prev by the sign. */
export type CycleBinding = GestureBinding & {
  priority: TwistCyclePriority;
};

/** Global navigation-gesture bindings. Each gesture maps to the inputs
 *  that trigger it. (Commit/open via the trigger button stays on
 *  `MenuConfig.triggerButton` for now — folded in by a later PR.) */
export type MenuNavigation = {
  /** Which 2D source steers lateral aiming (the hovered sector). Defaults
   *  to `push` (TX/TY) — the historical hardwired behaviour. See
   *  :type:`AimSource`. Issue #159. */
  aim: AimSource;
  /** Lateral aiming deadzone — the *engage* threshold: from the centre, the
   *  puck must deflect past this before any sector is selected (the hurdle
   *  to leave the centre / enter a ring). Once a sector is held the runtime
   *  applies a lower *hover* threshold (radial hysteresis), so moving between
   *  items is lighter than entering. Clamped to [:data:`MIN_LATERAL_DEADZONE`,
   *  :data:`MAX_LATERAL_DEADZONE`]; defaults to :data:`DEFAULT_LATERAL_DEADZONE`.
   *  Only affects the 2D aim sources; `aim: 'twist'` has no lateral pointer so
   *  it's inert there. Issue #160. */
  deadzone: number;
  /** Hover (maintain) threshold — the lower end of the aim hysteresis. Once
   *  a sector is held, deflection only needs to exceed this (not the higher
   *  `deadzone`) to keep aiming, so moving between items is lighter than
   *  entering. Clamped to ≤ `deadzone`; defaults to
   *  :data:`DEFAULT_HOVER_DEADZONE`. Inert for `aim: 'twist'`. Issue #160. */
  hoverDeadzone: number;
  /** Drill into a hovered branch. Legacy: magnitudeDrill + tiltDrill + twistDrill. */
  drillIn: GestureBinding;
  /** Pop one level (drilled) or dismiss (top level). Legacy: TZ-back via tzDeadzone. */
  back: GestureBinding;
  /** Step the highlighted selection within a ring. Legacy: twistCycle. */
  cycle: CycleBinding;
  /** Commit the center field (fire its binding, or dismiss when it has
   *  none). Legacy: centerField.activation. */
  commitCenter: GestureBinding;
  /** Fire the hovered leaf's action (#160) — the menu-level counterpart
   *  to a node's own per-item `activation`, so a navigation style can bind
   *  one input (e.g. a button) to activate every leaf instead of each item
   *  carrying its own. Only fires on a hovered leaf that has an action; a
   *  per-item `activation` on the same leaf still wins on a shared input.
   *  Default unbound. */
  activate: GestureBinding;
};

/** Recursively freeze an object so a shared default can be handed out
 *  by reference without a consumer mutating it for the whole process.
 *  Mutations then throw in strict mode (fail-fast) — callers that need
 *  to edit must clone first. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Default navigation bindings: the historical behaviour expressed in
 *  the new model. Only `back` is bound out of the box (symmetric TZ at
 *  the lateral deadzone, 50) — the drills, cycle, and axis commit-center
 *  are all opt-in, matching today's defaults. Used as the fallback when
 *  a config omits `navigation` and as the seed for a fresh menu.
 *
 *  Deep-frozen: :func:`resolveNavigation` returns it by reference, so
 *  freezing guards the shared singleton against accidental mutation. */
export const DEFAULT_NAVIGATION: MenuNavigation = deepFreeze({
  aim: 'push',
  deadzone: DEFAULT_LATERAL_DEADZONE,
  hoverDeadzone: DEFAULT_HOVER_DEADZONE,
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
  activate: { inputs: [] },
});

/** Resolve the navigation block for a config that may omit it, so every
 *  consumer sees a complete :type:`MenuNavigation`. Mirrors the
 *  `resolveAxisInvert` pattern — one fallback, no per-call-site drift.
 *  The fallback (:data:`DEFAULT_NAVIGATION`) is frozen, so treat the
 *  result as read-only; clone before mutating. */
export function resolveNavigation(config: Pick<MenuConfig, 'navigation'>): MenuNavigation {
  return config.navigation ?? DEFAULT_NAVIGATION;
}

/** Shipped default for :type:`MenuAxisInvert` — both axes raw
 *  (correct for the SpaceNavigator we tested on). Used as the
 *  explicit setting in :data:`DEFAULT_MENU_CONFIG` *and* as the
 *  renderer's fallback when a user-supplied config omits
 *  `axisInvert`. Keeping both pinned to the same constant means
 *  the "leave field blank" path doesn't silently flip an axis. */
export const DEFAULT_AXIS_INVERT: Required<MenuAxisInvert> = { x: false, y: false };

/** Resolve the per-axis invert flags for a config that may have
 *  `axisInvert` missing, partial, or fully specified. Every
 *  consumer (App.tsx live sector calc, PieMenu render) MUST use
 *  this resolver so a partial `{ x: true }` falls back to the same
 *  Y default everywhere — past regressions had App and PieMenu
 *  reach for two different default constants. */
export function resolveAxisInvert(
  config: Pick<MenuConfig, 'axisInvert'>,
): Required<MenuAxisInvert> {
  return {
    x: config.axisInvert?.x ?? DEFAULT_AXIS_INVERT.x,
    y: config.axisInvert?.y ?? DEFAULT_AXIS_INVERT.y,
  };
}

/** The six SpaceMouse axes, in the order the daemon broadcasts them.
 *  Used to name the axis an :type:`AxisActivation` watches. */
export const MENU_AXES = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'] as const;
export type MenuAxisName = (typeof MENU_AXES)[number];

/** Which side of an axis a gesture responds to. `positive` /
 *  `negative` split the axis into two independent halves (e.g. TZ
 *  pulled up vs. pushed down); `both` fires on either side, matching
 *  the historical direction-agnostic TZ-cancel. */
export const ACTIVATION_DIRECTIONS = ['positive', 'negative', 'both'] as const;
export type ActivationDirection = (typeof ACTIVATION_DIRECTIONS)[number];

/** Starting threshold the editor seeds a fresh axis gesture with — used
 *  by the per-item activation and exit controls alike. Sits comfortably
 *  above the lateral deadzone (50) so a light deflection still hovers, in
 *  the low-hundreds range. The user tunes it from there. */
export const DEFAULT_GESTURE_THRESHOLD = 200;

/** Top-level menu config. */
export type MenuConfig = {
  /** Schema version this config was written against. Compared against
   *  :data:`MENU_CONFIG_VERSION` at load time; mismatches go through
   *  the migrator (or fall back to the default config). */
  version: number;
  /** Zero-based puck button that opens the pie. Omitting falls back
   *  to :data:`DEFAULT_TRIGGER_BUTTON`. Users with non-default
   *  button mappings (or wanting a non-primary button to trigger)
   *  set this. */
  triggerButton?: number;
  /** What the trigger button does once the pie is open. Omitting falls
   *  back to :data:`DEFAULT_TRIGGER_MODE` (`toggle`). See `TriggerMode`. */
  triggerMode?: TriggerMode;
  /** Optional per-axis sign overrides. Omitting the field (or one
   *  side of it) falls back to :data:`DEFAULT_AXIS_INVERT`. */
  axisInvert?: MenuAxisInvert;
  /** Overall pie size multiplier. 1 = the default size; the renderer
   *  multiplies the base radius by this (and divides by the window's
   *  devicePixelRatio so the on-screen size is consistent across monitor
   *  scalings). Clamped to [:data:`MIN_PIE_SCALE`, :data:`MAX_PIE_SCALE`].
   *  Omitting falls back to 1. */
  scale?: number;
  /** Unified navigation-gesture input bindings (issue #105). Optional
   *  and additive: omitting it falls back to :data:`DEFAULT_NAVIGATION`
   *  via :func:`resolveNavigation`. The legacy gesture fields still
   *  drive the runtime; a later PR migrates onto this block and removes
   *  them. */
  navigation?: MenuNavigation;
  /** The rooted menu tree. `root.branches` is the top-level ring
   *  (clockwise from 12 o'clock; the pie's sector count =
   *  `root.branches.length`, with no separate "count" knob). The root
   *  itself is the pie's centre: its `label` is the centre label
   *  (omitted → the renderer's ✕ glyph) and its optional `action` fires
   *  when the centre wins on commit (omitted → silent dismiss, the
   *  historical cancel). The root is the one node where an `action` and
   *  `branches` coexist. */
  root: MenuNode;
};

// ── Built-in action keys helper ─────────────────────────────────────

/** Compose a registry key for a built-in action. Used by the default
 *  config below and by anywhere else that wants to reference a
 *  built-in without hand-concatenating strings. */
export function builtinAction(name: (typeof BUILTIN_ACTION)[keyof typeof BUILTIN_ACTION]): string {
  return `${BUILTIN_PLUGIN_ID}/${name}`;
}

/** Whether a node is bound to the built-in cancel action — i.e. an
 *  explicit "dismiss the menu" field. The live pie and the editor preview
 *  render it red (the abort target), matching the centre ✕. */
export function isCancelNode(node: Pick<MenuNode, 'action'>): boolean {
  return node.action?.id === builtinAction(BUILTIN_ACTION.CANCEL);
}

// ── Factory default ─────────────────────────────────────────────────
//
// Shipped when the user has no menu.json yet. Eight sectors so the
// pie demo looks deliberate (cardinal directions + diagonals on an
// 8-pie); two action types so users see both built-ins in action.

export const DEFAULT_MENU_CONFIG: MenuConfig = {
  version: MENU_CONFIG_VERSION,
  triggerButton: DEFAULT_TRIGGER_BUTTON,
  axisInvert: DEFAULT_AXIS_INVERT,
  root: {
    // The historical default had no configurable centre, so the root
    // carries an empty label (renderer falls back to ✕) and no action
    // (silent dismiss on centre-commit).
    label: '',
    branches: [
      {
        label: 'Switch Window',
        action: { id: builtinAction('key-combo'), config: { keys: 'alt+Tab' } },
      },
      {
        label: 'Files',
        action: { id: builtinAction('exec'), config: { command: 'xdg-open .' } },
      },
      {
        label: 'Volume +',
        action: { id: builtinAction('key-combo'), config: { keys: 'XF86AudioRaiseVolume' } },
      },
      {
        label: 'Show Desktop',
        action: { id: builtinAction('key-combo'), config: { keys: 'super+d' } },
      },
      {
        label: 'Volume −',
        action: { id: builtinAction('key-combo'), config: { keys: 'XF86AudioLowerVolume' } },
      },
      {
        label: 'Terminal',
        action: { id: builtinAction('exec'), config: { command: 'xdg-terminal-exec' } },
      },
      {
        label: 'Mute',
        action: { id: builtinAction('key-combo'), config: { keys: 'XF86AudioMute' } },
      },
      {
        label: 'Browser',
        action: {
          id: builtinAction('exec'),
          config: { command: 'xdg-open https://example.com' },
        },
      },
    ],
  },
};

// ── Validation ──────────────────────────────────────────────────────

/** Known fields per level. Anything outside these lists is treated
 *  as a likely typo when the validator encounters it — the structural
 *  validation still passes (we want existing configs to keep loading)
 *  but `warnUnknownFields` logs a diagnostic so the user can find the
 *  typo. The action-editor in a future milestone can flip these into
 *  hard rejections via an opt-in `strict` mode. */
const KNOWN_MENU_CONFIG_FIELDS: readonly string[] = [
  'version',
  'triggerButton',
  'triggerMode',
  'axisInvert',
  'scale',
  'navigation',
  'root',
];
const KNOWN_NAVIGATION_FIELDS: readonly string[] = [
  'aim',
  'deadzone',
  'hoverDeadzone',
  'drillIn',
  'back',
  'cycle',
  'commitCenter',
  'activate',
];
const KNOWN_GESTURE_FIELDS: readonly string[] = ['inputs'];
const KNOWN_CYCLE_GESTURE_FIELDS: readonly string[] = ['inputs', 'priority'];
const KNOWN_BUTTON_INPUT_FIELDS: readonly string[] = ['kind', 'button'];
const KNOWN_AXIS_INPUT_FIELDS: readonly string[] = ['kind', 'axis', 'direction', 'threshold'];
const KNOWN_MAGNITUDE_INPUT_FIELDS: readonly string[] = ['kind', 'source', 'threshold'];
const KNOWN_NONE_INPUT_FIELDS: readonly string[] = ['kind'];
// 'id' is the editor-only stable identity (see MenuNode.id). The
// validator never copies it into its reconstructed output, so it's
// stripped on write; listing it here just keeps warnUnknownFields quiet
// when the editor sends an id-bearing config back to main to save.
const KNOWN_MENU_NODE_FIELDS: readonly string[] = [
  'label',
  'icon',
  'action',
  'branches',
  'keepOpen',
  'activation',
  'exit',
  'id',
];
const KNOWN_ACTION_REF_FIELDS: readonly string[] = ['id', 'config'];
const KNOWN_AXIS_INVERT_FIELDS: readonly string[] = ['x', 'y'];

/** Walk an object's keys and warn (without failing validation) for
 *  any field not in the known list. The validator stays permissive
 *  by design — a future schema bump could rename `magnitudeDrill`
 *  and we don't want old configs to refuse to load — but a typo'd
 *  `Children` or `binings` should at least surface in the log so
 *  the user can fix it instead of silently registering as a no-op.
 *
 *  The `[menu-loader]` prefix matches the existing diagnostic
 *  channel main uses when reporting load problems; both contexts
 *  (renderer dev tools and `journalctl --user` for the packaged
 *  app) pick the warning up the same way. */
function warnUnknownFields(
  obj: Record<string, unknown>,
  known: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      // eslint-disable-next-line no-console
      console.warn(`[menu-loader] unknown field "${key}" at ${where} — typo?`);
    }
  }
}

/** Result of validating an unknown JSON value against MenuConfig.
 *  Success carries the typed config; failure carries a single
 *  human-readable reason. The renderer doesn't need granular error
 *  paths — the loader either uses the config or falls back. */
export type MenuConfigValidation = { ok: true; config: MenuConfig } | { ok: false; reason: string };

/** Strict structural validator. Anything that doesn't match the
 *  shape exactly returns a reason; the loader logs and falls back
 *  to :data:`DEFAULT_MENU_CONFIG`. */
export function validateMenuConfig(value: unknown): MenuConfigValidation {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'menu config must be a JSON object' };
  }
  const obj = value as Record<string, unknown>;

  if (typeof obj.version !== 'number') {
    return { ok: false, reason: 'menu config field "version" must be a number' };
  }
  if (obj.version !== MENU_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `menu config version ${obj.version} not supported; expected ${MENU_CONFIG_VERSION}`,
    };
  }

  const rootResult = validateNode(obj.root, 'root', 0, true);
  if (!rootResult.ok) return { ok: false, reason: rootResult.reason };

  const result: MenuConfig = { version: MENU_CONFIG_VERSION, root: rootResult.value };
  if (obj.triggerButton !== undefined) {
    if (
      typeof obj.triggerButton !== 'number' ||
      !Number.isInteger(obj.triggerButton) ||
      obj.triggerButton < 0
    ) {
      return {
        ok: false,
        reason: 'menu config field "triggerButton" must be a non-negative integer when present',
      };
    }
    result.triggerButton = obj.triggerButton;
  }
  if (obj.triggerMode !== undefined) {
    if (!TRIGGER_MODES.includes(obj.triggerMode as TriggerMode)) {
      return {
        ok: false,
        reason: `menu config field "triggerMode" must be one of ${TRIGGER_MODES.join(', ')} when present`,
      };
    }
    result.triggerMode = obj.triggerMode as TriggerMode;
  }
  if (obj.scale !== undefined) {
    if (typeof obj.scale !== 'number' || !Number.isFinite(obj.scale)) {
      return {
        ok: false,
        reason: 'menu config field "scale" must be a finite number when present',
      };
    }
    // Clamp rather than reject: an out-of-range value is harmless, and
    // clamping keeps a hand-edited extreme from breaking the load.
    result.scale = Math.min(MAX_PIE_SCALE, Math.max(MIN_PIE_SCALE, obj.scale));
  }
  if (obj.axisInvert !== undefined) {
    if (
      typeof obj.axisInvert !== 'object' ||
      obj.axisInvert === null ||
      Array.isArray(obj.axisInvert)
    ) {
      return { ok: false, reason: 'menu config field "axisInvert" must be an object when present' };
    }
    const inv = obj.axisInvert as Record<string, unknown>;
    const axisInvert: MenuAxisInvert = {};
    for (const k of ['x', 'y'] as const) {
      if (inv[k] !== undefined) {
        if (typeof inv[k] !== 'boolean') {
          return {
            ok: false,
            reason: `menu config axisInvert.${k} must be a boolean when present`,
          };
        }
        axisInvert[k] = inv[k] as boolean;
      }
    }
    warnUnknownFields(inv, KNOWN_AXIS_INVERT_FIELDS, 'axisInvert');
    result.axisInvert = axisInvert;
  }
  if (obj.navigation !== undefined) {
    const navResult = validateNavigation(obj.navigation, 'navigation');
    if (!navResult.ok) return { ok: false, reason: navResult.reason };
    result.navigation = navResult.value;
    warnNavigationConflicts(navResult.value);
  }

  warnUnknownFields(obj, KNOWN_MENU_CONFIG_FIELDS, 'menu config');
  return { ok: true, config: result };
}

// ── Navigation validation (issue #105) ──────────────────────────────

type InputValidation = { ok: true; value: InputBinding } | { ok: false; reason: string };

/** Validate one :type:`InputBinding`. Structural problems (unknown
 *  `kind`, bad axis/direction/source, non-positive threshold,
 *  negative button) are hard rejections; binding *conflicts* between
 *  gestures are only warned about elsewhere (see
 *  :func:`warnNavigationConflicts`) per the issue-#105 "permissive +
 *  warn" decision. */
function validateInputBinding(raw: unknown, where: string): InputValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${where} must be an object` };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !INPUT_KINDS.includes(o.kind as InputKind)) {
    return { ok: false, reason: `${where} field "kind" must be one of ${INPUT_KINDS.join(', ')}` };
  }
  switch (o.kind as InputKind) {
    case 'button': {
      if (typeof o.button !== 'number' || !Number.isInteger(o.button) || o.button < 0) {
        return { ok: false, reason: `${where} field "button" must be a non-negative integer` };
      }
      warnUnknownFields(o, KNOWN_BUTTON_INPUT_FIELDS, where);
      return { ok: true, value: { kind: 'button', button: o.button } };
    }
    case 'axis': {
      if (typeof o.axis !== 'string' || !MENU_AXES.includes(o.axis as MenuAxisName)) {
        return {
          ok: false,
          reason: `${where} field "axis" must be one of ${MENU_AXES.join(', ')}`,
        };
      }
      if (
        typeof o.direction !== 'string' ||
        !ACTIVATION_DIRECTIONS.includes(o.direction as ActivationDirection)
      ) {
        return {
          ok: false,
          reason: `${where} field "direction" must be one of ${ACTIVATION_DIRECTIONS.join(', ')}`,
        };
      }
      if (typeof o.threshold !== 'number' || !Number.isFinite(o.threshold) || o.threshold <= 0) {
        return { ok: false, reason: `${where} field "threshold" must be a positive finite number` };
      }
      warnUnknownFields(o, KNOWN_AXIS_INPUT_FIELDS, where);
      return {
        ok: true,
        value: {
          kind: 'axis',
          axis: o.axis as MenuAxisName,
          direction: o.direction as ActivationDirection,
          threshold: o.threshold,
        },
      };
    }
    case 'magnitude': {
      if (
        typeof o.source !== 'string' ||
        !MAGNITUDE_SOURCES.includes(o.source as MagnitudeSource)
      ) {
        return {
          ok: false,
          reason: `${where} field "source" must be one of ${MAGNITUDE_SOURCES.join(', ')}`,
        };
      }
      if (typeof o.threshold !== 'number' || !Number.isFinite(o.threshold) || o.threshold <= 0) {
        return { ok: false, reason: `${where} field "threshold" must be a positive finite number` };
      }
      warnUnknownFields(o, KNOWN_MAGNITUDE_INPUT_FIELDS, where);
      return {
        ok: true,
        value: { kind: 'magnitude', source: o.source as MagnitudeSource, threshold: o.threshold },
      };
    }
    case 'none':
      warnUnknownFields(o, KNOWN_NONE_INPUT_FIELDS, where);
      return { ok: true, value: { kind: 'none' } };
  }
}

type GestureValidation<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Validate a gesture's `inputs` array (each an InputBinding). A
 *  missing array defaults to empty (gesture unbound). */
function validateInputs(raw: unknown, where: string): GestureValidation<InputBinding[]> {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, reason: `${where} field "inputs" must be an array when present` };
  }
  const inputs: InputBinding[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = validateInputBinding(raw[i], `${where} input ${i}`);
    if (!r.ok) return { ok: false, reason: r.reason };
    inputs.push(r.value);
  }
  return { ok: true, value: inputs };
}

/** Validate a plain (non-cycle) gesture binding. An *omitted* gesture
 *  (`undefined`) defaults to unbound; anything else present (incl.
 *  `null`) must be an object, so a stray `null` is rejected rather than
 *  silently coerced to empty. */
function validateGestureBinding(raw: unknown, where: string): GestureValidation<GestureBinding> {
  if (raw === undefined) return { ok: true, value: { inputs: [] } };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${where} must be an object when present` };
  }
  const o = raw as Record<string, unknown>;
  const inputs = validateInputs(o.inputs, where);
  if (!inputs.ok) return { ok: false, reason: inputs.reason };
  warnUnknownFields(o, KNOWN_GESTURE_FIELDS, where);
  return { ok: true, value: { inputs: inputs.value } };
}

/** Validate the cycle gesture binding (inputs + priority enum). An
 *  omitted cycle (`undefined`) defaults to unbound with `lateral`
 *  priority; a present `null`/non-object is rejected. */
function validateCycleBinding(raw: unknown, where: string): GestureValidation<CycleBinding> {
  if (raw === undefined) return { ok: true, value: { inputs: [], priority: 'lateral' } };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${where} must be an object when present` };
  }
  const o = raw as Record<string, unknown>;
  const inputs = validateInputs(o.inputs, where);
  if (!inputs.ok) return { ok: false, reason: inputs.reason };
  let priority: TwistCyclePriority = 'lateral';
  if (o.priority !== undefined) {
    if (
      typeof o.priority !== 'string' ||
      !TWIST_CYCLE_PRIORITIES.includes(o.priority as TwistCyclePriority)
    ) {
      return {
        ok: false,
        reason: `${where} field "priority" must be one of ${TWIST_CYCLE_PRIORITIES.join(', ')}`,
      };
    }
    priority = o.priority as TwistCyclePriority;
  }
  warnUnknownFields(o, KNOWN_CYCLE_GESTURE_FIELDS, where);
  return { ok: true, value: { inputs: inputs.value, priority } };
}

type NavigationValidation = { ok: true; value: MenuNavigation } | { ok: false; reason: string };

/** Validate the optional `navigation` block. Each gesture is optional;
 *  an omitted one defaults to *unbound* (empty inputs) — distinct from
 *  omitting the whole block, which falls back to the historical
 *  defaults via :func:`resolveNavigation`. */
function validateNavigation(raw: unknown, where: string): NavigationValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${where} must be an object when present` };
  }
  const o = raw as Record<string, unknown>;
  // Aim source: optional, defaults to the historical `push` (TX/TY) when
  // omitted; a present value must be one of the known sources (#159).
  let aim: AimSource = 'push';
  if (o.aim !== undefined) {
    if (typeof o.aim !== 'string' || !AIM_SOURCES.includes(o.aim as AimSource)) {
      return { ok: false, reason: `${where} field "aim" must be one of ${AIM_SOURCES.join(', ')}` };
    }
    aim = o.aim as AimSource;
  }
  // Deadzone: optional finite number, clamped to bounds; defaults to the
  // historical 50 when omitted (#160). Mirrors the scale clamp — an
  // out-of-range value is pulled into range rather than rejected.
  let deadzone = DEFAULT_LATERAL_DEADZONE;
  if (o.deadzone !== undefined) {
    if (typeof o.deadzone !== 'number' || !Number.isFinite(o.deadzone)) {
      return {
        ok: false,
        reason: `${where} field "deadzone" must be a finite number when present`,
      };
    }
    deadzone = Math.min(MAX_LATERAL_DEADZONE, Math.max(MIN_LATERAL_DEADZONE, o.deadzone));
  }
  // Hover threshold: optional finite number, clamped into range and then to
  // ≤ the engage deadzone (the hysteresis invariant — hovering can't take a
  // firmer push than engaging). Defaults to DEFAULT_HOVER_DEADZONE (#160).
  let hoverDeadzone = Math.min(deadzone, DEFAULT_HOVER_DEADZONE);
  if (o.hoverDeadzone !== undefined) {
    if (typeof o.hoverDeadzone !== 'number' || !Number.isFinite(o.hoverDeadzone)) {
      return {
        ok: false,
        reason: `${where} field "hoverDeadzone" must be a finite number when present`,
      };
    }
    hoverDeadzone = Math.min(deadzone, Math.max(MIN_LATERAL_DEADZONE, o.hoverDeadzone));
  }
  const drillIn = validateGestureBinding(o.drillIn, `${where}.drillIn`);
  if (!drillIn.ok) return { ok: false, reason: drillIn.reason };
  const back = validateGestureBinding(o.back, `${where}.back`);
  if (!back.ok) return { ok: false, reason: back.reason };
  const cycle = validateCycleBinding(o.cycle, `${where}.cycle`);
  if (!cycle.ok) return { ok: false, reason: cycle.reason };
  const commitCenter = validateGestureBinding(o.commitCenter, `${where}.commitCenter`);
  if (!commitCenter.ok) return { ok: false, reason: commitCenter.reason };
  const activate = validateGestureBinding(o.activate, `${where}.activate`);
  if (!activate.ok) return { ok: false, reason: activate.reason };
  warnUnknownFields(o, KNOWN_NAVIGATION_FIELDS, where);
  return {
    ok: true,
    value: {
      aim,
      deadzone,
      hoverDeadzone,
      drillIn: drillIn.value,
      back: back.value,
      cycle: cycle.value,
      commitCenter: commitCenter.value,
      activate: activate.value,
    },
  };
}

/** The keys an input *occupies* — two gestures collide when their key
 *  sets intersect. Keying axes by their occupied half/halves
 *  (`positive`/`negative`) means a deliberate split (RZ-up vs RZ-down)
 *  shares no key and stays quiet, while a `both` axis occupies *both*
 *  halves and therefore correctly overlaps a directional binding on the
 *  same axis. `none` occupies nothing. */
function inputConflictKeys(input: InputBinding): string[] {
  switch (input.kind) {
    case 'button':
      return [`button:${input.button}`];
    case 'axis':
      return input.direction === 'both'
        ? [`axis:${input.axis}:positive`, `axis:${input.axis}:negative`]
        : [`axis:${input.axis}:${input.direction}`];
    case 'magnitude':
      return [`magnitude:${input.source}`];
    case 'none':
      return [];
  }
}

/** Warn (never reject) when two gestures bind the same input — the
 *  issue-#105 "permissive + warn" rule. Splitting an axis by direction
 *  is legitimate, so this is a heads-up, not an error; the user tunes
 *  the feel on hardware. */
function warnNavigationConflicts(nav: MenuNavigation): void {
  const seen = new Map<string, string>(); // conflict key → first gesture that used it
  const gestures: Array<[string, GestureBinding]> = [
    ['drillIn', nav.drillIn],
    ['back', nav.back],
    ['cycle', nav.cycle],
    ['commitCenter', nav.commitCenter],
    ['activate', nav.activate],
  ];
  for (const [name, gesture] of gestures) {
    for (const input of gesture.inputs) {
      for (const key of inputConflictKeys(input)) {
        const prev = seen.get(key);
        if (prev !== undefined && prev !== name) {
          // drillIn and activate are disjoint by node type — drill only acts
          // on a hovered branch, activate only on a hovered leaf, and a node
          // is never both — so a shared input can never fire both. Suppress
          // that specific (always-false) conflict; it's the natural "button 0
          // = drill a branch / fire a leaf" combo the twist styles use.
          const pair = `${prev}+${name}`;
          if (pair === 'drillIn+activate' || pair === 'activate+drillIn') continue;
          // eslint-disable-next-line no-console
          console.warn(
            `[menu-loader] navigation: "${name}" and "${prev}" both bind ${key} — they may fight; split by direction or pick distinct inputs`,
          );
        } else if (prev === undefined) {
          seen.set(key, name);
        }
      }
    }
  }
  // Twist-only aiming (#159) has no lateral pointer — the selection moves
  // solely via the cycle/step gesture. Without an axis bound to `cycle`
  // there's no way to move it, so the pie opens with nothing reachable.
  // Warn (never reject) so the user can bind one (e.g. RZ).
  if (nav.aim === 'twist' && !nav.cycle.inputs.some((input) => input.kind === 'axis')) {
    // eslint-disable-next-line no-console
    console.warn(
      '[menu-loader] navigation: aim is "twist" but no axis is bound to "cycle" (step) — the selection can\'t move; bind an axis (e.g. RZ) to step.',
    );
  }
}

type NodeValidation = { ok: true; value: MenuNode } | { ok: false; reason: string };

/** Strict structural validator for one menu node. Recursive: a node
 *  with `branches` validates each branch through the same path, so
 *  arbitrarily nested submenus are checked uniformly up to
 *  :data:`MAX_MENU_DEPTH` levels deep; configs that go past the
 *  cap are rejected with a clear reason instead of overflowing
 *  the recursion stack. `where` is the human-readable path prefix
 *  the caller has built up so error reasons stay traceable across
 *  depths (e.g. `root branch 2 branch 1 branch 0 field "label" must be ...`).
 *
 *  `isRoot` relaxes/tightens the rules for the config's root node:
 *   - the root's `label` is optional (renderer falls back to ✕) and may
 *     be empty, where a non-root label must be a non-empty string;
 *   - the root must carry a non-empty `branches` array (the top-level
 *     ring), and it MAY also carry an `action` (the centre-commit
 *     target) — the one node where the two coexist;
 *   - a non-root node keeps the historical mutual exclusivity: either an
 *     `action` (leaf) or `branches` (submenu), never both. */
function validateNode(raw: unknown, where: string, depth = 0, isRoot = false): NodeValidation {
  // Reject pathologically nested configs before the recursion
  // walks far enough to overflow the call stack. The cap leaves
  // plenty of headroom over realistic menus and surfaces as a
  // normal validator error instead of a crash on load. The reason
  // names the actual offending depth so a config author can see
  // how far over the cap they went without counting `branch` tokens
  // in the path prefix.
  if (depth > MAX_MENU_DEPTH) {
    return {
      ok: false,
      reason: `${where} exceeds maximum nesting depth ${MAX_MENU_DEPTH} (got ${depth})`,
    };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: `${where} is not an object` };
  }
  const s = raw as Record<string, unknown>;
  // Label: the root's is optional (omitted → ✕ glyph) and so may be
  // empty/absent; a non-root node must name itself.
  let label = '';
  if (isRoot) {
    if (s.label !== undefined) {
      if (typeof s.label !== 'string') {
        return { ok: false, reason: `${where} field "label" must be a string when present` };
      }
      label = s.label;
    }
  } else {
    // A non-root node needs *something* to show: a non-empty label, or a
    // renderable icon. Icon-only items are allowed (e.g. a FreeCAD command
    // shown by its icon alone) — but a node with neither would be
    // invisible/unidentifiable. Gate on the same predicate the renderer uses,
    // so a node that validates as "icon-only" actually draws an icon (a
    // non-data: string like a legacy "box" name renders nothing).
    const hasIcon = isRenderableIcon(s.icon);
    if (typeof s.label !== 'string') {
      return { ok: false, reason: `${where} field "label" must be a string` };
    }
    if (s.label.trim() === '' && !hasIcon) {
      return {
        ok: false,
        reason: `${where} field "label" must be non-empty unless the node has an icon`,
      };
    }
    label = s.label;
  }
  const node: MenuNode = { label };
  if (s.icon !== undefined) {
    if (typeof s.icon !== 'string')
      return { ok: false, reason: `${where} field "icon" must be a string when present` };
    node.icon = s.icon;
  }
  // On a non-root node, submenu (branches) and leaf (action) are
  // mutually exclusive so the renderer doesn't have to disambiguate
  // which one wins on commit. The root is exempt: its branches are the
  // top-level ring and its optional action is the centre-commit target,
  // so the two legitimately coexist there.
  if (!isRoot && s.action !== undefined && s.branches !== undefined) {
    return {
      ok: false,
      reason: `${where} must declare either "action" or "branches", not both`,
    };
  }
  // The root always carries the top-level ring as an array — but it may be
  // empty: deleting every item leaves just the centre (the pie shows the
  // centre alone). A non-root submenu's branches must stay non-empty (an
  // empty submenu is meaningless — remove the submenu node instead).
  if (isRoot && s.branches === undefined) {
    return { ok: false, reason: `${where} field "branches" must be an array` };
  }
  if (s.action !== undefined) {
    const result = validateActionRef(s.action, `${where} action`);
    if (!result.ok) return { ok: false, reason: result.reason };
    node.action = result.value;
  }
  if (s.branches !== undefined) {
    if (!Array.isArray(s.branches)) {
      return {
        ok: false,
        reason: `${where} field "branches" must be an array when present`,
      };
    }
    if (!isRoot && s.branches.length === 0) {
      return {
        ok: false,
        reason: `${where} field "branches" must not be empty`,
      };
    }
    // The root's branches are the top-level ring — depth 0, the same
    // level the pre-root-model top-level sectors sat at. A non-root
    // submenu's branches are one level deeper. Keeping the root
    // transparent to the depth count preserves the MAX_MENU_DEPTH
    // boundary exactly (behaviour-neutral).
    const childDepth = isRoot ? depth : depth + 1;
    const branches: MenuNode[] = [];
    for (let i = 0; i < s.branches.length; i++) {
      const result = validateNode(s.branches[i], `${where} branch ${i}`, childDepth);
      if (!result.ok) return { ok: false, reason: result.reason };
      branches.push(result.value);
    }
    node.branches = branches;
  }
  if (s.keepOpen !== undefined) {
    if (typeof s.keepOpen !== 'boolean') {
      return { ok: false, reason: `${where} field "keepOpen" must be a boolean when present` };
    }
    // Leaf-with-action only, and only meaningful when true: drop it on a
    // submenu, an action-less (label-only) leaf, or when false so it never
    // persists as a no-op flag. A label-only node commits to nothing, so
    // keeping the menu open there would strand the user on the Back gesture.
    if (s.keepOpen && node.branches === undefined && node.action !== undefined)
      node.keepOpen = true;
  }
  if (s.activation !== undefined) {
    const result = validateGestureBinding(s.activation, `${where} activation`);
    if (!result.ok) return { ok: false, reason: result.reason };
    // Leaf-with-action only, and only when it actually binds an input:
    // a submenu drills (no action to fire) and a label-only leaf commits
    // to nothing, so an activation there would be a no-op. Drop it
    // otherwise so it never persists where it can't fire.
    if (result.value.inputs.length > 0 && node.branches === undefined && node.action !== undefined)
      node.activation = result.value;
  }
  if (s.exit !== undefined) {
    const result = validateGestureBinding(s.exit, `${where} exit`);
    if (!result.ok) return { ok: false, reason: result.reason };
    // Any node (leaf or submenu) can carry an exit, but only when it
    // actually binds an input — drop an empty one so it never persists
    // as a no-op.
    if (result.value.inputs.length > 0) node.exit = result.value;
  }
  warnUnknownFields(s, KNOWN_MENU_NODE_FIELDS, where);
  return { ok: true, value: node };
}

type ActionRefValidation = { ok: true; value: ActionRef } | { ok: false; reason: string };

function validateActionRef(raw: unknown, where: string): ActionRefValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: `${where} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    return { ok: false, reason: `${where} field "id" must be a non-empty string` };
  }
  const out: ActionRef = { id: obj.id };
  if (obj.config !== undefined) {
    if (typeof obj.config !== 'object' || obj.config === null || Array.isArray(obj.config)) {
      return { ok: false, reason: `${where} field "config" must be an object when present` };
    }
    out.config = obj.config as Record<string, unknown>;
  }
  warnUnknownFields(obj, KNOWN_ACTION_REF_FIELDS, where);
  return { ok: true, value: out };
}

// ── Serialization ───────────────────────────────────────────────────

/** Build a plain object for one action ref with a fixed key order. */
function orderActionRef(ref: ActionRef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: ref.id };
  if (ref.config !== undefined) out.config = ref.config;
  return out;
}

/** Build a plain object for one input binding with a fixed key order. */
function orderInput(input: InputBinding): Record<string, unknown> {
  switch (input.kind) {
    case 'button':
      return { kind: 'button', button: input.button };
    case 'axis':
      return {
        kind: 'axis',
        axis: input.axis,
        direction: input.direction,
        threshold: input.threshold,
      };
    case 'magnitude':
      return { kind: 'magnitude', source: input.source, threshold: input.threshold };
    case 'none':
      return { kind: 'none' };
  }
}

/** Build a plain object for the navigation block with a fixed key
 *  order (gesture order + each input's keys), for stable diffs. */
function orderNavigation(nav: MenuNavigation): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Omit the default 'push' so existing/default configs don't gain the
  // field — only a non-default aim source is written (#159), keeping the
  // additive field out of every serialized config.
  if (nav.aim !== 'push') out.aim = nav.aim;
  // Omit the default deadzone so unchanged configs don't gain the field.
  if (nav.deadzone !== DEFAULT_LATERAL_DEADZONE) out.deadzone = nav.deadzone;
  if (nav.hoverDeadzone !== DEFAULT_HOVER_DEADZONE) out.hoverDeadzone = nav.hoverDeadzone;
  out.drillIn = { inputs: nav.drillIn.inputs.map(orderInput) };
  out.back = { inputs: nav.back.inputs.map(orderInput) };
  out.cycle = { inputs: nav.cycle.inputs.map(orderInput), priority: nav.cycle.priority };
  out.commitCenter = { inputs: nav.commitCenter.inputs.map(orderInput) };
  out.activate = { inputs: nav.activate.inputs.map(orderInput) };
  return out;
}

/** Build a plain object for one menu node with a fixed key order,
 *  omitting absent optional fields. Recursive for nested branches. */
function orderNode(node: MenuNode): Record<string, unknown> {
  const out: Record<string, unknown> = { label: node.label };
  if (node.icon !== undefined) out.icon = node.icon;
  if (node.action !== undefined) out.action = orderActionRef(node.action);
  if (node.keepOpen) out.keepOpen = true;
  if (node.activation !== undefined)
    out.activation = { inputs: node.activation.inputs.map(orderInput) };
  if (node.exit !== undefined) out.exit = { inputs: node.exit.inputs.map(orderInput) };
  if (node.branches !== undefined) out.branches = node.branches.map(orderNode);
  return out;
}

/**
 * Serialize a MenuConfig to the canonical on-disk JSON string.
 *
 * The editor writes back through this so saves are *stable*: the
 * top-level keys, each node's keys, and each action's keys are
 * emitted in a fixed order, and absent optional fields are omitted.
 * That keeps diffs of `menu.json` minimal — a label edit changes one
 * line, not the whole file from a reshuffled key order.
 *
 * Note the small option objects (`axisInvert`, `magnitudeDrill`,
 * `tiltDrill`) are emitted as-is, so *their* internal key order follows
 * the in-memory object. The editor doesn't mutate them today; normalize
 * them here too if it ever does.
 *
 * 2-space indent + trailing newline match the hand-authored style and
 * keep the file POSIX-friendly (newline-terminated).
 */
export function serializeMenuConfig(config: MenuConfig): string {
  const out: Record<string, unknown> = { version: config.version };
  if (config.triggerButton !== undefined) out.triggerButton = config.triggerButton;
  // Omit the default 'toggle' so existing/default configs don't gain the
  // field — only a non-default 'open' is written.
  if (config.triggerMode !== undefined && config.triggerMode !== DEFAULT_TRIGGER_MODE)
    out.triggerMode = config.triggerMode;
  if (config.axisInvert !== undefined) out.axisInvert = config.axisInvert;
  if (config.navigation !== undefined) out.navigation = orderNavigation(config.navigation);
  out.root = orderNode(config.root);
  return JSON.stringify(out, null, 2) + '\n';
}

// ── Migration ───────────────────────────────────────────────────────

/** Upgrades a raw parsed config from version N to N+1. Registered by the
 *  version it migrates *from*. */
type MenuConfigMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Step migrations keyed by source version. Empty while
 *  :data:`MENU_CONFIG_VERSION` is 1 — the framework exists so a future
 *  bump registers `{ 1: (raw) => ({ ...raw, version: 2, ... }) }` here
 *  instead of every existing config silently failing validation and
 *  falling back to the default (the latent bug this guards against). */
const MENU_CONFIG_MIGRATIONS: Record<number, MenuConfigMigration> = {};

export type MenuMigrationResult =
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Upgrade a raw parsed config from `fromVersion` to the current
 * :data:`MENU_CONFIG_VERSION` by running the registered step migrations
 * in order. The caller validates the result afterwards.
 *
 * Same version is a no-op; a version newer than supported, or a gap with
 * no registered migration, is an error (the loader then falls back to
 * the default and logs the reason).
 */
export function migrateMenuConfig(
  raw: Record<string, unknown>,
  fromVersion: number,
): MenuMigrationResult {
  if (fromVersion === MENU_CONFIG_VERSION) return { ok: true, raw };
  if (fromVersion > MENU_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `config version ${fromVersion} is newer than supported version ${MENU_CONFIG_VERSION}`,
    };
  }
  let current = raw;
  for (let v = fromVersion; v < MENU_CONFIG_VERSION; v++) {
    const migrate = MENU_CONFIG_MIGRATIONS[v];
    if (!migrate) {
      return { ok: false, reason: `no migration registered from config version ${v} to ${v + 1}` };
    }
    current = migrate(current);
  }
  return { ok: true, raw: current };
}

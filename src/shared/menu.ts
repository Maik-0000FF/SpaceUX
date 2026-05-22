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
export const MENU_CONFIG_VERSION = 1;

/** Hard cap on how deeply menus can nest. Each level inside a
 *  branch's `children` array counts as +1; the top-level pie is
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
   *  explicit Cancel on a sector or the center field — with its own
   *  label/icon — rather than relying on the implicit "leave the puck
   *  centered" gesture. */
  CANCEL: 'cancel',
} as const;

/** Zero-based button index that opens the pie menu when no user
 *  config overrides it. SpaceNavigator's primary button is bnum 0;
 *  pucks with more buttons inherit the same default so a fresh
 *  install always has *something* to react to. */
export const DEFAULT_TRIGGER_BUTTON = 0;

// ── Schema types ────────────────────────────────────────────────────

/** Reference to an action, including the per-instance config the
 *  action handler will receive. */
export type ActionRef = {
  /** Composite "pluginId/actionName" key. Built-in actions use
   *  :data:`BUILTIN_PLUGIN_ID`; plugins use whatever they declare in
   *  their manifest. */
  action: string;
  /** Optional per-instance config. Shape depends on the action; the
   *  menu loader doesn't validate it because each action owns its
   *  own schema (see PluginManifest.actions.config). */
  config?: Record<string, unknown>;
};

/** One sector in the pie. A sector is either a *leaf* (no children,
 *  optional binding fires on commit) or a *branch* (carries a
 *  non-empty `children` array which becomes the next-level submenu
 *  when the user commits on this sector). The two are mutually
 *  exclusive — the validator rejects sectors that declare both
 *  `binding` and `children` so the renderer doesn't have to guess
 *  which one wins on commit. */
export type MenuSector = {
  /** Short display string for the sector. The renderer puts this
   *  inside the wedge — keep it 1–2 words so the label fits.
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
  /** Action invoked when this sector wins on MENU_COMMIT. Omitted
   *  bindings render a label but commit silently — useful for
   *  visual-only sectors or as the placeholder state on a sector
   *  being authored. Mutually exclusive with `children`. */
  binding?: ActionRef;
  /** Nested sectors that become the next-level submenu when the
   *  user commits on this sector. The schema is recursive: a child
   *  can itself carry further children for arbitrary depth.
   *  Mutually exclusive with `binding`. */
  children?: MenuSector[];
  /** Leaf-with-binding only: keep the menu open after this sector's
   *  action fires instead of dismissing. Lets a continuous action (e.g.
   *  nudging volume via twist) be re-committed without reopening the
   *  pie. The validator drops it on a branch (committing a branch
   *  drills in, never dismisses) and on a binding-less label-only leaf
   *  (which commits to nothing). Omitted/false → historical
   *  close-on-commit. */
  keepOpen?: boolean;
  /** Leaf-with-binding only: a per-item *activation* input that fires
   *  this sector's `binding` while it is the hovered selection — e.g.
   *  bind TZ− so pushing the puck down on this item runs its action,
   *  on top of the global trigger/commit. Resolved relative to the
   *  hovered item and checked ahead of the global gestures, so a
   *  per-item activation wins over a colliding global gesture (e.g.
   *  back) for this item (#130 R2). The validator drops it on a branch
   *  or a binding-less leaf. */
  activation?: GestureBinding;
  /** A per-item *exit* input that returns focus to the centre (deselect,
   *  pie stays open) while this sector is hovered — the per-item way back
   *  alongside the global back, e.g. when an `activation` has shadowed the
   *  global back's input on this item. Applies to any sector (leaf or
   *  branch); checked ahead of the global gestures so it wins on a shared
   *  input. The validator drops it when it binds no inputs (#130 R3). */
  exit?: GestureBinding;
  /** Editor-only stable identity. Assigned by the editor when a config
   *  is adopted (and to newly-added sectors); used for React keys and
   *  the tree's expand state. Because it lives on the object, immer
   *  copies it across edits/reorders, so identity survives where an
   *  object-identity WeakMap would not. **Never persisted** — the
   *  validator reconstructs sectors from the structural fields and
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
// or a 2D magnitude — configurable globally and (later) per sector.
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
  /** Drill into a hovered branch. Legacy: magnitudeDrill + tiltDrill + twistDrill. */
  drillIn: GestureBinding;
  /** Pop one level (drilled) or dismiss (top level). Legacy: TZ-back via tzDeadzone. */
  back: GestureBinding;
  /** Step the highlighted selection within a ring. Legacy: twistCycle. */
  cycle: CycleBinding;
  /** Commit the center field (fire its binding, or dismiss when it has
   *  none). Legacy: centerField.activation. */
  commitCenter: GestureBinding;
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
  drillIn: { inputs: [] },
  back: { inputs: [{ kind: 'axis', axis: 'tz', direction: 'both', threshold: 50 }] },
  cycle: { inputs: [], priority: 'lateral' },
  commitCenter: { inputs: [] },
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

/** Starting threshold the editor seeds a fresh axis activation with.
 *  Sits comfortably above the lateral deadzone (50) so a light
 *  deflection still hovers, in the low-hundreds range. The user tunes
 *  it from there. */
export const DEFAULT_ACTIVATION_THRESHOLD = 200;

/** The pie's center field. Historically a hardcoded cancel target
 *  (the ✕ glyph that dismisses the menu when committed with nothing
 *  selected); this type makes it a configurable target like a sector.
 *
 *  No `binding` → committing the center is a silent dismiss, i.e. the
 *  historical cancel behavior. With a `binding` it fires that action
 *  on center-commit instead — assign :data:`BUILTIN_ACTION.CANCEL` to
 *  keep "cancel" semantics with a custom label/icon, or any other
 *  action to repurpose the center entirely. */
export type MenuCenter = {
  /** Display label for the center. Omitted → the renderer falls back
   *  to the ✕ glyph (historical look). */
  label?: string;
  /** Icon name resolved by the renderer's theme. Parallels
   *  :type:`MenuSector.icon` and is likewise ignored by the v0
   *  renderer — labels are enough to drive the dispatch path. */
  icon?: string;
  /** Action invoked when the center wins on commit. Omitted → silent
   *  dismiss (historical cancel). The center is always a leaf — it
   *  never carries children. */
  binding?: ActionRef;
};

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
  /** Optional per-axis sign overrides. Omitting the field (or one
   *  side of it) falls back to :data:`DEFAULT_AXIS_INVERT`. */
  axisInvert?: MenuAxisInvert;
  /** Overall pie size multiplier. 1 = the default size; the renderer
   *  multiplies the base radius by this (and divides by the window's
   *  devicePixelRatio so the on-screen size is consistent across monitor
   *  scalings). Clamped to [:data:`MIN_PIE_SCALE`, :data:`MAX_PIE_SCALE`].
   *  Omitting falls back to 1. */
  scale?: number;
  /** Optional configurable center field. Omitting it keeps the
   *  historical hardcoded cancel target (✕ glyph, silent dismiss on
   *  commit). See :type:`MenuCenter`. */
  centerField?: MenuCenter;
  /** Unified navigation-gesture input bindings (issue #105). Optional
   *  and additive: omitting it falls back to :data:`DEFAULT_NAVIGATION`
   *  via :func:`resolveNavigation`. The legacy gesture fields still
   *  drive the runtime; a later PR migrates onto this block and removes
   *  them. */
  navigation?: MenuNavigation;
  /** Sectors in clockwise order starting at 12 o'clock. The pie's
   *  sector count = sectors.length — there is no separate "count"
   *  knob and there cannot be one. */
  sectors: MenuSector[];
};

// ── Built-in action keys helper ─────────────────────────────────────

/** Compose a registry key for a built-in action. Used by the default
 *  config below and by anywhere else that wants to reference a
 *  built-in without hand-concatenating strings. */
export function builtinAction(name: (typeof BUILTIN_ACTION)[keyof typeof BUILTIN_ACTION]): string {
  return `${BUILTIN_PLUGIN_ID}/${name}`;
}

/** Whether a sector is bound to the built-in cancel action — i.e. an
 *  explicit "dismiss the menu" field. The live pie and the editor preview
 *  render it red (the abort target), matching the centre ✕. */
export function isCancelSector(sector: Pick<MenuSector, 'binding'>): boolean {
  return sector.binding?.action === builtinAction(BUILTIN_ACTION.CANCEL);
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
  sectors: [
    {
      label: 'Switch Window',
      binding: { action: builtinAction('key-combo'), config: { keys: 'alt+Tab' } },
    },
    {
      label: 'Files',
      binding: { action: builtinAction('exec'), config: { command: 'xdg-open .' } },
    },
    {
      label: 'Volume +',
      binding: { action: builtinAction('key-combo'), config: { keys: 'XF86AudioRaiseVolume' } },
    },
    {
      label: 'Show Desktop',
      binding: { action: builtinAction('key-combo'), config: { keys: 'super+d' } },
    },
    {
      label: 'Volume −',
      binding: { action: builtinAction('key-combo'), config: { keys: 'XF86AudioLowerVolume' } },
    },
    {
      label: 'Terminal',
      binding: { action: builtinAction('exec'), config: { command: 'xdg-terminal-exec' } },
    },
    {
      label: 'Mute',
      binding: { action: builtinAction('key-combo'), config: { keys: 'XF86AudioMute' } },
    },
    {
      label: 'Browser',
      binding: {
        action: builtinAction('exec'),
        config: { command: 'xdg-open https://example.com' },
      },
    },
  ],
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
  'axisInvert',
  'scale',
  'centerField',
  'navigation',
  'sectors',
];
const KNOWN_NAVIGATION_FIELDS: readonly string[] = ['drillIn', 'back', 'cycle', 'commitCenter'];
const KNOWN_GESTURE_FIELDS: readonly string[] = ['inputs'];
const KNOWN_CYCLE_GESTURE_FIELDS: readonly string[] = ['inputs', 'priority'];
const KNOWN_BUTTON_INPUT_FIELDS: readonly string[] = ['kind', 'button'];
const KNOWN_AXIS_INPUT_FIELDS: readonly string[] = ['kind', 'axis', 'direction', 'threshold'];
const KNOWN_MAGNITUDE_INPUT_FIELDS: readonly string[] = ['kind', 'source', 'threshold'];
const KNOWN_NONE_INPUT_FIELDS: readonly string[] = ['kind'];
const KNOWN_CENTER_FIELDS: readonly string[] = ['label', 'icon', 'binding'];
// 'id' is the editor-only stable identity (see MenuSector.id). The
// validator never copies it into its reconstructed output, so it's
// stripped on write; listing it here just keeps warnUnknownFields quiet
// when the editor sends an id-bearing config back to main to save.
const KNOWN_MENU_SECTOR_FIELDS: readonly string[] = [
  'label',
  'icon',
  'binding',
  'children',
  'keepOpen',
  'activation',
  'exit',
  'id',
];
const KNOWN_ACTION_REF_FIELDS: readonly string[] = ['action', 'config'];
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

  if (!Array.isArray(obj.sectors) || obj.sectors.length === 0) {
    return { ok: false, reason: 'menu config field "sectors" must be a non-empty array' };
  }

  const sectors: MenuSector[] = [];
  for (let i = 0; i < obj.sectors.length; i++) {
    const result = validateSector(obj.sectors[i], `sector ${i}`);
    if (!result.ok) return { ok: false, reason: result.reason };
    sectors.push(result.value);
  }

  const result: MenuConfig = { version: MENU_CONFIG_VERSION, sectors };
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
  if (obj.centerField !== undefined) {
    const centerResult = validateCenter(obj.centerField, 'centerField');
    if (!centerResult.ok) return { ok: false, reason: centerResult.reason };
    // An empty center (`{}`, or all fields absent) is semantically
    // identical to omitting `centerField` entirely — drop it so it
    // never round-trips to disk as a meaningless `"centerField": {}`.
    if (Object.keys(centerResult.value).length > 0) {
      result.centerField = centerResult.value;
    }
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
  const drillIn = validateGestureBinding(o.drillIn, `${where}.drillIn`);
  if (!drillIn.ok) return { ok: false, reason: drillIn.reason };
  const back = validateGestureBinding(o.back, `${where}.back`);
  if (!back.ok) return { ok: false, reason: back.reason };
  const cycle = validateCycleBinding(o.cycle, `${where}.cycle`);
  if (!cycle.ok) return { ok: false, reason: cycle.reason };
  const commitCenter = validateGestureBinding(o.commitCenter, `${where}.commitCenter`);
  if (!commitCenter.ok) return { ok: false, reason: commitCenter.reason };
  warnUnknownFields(o, KNOWN_NAVIGATION_FIELDS, where);
  return {
    ok: true,
    value: {
      drillIn: drillIn.value,
      back: back.value,
      cycle: cycle.value,
      commitCenter: commitCenter.value,
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
  ];
  for (const [name, gesture] of gestures) {
    for (const input of gesture.inputs) {
      for (const key of inputConflictKeys(input)) {
        const prev = seen.get(key);
        if (prev !== undefined && prev !== name) {
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
}

type SectorValidation = { ok: true; value: MenuSector } | { ok: false; reason: string };

/** Strict structural validator for one sector. Recursive: a sector
 *  with `children` validates each child through the same path, so
 *  arbitrarily nested submenus are checked uniformly up to
 *  :data:`MAX_MENU_DEPTH` levels deep; configs that go past the
 *  cap are rejected with a clear reason instead of overflowing
 *  the recursion stack. `where` is the human-readable path prefix
 *  the caller has built up so error reasons stay traceable across
 *  depths (e.g. `sector 2 child 1 child 0 field "label" must be ...`). */
function validateSector(raw: unknown, where: string, depth = 0): SectorValidation {
  // Reject pathologically nested configs before the recursion
  // walks far enough to overflow the call stack. The cap leaves
  // plenty of headroom over realistic menus and surfaces as a
  // normal validator error instead of a crash on load. The reason
  // names the actual offending depth so a config author can see
  // how far over the cap they went without counting `child` tokens
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
  if (typeof s.label !== 'string' || s.label.trim() === '') {
    return { ok: false, reason: `${where} field "label" must be a non-empty string` };
  }
  const sector: MenuSector = { label: s.label };
  if (s.icon !== undefined) {
    if (typeof s.icon !== 'string')
      return { ok: false, reason: `${where} field "icon" must be a string when present` };
    sector.icon = s.icon;
  }
  // Branch (children) and leaf (binding) are mutually exclusive so
  // the renderer doesn't have to disambiguate which one wins on
  // commit. Rejecting up front means a misconfigured menu fails to
  // load with a clear reason rather than silently behaving as one or
  // the other depending on the renderer's resolution order.
  if (s.binding !== undefined && s.children !== undefined) {
    return {
      ok: false,
      reason: `${where} must declare either "binding" or "children", not both`,
    };
  }
  if (s.binding !== undefined) {
    const result = validateActionRef(s.binding, `${where} binding`);
    if (!result.ok) return { ok: false, reason: result.reason };
    sector.binding = result.value;
  }
  if (s.children !== undefined) {
    if (!Array.isArray(s.children)) {
      return {
        ok: false,
        reason: `${where} field "children" must be an array when present`,
      };
    }
    if (s.children.length === 0) {
      return {
        ok: false,
        reason: `${where} field "children" must not be empty`,
      };
    }
    const children: MenuSector[] = [];
    for (let i = 0; i < s.children.length; i++) {
      const result = validateSector(s.children[i], `${where} child ${i}`, depth + 1);
      if (!result.ok) return { ok: false, reason: result.reason };
      children.push(result.value);
    }
    sector.children = children;
  }
  if (s.keepOpen !== undefined) {
    if (typeof s.keepOpen !== 'boolean') {
      return { ok: false, reason: `${where} field "keepOpen" must be a boolean when present` };
    }
    // Leaf-with-binding only, and only meaningful when true: drop it on a
    // branch, a binding-less (label-only) leaf, or when false so it never
    // persists as a no-op flag. A label-only sector commits to nothing, so
    // keeping the menu open there would strand the user on the Back gesture.
    if (s.keepOpen && sector.children === undefined && sector.binding !== undefined)
      sector.keepOpen = true;
  }
  if (s.activation !== undefined) {
    const result = validateGestureBinding(s.activation, `${where} activation`);
    if (!result.ok) return { ok: false, reason: result.reason };
    // Leaf-with-binding only, and only when it actually binds an input:
    // a branch drills (no binding to fire) and a label-only leaf commits
    // to nothing, so an activation there would be a no-op. Drop it
    // otherwise so it never persists where it can't fire.
    if (
      result.value.inputs.length > 0 &&
      sector.children === undefined &&
      sector.binding !== undefined
    )
      sector.activation = result.value;
  }
  if (s.exit !== undefined) {
    const result = validateGestureBinding(s.exit, `${where} exit`);
    if (!result.ok) return { ok: false, reason: result.reason };
    // Any sector (leaf or branch) can carry an exit, but only when it
    // actually binds an input — drop an empty one so it never persists
    // as a no-op.
    if (result.value.inputs.length > 0) sector.exit = result.value;
  }
  warnUnknownFields(s, KNOWN_MENU_SECTOR_FIELDS, where);
  return { ok: true, value: sector };
}

type CenterValidation = { ok: true; value: MenuCenter } | { ok: false; reason: string };

/** Strict structural validator for the optional center field. Mirrors
 *  the leaf-sector rules (non-empty label, string icon, valid binding)
 *  minus `children` — the center is always a leaf. `label` is optional
 *  here (unlike a sector): omitting it lets the renderer fall back to
 *  the ✕ glyph rather than forcing the user to name the cancel target. */
function validateCenter(raw: unknown, where: string): CenterValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: `${where} must be an object when present` };
  }
  const c = raw as Record<string, unknown>;
  const center: MenuCenter = {};
  if (c.label !== undefined) {
    if (typeof c.label !== 'string' || c.label.trim() === '') {
      return {
        ok: false,
        reason: `${where} field "label" must be a non-empty string when present`,
      };
    }
    center.label = c.label;
  }
  if (c.icon !== undefined) {
    if (typeof c.icon !== 'string') {
      return { ok: false, reason: `${where} field "icon" must be a string when present` };
    }
    center.icon = c.icon;
  }
  if (c.binding !== undefined) {
    const result = validateActionRef(c.binding, `${where} binding`);
    if (!result.ok) return { ok: false, reason: result.reason };
    center.binding = result.value;
  }
  warnUnknownFields(c, KNOWN_CENTER_FIELDS, where);
  return { ok: true, value: center };
}

type ActionRefValidation = { ok: true; value: ActionRef } | { ok: false; reason: string };

function validateActionRef(raw: unknown, where: string): ActionRefValidation {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: `${where} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.action !== 'string' || obj.action.trim() === '') {
    return { ok: false, reason: `${where} field "action" must be a non-empty string` };
  }
  const out: ActionRef = { action: obj.action };
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
  const out: Record<string, unknown> = { action: ref.action };
  if (ref.config !== undefined) out.config = ref.config;
  return out;
}

/** Build a plain object for the center field with a fixed key order,
 *  omitting absent optional fields. */
function orderCenter(center: MenuCenter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (center.label !== undefined) out.label = center.label;
  if (center.icon !== undefined) out.icon = center.icon;
  if (center.binding !== undefined) out.binding = orderActionRef(center.binding);
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
  return {
    drillIn: { inputs: nav.drillIn.inputs.map(orderInput) },
    back: { inputs: nav.back.inputs.map(orderInput) },
    cycle: { inputs: nav.cycle.inputs.map(orderInput), priority: nav.cycle.priority },
    commitCenter: { inputs: nav.commitCenter.inputs.map(orderInput) },
  };
}

/** Build a plain object for one sector with a fixed key order, omitting
 *  absent optional fields. Recursive for nested children. */
function orderSector(sector: MenuSector): Record<string, unknown> {
  const out: Record<string, unknown> = { label: sector.label };
  if (sector.icon !== undefined) out.icon = sector.icon;
  if (sector.binding !== undefined) out.binding = orderActionRef(sector.binding);
  if (sector.keepOpen) out.keepOpen = true;
  if (sector.activation !== undefined)
    out.activation = { inputs: sector.activation.inputs.map(orderInput) };
  if (sector.exit !== undefined) out.exit = { inputs: sector.exit.inputs.map(orderInput) };
  if (sector.children !== undefined) out.children = sector.children.map(orderSector);
  return out;
}

/**
 * Serialize a MenuConfig to the canonical on-disk JSON string.
 *
 * The editor writes back through this so saves are *stable*: the
 * top-level keys, each sector's keys, and each binding's keys are
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
  if (config.axisInvert !== undefined) out.axisInvert = config.axisInvert;
  if (config.centerField !== undefined) out.centerField = orderCenter(config.centerField);
  if (config.navigation !== undefined) out.navigation = orderNavigation(config.navigation);
  out.sectors = config.sectors.map(orderSector);
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

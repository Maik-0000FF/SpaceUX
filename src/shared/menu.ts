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

/** Bumped on every backwards-incompatible schema change. */
export const MENU_CONFIG_VERSION = 1;

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
   *  inside the wedge — keep it 1-2 words so the label fits. */
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
    result.axisInvert = axisInvert;
  }
  return { ok: true, config: result };
}

type SectorValidation = { ok: true; value: MenuSector } | { ok: false; reason: string };

/** Strict structural validator for one sector. Recursive: a sector
 *  with `children` validates each child through the same path, so
 *  arbitrarily nested submenus are checked uniformly. `where` is the
 *  human-readable path prefix the caller has built up so error
 *  reasons stay traceable across depths (e.g.
 *  `sector 2 child 1 child 0 field "label" must be ...`). */
function validateSector(raw: unknown, where: string): SectorValidation {
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
    const r = validateActionRef(s.binding, `${where} binding`);
    if (!r.ok) return { ok: false, reason: r.reason };
    sector.binding = r.value;
  }
  if (s.children !== undefined) {
    if (!Array.isArray(s.children) || s.children.length === 0) {
      return {
        ok: false,
        reason: `${where} field "children" must be a non-empty array when present`,
      };
    }
    const children: MenuSector[] = [];
    for (let i = 0; i < s.children.length; i++) {
      const r = validateSector(s.children[i], `${where} child ${i}`);
      if (!r.ok) return { ok: false, reason: r.reason };
      children.push(r.value);
    }
    sector.children = children;
  }
  return { ok: true, value: sector };
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
  return { ok: true, value: out };
}

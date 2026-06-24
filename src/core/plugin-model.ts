// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The plugin-manager UI models (#457 C5): everything the manager list, the
 * import-consent dialog, the remove confirm and the two shape pickers render
 * comes out of these builders ready-to-display (badges, chips, tooltips,
 * dialog copy). The editor calls them over D-Bus and renders dumbly,
 * so the wording and the badge/chip semantics live here once.
 */

import type {
  PieAppearance,
  PluginInfo,
  PluginKind,
  PluginPickResult,
  PluginsState,
  PluginUsageReport,
} from '../shared/ipc.js';
import { resolveShapeModel, type MenuConfig } from '../shared/menu.js';
import { formatPluginKey } from '../shared/plugin-key.js';
import { PLUGIN_KINDS, type PluginPermission } from '../shared/plugin-types.js';
import type {
  PluginBadge,
  PluginConsentModel,
  PluginItemModel,
  PluginManagerUiModel,
  PluginRemovalModel,
  ShapeOption,
  ShapeSelectsModel,
} from '../shared/plugin-ui.js';

import { features } from './plugin-features.js';

// ── Copy (the one place the wording lives) ───────────────────────────────────

const KIND_HEADING: Record<PluginKind, string> = {
  function: 'Function',
  theme: 'Theme',
  'nav-style': 'Navigation-style',
  shape: 'Shape',
};

/** Hover-help per plugin kind (the manager's kind badge). */
const KIND_TOOLTIPS: Record<PluginKind, string> = {
  function: 'Adds runnable actions, menus or app integrations.',
  theme: 'Adds a pie colour theme.',
  'nav-style': 'Adds navigation-style presets (gesture bundles).',
  shape: 'Adds a pie shape model (how the sectors are drawn).',
};

const PERMISSION_TOOLTIPS: Record<PluginPermission, string> = {
  exec: 'Can run external programs.',
  network: 'Can access the network and open sockets.',
  filesystem: 'Can read and write files outside its own data folder.',
  'inject-keys': 'Can synthesise keyboard input.',
};

const IMPORTED_BADGE: PluginBadge = {
  label: 'Imported',
  style: 'imported',
  tooltip: 'Imported by you. It runs with your privileges, so review what you enable.',
};
const BUILTIN_BADGE: PluginBadge = {
  label: 'Built-in',
  style: 'builtin',
  tooltip: 'Bundled with SpaceUX (loaded from a system folder or the project), not user-imported.',
};
const VERIFIED_BADGE: PluginBadge = {
  label: 'Verified',
  style: 'verified',
  tooltip: "Verified: this plugin's content matches the version shipped by the SpaceUX project.",
};
const UNVERIFIED_BADGE: PluginBadge = {
  label: 'Unverified',
  style: 'unverified',
  tooltip:
    'Claims an official id but its content does not match the shipped version, so it may be tampered or impersonating. Treat as untrusted.',
};
const COMMUNITY_BADGE: PluginBadge = {
  label: 'Community',
  style: 'community',
  tooltip:
    'A third-party community plugin, not verified against an official version. Review what you enable.',
};

const REMOVE_DISABLED_TOOLTIP =
  'Bundled with the app (loaded from the project or a system folder), not removable here.';
const PERMISSIONS_LABEL = 'Permissions';
const IMPORT_LABEL = 'Import plugin…';
const EMPTY_TEXT = 'No plugins installed yet.';
const ERRORS_HEADING = 'Could not load';
const CONSENT_WARN =
  'Claims an official id but its content does not match, so it may be tampered or impersonating.';
const CONSENT_MESSAGE =
  'Install it only if you trust the source. Permissions are declared by the plugin and not yet enforced.';

/** Cap the usage list in the remove confirm so many profiles can't push the
 *  buttons offscreen; the count still reflects the total. */
const MAX_MENU_LINES = 6;

// ── The manager list ─────────────────────────────────────────────────────────

function trustBadge(trust: PluginInfo['trust']): PluginBadge | null {
  if (trust === 'verified') return VERIFIED_BADGE;
  if (trust === 'mismatch') return UNVERIFIED_BADGE;
  if (trust === 'community') return COMMUNITY_BADGE;
  return null;
}

function itemModel(p: PluginInfo): PluginItemModel {
  const badges: PluginBadge[] = [
    { label: p.kind, style: 'kind', tooltip: KIND_TOOLTIPS[p.kind] },
    p.removable ? IMPORTED_BADGE : BUILTIN_BADGE,
  ];
  const trust = trustBadge(p.trust);
  if (trust) badges.push(trust);
  return {
    kind: p.kind,
    id: p.id,
    name: p.name,
    removable: p.removable,
    badges,
    features: features(p).map((f) => ({ label: f.label, tooltip: f.tip })),
    permissions: p.permissions.map((c) => ({ label: c, tooltip: PERMISSION_TOOLTIPS[c] })),
    meta: `${p.id} · v${p.version}`,
    removeTooltip: p.removable ? null : REMOVE_DISABLED_TOOLTIP,
  };
}

/** The whole manager list model: kind sections in canonical order (empty kinds
 *  collapse out), per-item badges/chips, and the load errors. */
export function inspectPluginManager(state: PluginsState): PluginManagerUiModel {
  return {
    importLabel: IMPORT_LABEL,
    emptyText: EMPTY_TEXT,
    sections: PLUGIN_KINDS.flatMap((kind) => {
      const items = state.plugins.filter((p) => p.kind === kind).map(itemModel);
      return items.length > 0 ? [{ heading: KIND_HEADING[kind], items }] : [];
    }),
    errorsHeading: ERRORS_HEADING,
    errors: state.errors.map((e) => ({ dir: e.dir, reason: e.reason })),
  };
}

// ── The import-consent dialog ────────────────────────────────────────────────

/**
 * The consent dialog for a picked plugin, or null when none is needed (no
 * declared permissions and the content verifies). An impersonator (`mismatch`)
 * warns even with no permissions and styles the confirm destructive.
 */
export function inspectPluginConsent(picked: PluginPickResult): PluginConsentModel {
  if (picked.ok !== true) return null;
  const isImpersonator = picked.trust === 'mismatch';
  if (picked.permissions.length === 0 && !isImpersonator) return null;
  return {
    title: `Install "${picked.name}"?`,
    badge: trustBadge(picked.trust),
    warn: isImpersonator ? CONSENT_WARN : null,
    permissionsLabel: PERMISSIONS_LABEL,
    permissions: [...picked.permissions],
    message: CONSENT_MESSAGE,
    confirmLabel: 'Install',
    destructive: isImpersonator,
  };
}

// ── The remove confirm ───────────────────────────────────────────────────────

/** The remove-confirm content, with the usage scan folded into the message
 *  (null scan = the scan failed; the plain single-line message stands). */
export function inspectPluginRemoval(
  name: string,
  usages: PluginUsageReport | null,
): PluginRemovalModel {
  const lines = [`Remove "${name}"? This deletes its installed files.`];
  if (usages !== null && (usages.menus.length > 0 || usages.globalAppearance)) {
    lines.push('', 'Currently used by:');
    const head = usages.menus.slice(0, MAX_MENU_LINES);
    for (const m of head) lines.push(`• ${m}`);
    if (usages.menus.length > head.length) {
      lines.push(`• …and ${usages.menus.length - head.length} more`);
    }
    if (usages.globalAppearance) {
      lines.push('• Global appearance (will fall back to the host default)');
    }
  }
  return {
    title: 'Remove plugin?',
    message: lines.join('\n'),
    confirmLabel: 'Remove',
    destructive: true,
  };
}

// ── The shape pickers ────────────────────────────────────────────────────────

/** The dropdown value for "Wedge (built-in default)" and the per-menu
 *  inherit sentinel (no slash, so it can't collide with a namespaced
 *  `<pluginId>/<shapeId>` key). */
export const SHAPE_WEDGE_VALUE = '';
export const SHAPE_INHERIT_VALUE = '__inherit__';
const FROM_PLUGINS_GROUP = 'From plugins';

type PluginShape = { key: string; label: string; description: string };

function pluginShapes(state: PluginsState): PluginShape[] {
  return state.plugins.flatMap((p) =>
    p.kind === 'shape' && p.shape
      ? [
          {
            key: formatPluginKey(p.id, p.shape.id),
            // The plugin name disambiguates two plugins shipping the same shape
            // label; suppressed when it duplicates the label (the common
            // single-shape-per-plugin case).
            label:
              p.name && p.name !== p.shape.label ? `${p.shape.label} · ${p.name}` : p.shape.label,
            description: p.shape.description,
          },
        ]
      : [],
  );
}

/** Both shape pickers' models: the app-level appearance picker and the
 *  per-menu three-state override, sharing one plugin-shape list. */
export function inspectShapeSelects(
  state: PluginsState,
  appearance: PieAppearance,
  config: MenuConfig,
): ShapeSelectsModel {
  const shapes = pluginShapes(state);
  const fromPlugins: ShapeOption[] = shapes.map((s) => ({
    value: s.key,
    label: s.label,
    description: s.description,
    group: FROM_PLUGINS_GROUP,
  }));

  // App-level picker (the appearance default).
  const appValue = appearance.shapeModel ?? SHAPE_WEDGE_VALUE;
  const appUnknown = appValue !== SHAPE_WEDGE_VALUE && !shapes.some((s) => s.key === appValue);
  const appearanceOptions: ShapeOption[] = [
    {
      value: SHAPE_WEDGE_VALUE,
      label: 'Wedges',
      description: 'Render the pie as the built-in wedge slices (default).',
    },
    ...fromPlugins,
    // Orphan: keep the saved-but-uninstalled reference visible + non-selectable
    // instead of silently snapping the user back to wedge.
    ...(appUnknown
      ? [
          {
            value: appValue,
            label: `(unknown: ${appValue})`,
            description: `Plugin not installed: ${appValue}. The pie renders as wedge until you install it.`,
            disabled: true,
          },
        ]
      : []),
  ];

  // Per-menu override (three-state: inherit / wedge / plugin shape).
  const shapeModel = config.shapeModel;
  const menuValue =
    shapeModel === undefined
      ? SHAPE_INHERIT_VALUE
      : shapeModel === null
        ? SHAPE_WEDGE_VALUE
        : shapeModel;
  const inherited = resolveShapeModel(undefined, appearance.shapeModel ?? null);
  const inheritedLabel =
    inherited === null
      ? 'Wedges'
      : (shapes.find((s) => s.key === inherited)?.label ?? `unknown: ${inherited}`);
  const menuUnknown =
    typeof shapeModel === 'string' && shapes.find((s) => s.key === shapeModel) === undefined;
  const menuOptions: ShapeOption[] = [
    {
      value: SHAPE_INHERIT_VALUE,
      label: `Inherit (app default: ${inheritedLabel})`,
      description: `This menu inherits the app shape model (${inheritedLabel}). Override only if a specific menu needs a different shape.`,
    },
    {
      value: SHAPE_WEDGE_VALUE,
      label: 'Wedges',
      description:
        'This menu always renders as the built-in wedge slices, regardless of the app shape model.',
    },
    ...fromPlugins,
    ...(menuUnknown
      ? [
          {
            value: menuValue,
            label: `(unknown: ${menuValue})`,
            description: `Plugin not installed: ${menuValue}. This menu renders as wedge until you install it.`,
            disabled: true,
          },
        ]
      : []),
  ];
  const tooltip =
    menuValue === SHAPE_INHERIT_VALUE
      ? menuOptions[0]!.description
      : (menuOptions.find((o) => o.value === menuValue)?.description ??
        'This menu uses the selected plugin shape, regardless of the app shape model.');

  return {
    appearance: { value: appValue, options: appearanceOptions },
    menu: {
      value: menuValue,
      options: menuOptions,
      note: 'Override the app shape model for this menu only. Inherit follows the design bar.',
      tooltip,
    },
  };
}

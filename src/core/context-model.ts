// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The catalog/context UI models (#457 C5 part 2): everything the plugin source
 * controls (Dynamic | Curated, #193), the active-context header (#229), the
 * read-only banner and the command palette (#76 D2b) render comes out of
 * `inspectSourceState` / `inspectPalette` ready-to-display. The editor calls
 * them over D-Bus and renders dumbly; the id schemes (`plugin:<id>`,
 * `ctx:<id>:<key>`) and every wording live here once.
 */

import type {
  CatalogSnapshot,
  ContextOptionModel,
  DeviceBarModel,
  PaletteModel,
  SourceControlsModel,
  SourceStateModel,
} from '../shared/context-ui.js';
import type { EditorDeviceInfo, ProfilesState } from '../shared/ipc.js';
import {
  PLUGIN_MENU_ID_PREFIX,
  contextKeyToLabel,
  isContextMenuId,
  isPluginMenuId,
  makeContextMenuId,
  parseContextMenuId,
} from '../shared/plugin-types.js';

import { flattenCatalogCommands } from './catalog-filter.js';

// ── Copy (the one place the wording lives) ───────────────────────────────────

const READONLY_BANNER =
  'This pie is provided by a plugin and is read-only; its content follows the live app. Switch the active source to edit your own pie.';
const SWITCH_TO_AUTO_LABEL = 'Switch to Auto';
const SWITCH_TO_AUTO_TOOLTIP =
  'Back to the editable source: the device profile, or the default menu.';
const PALETTE_READONLY_NOTE =
  'The active pie is provided by a plugin and is read-only; switch the active source to add commands.';
const PALETTE_ADD_READONLY = 'The active pie is read-only (plugin-provided)';

// ── The source state (controls + header + read-only) ────────────────────────

/** The active curated context key of `pluginId`, or null. */
function activeContextOf(profileId: string | null, pluginId: string): string | null {
  if (!isContextMenuId(profileId)) return null;
  const parsed = parseContextMenuId(profileId);
  return parsed && parsed.pluginId === pluginId ? parsed.contextKey : null;
}

function sourceControls(
  catalog: CatalogSnapshot,
  contextIds: string[],
  profileId: string | null,
): SourceControlsModel | null {
  const plugin = catalog.plugin;
  if (!plugin) return null;
  const noun = plugin.contextLabel;
  const lowerNoun = noun.toLowerCase();
  const dynamicId = `${PLUGIN_MENU_ID_PREFIX}${plugin.id}`;

  // The selectable contexts: catalog groups (display name + icon), merged with
  // any curated-but-not-in-catalog context (bridge offline: label from the key).
  const byKey = new Map<string, ContextOptionModel>();
  for (const g of catalog.groups) {
    const id = makeContextMenuId(plugin.id, g.key);
    byKey.set(g.key, {
      key: g.key,
      label: g.name,
      id,
      curated: contextIds.includes(id),
      icon: g.icon,
    });
  }
  for (const id of contextIds) {
    const parsed = parseContextMenuId(id);
    if (parsed && parsed.pluginId === plugin.id && !byKey.has(parsed.contextKey)) {
      byKey.set(parsed.contextKey, {
        key: parsed.contextKey,
        label: contextKeyToLabel(parsed.contextKey),
        id,
        curated: true,
      });
    }
  }
  const contexts = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));

  return {
    title: `${plugin.name} pie`,
    dynamicId,
    dynamicLabel: 'Dynamic',
    dynamicTooltip: `Live pie that follows ${plugin.name}'s active ${lowerNoun} (read-only)`,
    curatedLabel: 'Curated',
    curatedTooltip: `Your own editable pie per ${lowerNoun}`,
    isDynamic: profileId === dynamicId,
    activeContextKey: activeContextOf(profileId, plugin.id),
    contexts,
    noun,
    pickerPlaceholder: `Select a ${lowerNoun}…`,
    loadAllLabel: 'Load all',
    loadAllTooltip: `Activate every ${lowerNoun} in ${plugin.name} so all are listed (briefly cycles the GUI)`,
    emptyNote: `No ${lowerNoun} available. Start ${plugin.name} with the bridge addon, or use "Load all".`,
    reseedLabel: 'Re-seed',
    reseedTooltip: `Rebuild this curated pie from the live ${lowerNoun} (discards your edits)`,
    reseedConfirm: {
      title: 'Re-seed pie?',
      message: `Rebuild this curated pie from the live ${lowerNoun}? This discards your edits.`,
      confirmLabel: 'Re-seed',
      destructive: true,
    },
    deleteLabel: 'Delete',
    deleteTooltip: 'Delete this curated pie',
    deleteConfirm: {
      title: 'Delete pie?',
      message: 'Delete this curated pie?',
      confirmLabel: 'Delete',
      destructive: true,
    },
    reseedSuccess: 'Curated pie re-seeded.',
    deleteSuccess: 'Curated pie deleted.',
    hasBridge: plugin.hasBridge,
  };
}

/**
 * The whole left-column source UI in one call: the read-only flag + banner
 * (the active source is a plugin-provided menu), the plugin source controls
 * (null without a catalog plugin), and the active-context header (#229).
 */
export function inspectSourceState(
  catalog: CatalogSnapshot,
  contextIds: string[],
  profileId: string | null,
): SourceStateModel {
  const readOnly = isPluginMenuId(profileId);
  const source = sourceControls(catalog, contextIds, profileId);

  let header: SourceStateModel['header'] = null;
  if (catalog.plugin) {
    const key = activeContextOf(profileId, catalog.plugin.id);
    if (key !== null) {
      const group = catalog.groups.find((g) => g.key === key);
      header = {
        icon: group?.icon ?? null,
        label: group?.name ?? contextKeyToLabel(key),
      };
    }
  }

  return {
    readOnly,
    banner: readOnly
      ? {
          text: READONLY_BANNER,
          switchLabel: SWITCH_TO_AUTO_LABEL,
          switchTooltip: SWITCH_TO_AUTO_TOOLTIP,
        }
      : null,
    source,
    header,
  };
}

// ── The command palette ──────────────────────────────────────────────────────

/**
 * The palette model (#76 D2b): the active catalog plugin's commands, expanded
 * and sanitised (groups scoped to the active curated context). The editor
 * filters the search query locally per keystroke; `enabledOnly` re-fetches the
 * catalog before this call so the live `enabled` flags are current (#217).
 * Null without a catalog plugin.
 */
export function inspectPalette(
  catalog: CatalogSnapshot,
  profileId: string | null,
  enabledOnly: boolean,
): PaletteModel {
  const plugin = catalog.plugin;
  if (!plugin) return null;
  const lowerNoun = plugin.contextLabel.toLowerCase();
  const readOnly = isPluginMenuId(profileId);
  const scopeKey = activeContextOf(profileId, plugin.id);
  const groups = flattenCatalogCommands(catalog.groups, { scopeKey, query: '', enabledOnly });

  const note = readOnly
    ? PALETTE_READONLY_NOTE
    : catalog.status === 'error'
      ? `No commands: ${catalog.reason}. Is ${plugin.name} running with the bridge addon?`
      : null;

  return {
    title: `${plugin.name} commands`,
    runActionId: `${plugin.id}/run`,
    enabledOnlyLabel: 'Usable now',
    enabledOnlyTooltip: `Show only commands currently usable in ${plugin.name} (refreshes from the live state)`,
    loadAllLabel: 'Load all',
    loadAllTooltip: `Activate every ${lowerNoun} in ${plugin.name} to list all commands (briefly cycles the GUI)`,
    searchPlaceholder: 'Search commands…',
    busy: catalog.status === 'loading',
    toastLoading: 'Loading commands…',
    toastLoaded: 'Commands loaded.',
    note,
    addTooltip: readOnly ? PALETTE_ADD_READONLY : 'Add to the current ring',
    addDisabled: readOnly,
    groups,
    emptyNote: 'No matching commands.',
  };
}

// ── The device/profile toolbar (#113, D1) ────────────────────────────────────

const AUTO_VALUE = '';
/** Sentinel for the disabled "set it in the plugin panel" hint (#209); can't
 *  collide with AUTO, a profile id or a plugin menu id. */
const CATALOG_HINT = '__catalog_source_hint__';

function hex4(n: number): string {
  return (n & 0xffff).toString(16).padStart(4, '0');
}

/**
 * The toolbar device/profile bar, mirroring DeviceStatus + ProfileControls:
 * the read-only connected-device + active-profile status, and the override
 * dropdown (Auto, the catalog plugin's panel hint, device profiles, other
 * plugin menus) with Save/Delete states, confirms and toast copy.
 */
export function inspectDeviceBar(
  profiles: ProfilesState,
  device: EditorDeviceInfo,
  catalog: CatalogSnapshot,
): DeviceBarModel {
  const connected = device.vendor !== 0 || device.product !== 0;
  const daemonUp = device.daemonConnected === true;
  const status = connected
    ? ('ok' as const)
    : daemonUp
      ? ('no-device' as const)
      : ('no-daemon' as const);
  const vidPid = `${hex4(device.vendor)}:${hex4(device.product)}`;
  const deviceLabel = connected ? device.name || vidPid : daemonUp ? 'No device' : 'Daemon off';
  const deviceName = device.name || 'this device';
  const override = profiles.override;

  // The catalog plugin owns its Dynamic/Curated choice in the source panel
  // (#193/#209): its plugin: entry is dropped here, and a disabled hint points
  // at that panel (doubling as the shown value while such a source is active).
  const catalogName = catalog.plugin?.name || 'Plugin';
  const dynamicId = catalog.plugin ? `${PLUGIN_MENU_ID_PREFIX}${catalog.plugin.id}` : null;
  const onCatalogSource =
    override !== null &&
    catalog.plugin !== null &&
    (override === dynamicId || parseContextMenuId(override)?.pluginId === catalog.plugin.id);

  const options: DeviceBarModel['options'] = [
    { value: AUTO_VALUE, label: 'Auto' },
    ...(catalog.plugin
      ? [
          {
            value: onCatalogSource && override !== null ? override : CATALOG_HINT,
            label: `${catalogName} pie (set in the panel at top-left)`,
            description: `The ${catalogName} pie (Dynamic or Curated) is chosen in the ${catalogName} panel at the top of the left column, not in this dropdown.`,
            disabled: true,
          },
        ]
      : []),
    ...profiles.ids.map((id) => ({ value: id, label: id })),
    ...profiles.pluginMenus
      .filter((m) => m.id !== dynamicId)
      .map((m) => ({ value: m.id, label: m.name, group: 'Plugin menus' })),
  ];

  const overrideIsPluginMenu = isPluginMenuId(override);
  const activeProfile = device.profileId;
  const deleteBlocked =
    activeProfile === null || isPluginMenuId(activeProfile) || isContextMenuId(activeProfile);

  return {
    status,
    connected,
    deviceLabel,
    deviceTooltip: connected
      ? `${vidPid} · profile: ${device.profileId ?? 'Default'}`
      : daemonUp
        ? 'The daemon is running but no SpaceMouse is connected. Check the cable or the wireless receiver.'
        : 'The SpaceMouse daemon is not running, so no device can be detected. Start spaceux-daemon.',
    options,
    value: override ?? AUTO_VALUE,
    selectTooltip: 'Which profile drives the live config (Auto = follow the connected device)',
    saveLabel: 'Save',
    saveEnabled: connected && !overrideIsPluginMenu,
    saveTooltip: overrideIsPluginMenu
      ? 'A plugin menu is active, so Save/Delete apply to device profiles'
      : connected
        ? "Save the current config as this device's profile"
        : 'Connect a device to save a profile for it',
    saveSuccess:
      override === null
        ? `Saved profile for ${deviceName}.`
        : `Saved profile for ${deviceName}; still showing ${override}.`,
    deleteLabel: 'Delete',
    deleteEnabled: !deleteBlocked,
    deleteTooltip:
      activeProfile === null
        ? 'No profile is active to delete'
        : isPluginMenuId(activeProfile)
          ? 'Uninstall plugin menus in the Plugins manager, not here'
          : isContextMenuId(activeProfile)
            ? 'Delete curated pies in the source panel at the top-left, not here'
            : `Delete the active profile (${activeProfile})`,
    deleteConfirm: {
      title: 'Delete profile?',
      message: `Delete the active profile (${activeProfile ?? ''})?`,
      confirmLabel: 'Delete',
      destructive: true,
    },
    deleteSuccess: `Deleted profile ${activeProfile ?? ''}.`,
    deleteTarget: deleteBlocked ? null : activeProfile,
  };
}

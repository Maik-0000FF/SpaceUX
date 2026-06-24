// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire types of the catalog/context UI models (#457 C5 part 2): what the
 * core's `InspectSourceState` / `InspectPalette` return. Declared in shared
 * (the dependency leaf) so the core contract can reference them; the builders
 * live in `core/context-model.ts`.
 */

import type { PluginCatalogGroup } from './plugin-types.js';

/** A flat, sanitised command ready to drop into the palette UI. Declared here
 *  (the dependency leaf) so the contract can carry it; the flatten transform
 *  lives in core/catalog-filter.ts. */
export type PaletteCommand = { command: string; label: string; icon?: string };

/** A palette group (a catalog group / context) with its commands already
 *  flattened, filtered and sanitised. */
export type PaletteGroup = { key: string; name: string; commands: PaletteCommand[] };

/** What the editor passes back into the inspects: the catalog it pulled
 *  (plugin identity + groups + pull status), so the core stays stateless. */
export type CatalogSnapshot = {
  /** The loaded catalog plugin, or null when none is installed. */
  plugin: { id: string; name: string; contextLabel: string; hasBridge: boolean } | null;
  status: 'idle' | 'loading' | 'error' | 'ready';
  reason: string | null;
  groups: PluginCatalogGroup[];
};

export type ContextOptionModel = {
  key: string;
  label: string;
  /** The curated pie's override id (`ctx:<pluginId>:<key>`), built core-side
   *  so the editor never assembles id schemes. */
  id: string;
  /** Already curated (the ● marker in the picker; activate without seeding). */
  curated: boolean;
  icon?: string;
};

export type SourceControlsModel = {
  title: string;
  /** The override id the Dynamic segment activates (`plugin:<id>`). */
  dynamicId: string;
  dynamicLabel: string;
  dynamicTooltip: string;
  curatedLabel: string;
  curatedTooltip: string;
  /** True while the dynamic source is active. */
  isDynamic: boolean;
  /** The active curated context key of THIS plugin, or null. */
  activeContextKey: string | null;
  contexts: ContextOptionModel[];
  /** The plugin's singular noun for a context ("Workbench"). */
  noun: string;
  pickerPlaceholder: string;
  loadAllLabel: string;
  loadAllTooltip: string;
  /** Shown when curated mode is open but no contexts are known. */
  emptyNote: string;
  reseedLabel: string;
  reseedTooltip: string;
  reseedConfirm: { title: string; message: string; confirmLabel: string; destructive: boolean };
  deleteLabel: string;
  deleteTooltip: string;
  deleteConfirm: { title: string; message: string; confirmLabel: string; destructive: boolean };
  reseedSuccess: string;
  deleteSuccess: string;
  hasBridge: boolean;
};

export type SourceStateModel = {
  /** The active source is a plugin-provided (read-only) menu. */
  readOnly: boolean;
  /** The read-only banner, or null. */
  banner: { text: string; switchLabel: string; switchTooltip: string } | null;
  /** The source controls, or null when no catalog plugin is loaded. */
  source: SourceControlsModel | null;
  /** The active-context header above the tree, or null. */
  header: { icon: string | null; label: string } | null;
};

export type PaletteModel = {
  title: string;
  /** The action id a palette add binds (`<pluginId>/run`). */
  runActionId: string;
  enabledOnlyLabel: string;
  enabledOnlyTooltip: string;
  loadAllLabel: string;
  loadAllTooltip: string;
  searchPlaceholder: string;
  /** True while a catalog pull runs (disables Load all / Usable now). */
  busy: boolean;
  /** Load-all feedback, raised as toasts (like the plugin-install flow) so the
   *  palette's geometry never changes while loading. */
  toastLoading: string;
  toastLoaded: string;
  /** Persistent-state note (error / read-only), or null. Loading is NOT a
   *  note: it would resize the palette on every fetch. */
  note: string | null;
  /** Hover help for an add button (read-only swaps the wording). */
  addTooltip: string;
  addDisabled: boolean;
  /** The expanded, sanitised commands; the editor filters the query locally. */
  groups: PaletteGroup[];
  /** Shown when groups filter down to nothing. */
  emptyNote: string;
} | null;

/** The toolbar device/profile bar (#113, #457 D1): the read-only device
 *  status plus the profile-override controls, worded core-side. */
export type DeviceBarModel = {
  /** The status dot: ok (device connected) / no-device (daemon up, nothing
   *  attached) / no-daemon (the daemon socket is down or unknown). */
  status: 'ok' | 'no-device' | 'no-daemon';
  /** A device is connected (drives the controls' enable states). */
  connected: boolean;
  /** "Device <name|vid:pid|No device>" parts + the vid:pid hover detail. */
  deviceLabel: string;
  deviceTooltip: string;
  /** The override dropdown: Auto + (catalog hint) + profiles + plugin menus. */
  options: {
    value: string;
    label: string;
    description?: string;
    group?: string;
    disabled?: boolean;
  }[];
  value: string;
  selectTooltip: string;
  saveLabel: string;
  saveEnabled: boolean;
  saveTooltip: string;
  /** Toast for a successful save (the overridden variant when one is live). */
  saveSuccess: string;
  deleteLabel: string;
  deleteEnabled: boolean;
  deleteTooltip: string;
  deleteConfirm: { title: string; message: string; confirmLabel: string; destructive: boolean };
  deleteSuccess: string;
  /** The active profile id Delete targets, or null. */
  deleteTarget: string | null;
};

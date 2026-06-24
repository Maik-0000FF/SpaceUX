// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire types of the plugin-manager UI models (#457 C5): what the core's
 * `InspectPluginManager` / `InspectPluginConsent` / `InspectPluginRemoval` /
 * `InspectShapeSelects` return. Declared in shared (the dependency leaf) so
 * the core contract can reference them; the builders live in
 * `core/plugin-model.ts`.
 */

/** A small labelled badge with hover help. `style` picks the visual variant
 *  (the manager's trust/origin colours); the editor renders, the core words. */
export type PluginBadge = {
  label: string;
  style: 'imported' | 'builtin' | 'verified' | 'unverified' | 'community' | 'kind';
  tooltip: string;
};

/** A feature/permission chip with hover help. */
export type PluginChip = { label: string; tooltip: string };

export type PluginItemModel = {
  kind: string;
  id: string;
  name: string;
  removable: boolean;
  badges: PluginBadge[];
  features: PluginChip[];
  permissions: PluginChip[];
  /** The id + version meta line. */
  meta: string;
  /** Hover help on a disabled Remove (bundled plugins), null when removable. */
  removeTooltip: string | null;
};

export type PluginManagerUiModel = {
  importLabel: string;
  emptyText: string;
  /** One section per plugin kind that has plugins, in canonical kind order. */
  sections: { heading: string; items: PluginItemModel[] }[];
  errorsHeading: string;
  errors: { dir: string; reason: string }[];
};

/** The import-consent dialog content, or null when no consent is needed (no
 *  declared permissions and the content verifies). */
export type PluginConsentModel = {
  title: string;
  badge: PluginBadge | null;
  /** The impersonator warning line, when the content check failed. */
  warn: string | null;
  permissionsLabel: string;
  permissions: string[];
  message: string;
  confirmLabel: string;
  destructive: boolean;
} | null;

/** The remove-confirm dialog content (usage scan folded into the message). */
export type PluginRemovalModel = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
};

/** One shape-picker option (both pickers share the shape). */
export type ShapeOption = {
  value: string;
  label: string;
  description: string;
  group?: string;
  disabled?: boolean;
};

export type ShapeSelectsModel = {
  /** The app-level picker (PieShapeSelect): wedge default + plugin shapes +
   *  a disabled orphan entry when the saved value isn't installed. */
  appearance: { value: string; options: ShapeOption[] };
  /** The per-menu override picker (MenuShapeSelect): three-state
   *  inherit/wedge/plugin via sentinels, with the inherited default named. */
  menu: { value: string; options: ShapeOption[]; note: string; tooltip: string };
};

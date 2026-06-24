// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The remaining core-service methods that the A2a slices (app / editor /
 * profile) don't cover (#457 A2c): the pie scene builder, the icon encode /
 * resolve and the action-path check, and `SetLive`. They are thin wrappers over
 * existing pure helpers, so the core assembles a complete `CoreService`
 * (every contract method implemented).
 */

import { buildOverlaySvgScene } from '../core/overlay-svg.js';
import {
  actionFillKind,
  actionTargetKind,
  addItem,
  addNode,
  applyActionPick,
  deleteOrCollapseNode,
  isDefaultItemLabel,
  moveNode,
  moveNodeBetween,
  moveTargetRings,
  nextSelectionAfterDelete,
  nodeAt,
  quoteCommandPath,
  setNodeKind,
} from '../core/menu-edit.js';
import { actionPathHint } from '../core/action-path.js';
import { inspectDeviceBar, inspectPalette, inspectSourceState } from '../core/context-model.js';
import { editDesktopSettings, inspectDesktopSettings } from '../core/desktop-model.js';
import { editNavigation, inspectNavInput, navEditTouchesNavigation } from '../core/nav-model.js';
import {
  inspectPluginConsent,
  inspectPluginManager,
  inspectPluginRemoval,
  inspectShapeSelects,
} from '../core/plugin-model.js';
import { DEFAULT_TRIGGER_BUTTON, MAX_MENU_DEPTH, type MenuConfig } from '../shared/menu.js';
import type { ShapePluginModule } from '../shared/shape-plugin-api.js';
import type { PieAppearance } from '../shared/ipc.js';
import {
  BUNDLED_FONT_UI_LABEL,
  SYSTEM_FONT_UI,
  PIE_BALANCE_MAX,
  PIE_BALANCE_MIN,
  PIE_BALANCE_STEP,
  PIE_ICON_SCALE_MAX,
  PIE_ICON_SCALE_MIN,
  PIE_ICON_SCALE_STEP,
  PIE_LABEL_SCALE_MAX,
  PIE_LABEL_SCALE_MIN,
  PIE_LABEL_SCALE_STEP,
  PIE_OPACITY_MAX,
  PIE_OPACITY_MIN,
  PIE_OPACITY_STEP,
  PIE_SCALE_MAX,
  PIE_SCALE_MIN,
  PIE_SCALE_STEP,
  PIE_WEDGE_GAP_MAX,
  PIE_WEDGE_GAP_MIN,
  PIE_WEDGE_GAP_STEP,
  PIE_WEDGE_HOVER_MAX,
  PIE_WEDGE_HOVER_MIN,
  PIE_WEDGE_HOVER_STEP,
} from '../shared/pie-appearance.js';
import type { CoreService } from '../main/core-service.js';
import {
  resolveActionFill,
  resolveActionIcon,
  type ActionIconKind,
  type FileActionKind,
} from '../main/action-icon.js';
import { checkActionPath } from '../main/action-path-check.js';
import { encodeIconFile } from '../main/icon-encode.js';
import { pluginTrust } from '../main/plugin-hash.js';
import { readPluginManifest } from '../main/plugin-loader.js';
import type { HostEnvironment } from '../shared/plugin-types.js';

export type ExtraCoreService = Pick<
  CoreService,
  | 'BuildScene'
  | 'ApplyActionPick'
  | 'SetNodeKind'
  | 'AddNode'
  | 'AddItem'
  | 'DeleteNode'
  | 'MoveNode'
  | 'MoveNodeBetween'
  | 'GetMoveTargets'
  | 'InspectNavInput'
  | 'EditNavInput'
  | 'InspectDesktopSettings'
  | 'EditDesktopSettings'
  | 'InspectPluginManager'
  | 'InspectPluginConsent'
  | 'InspectPluginRemoval'
  | 'InspectShapeSelects'
  | 'InspectSourceState'
  | 'InspectPalette'
  | 'InspectDeviceBar'
  | 'GetMenuLimits'
  | 'SetActionTarget'
  | 'SetActionConfig'
  | 'InspectActionPath'
  | 'GetAppearanceRanges'
  | 'GetFontPresets'
  | 'EncodeIcon'
  | 'InspectPlugin'
  | 'ResolveActionIcon'
  | 'CheckActionPath'
  | 'SetLive'
  | 'SetLiveView'
>;

export function createExtraCoreService(deps: {
  hostEnvironment: HostEnvironment;
  /** The active shape plugin's module for a scene build (per-menu override
   *  resolved against the appearance default), or null for the wedge. */
  shapeModule?: (
    config: MenuConfig,
    appearance: PieAppearance,
  ) => Promise<ShapePluginModule | null>;
  /** The core-side live preview (D5); absent in tests that don't exercise it. */
  live?: { setLive: (on: boolean, focused: boolean) => void; setView: (nav: number[]) => void };
}): ExtraCoreService {
  // The config key each fillable action reads its target from: exec a command,
  // open-file a path, key-combo the chord. One source of truth for the mapping.
  const FILL_CONFIG_KEY: Record<ActionIconKind, string> = {
    exec: 'command',
    'open-file': 'path',
    'key-combo': 'keys',
  };

  // The target a node's action config currently points at (command / path /
  // chord), or ''.
  const targetOf = (cfg: Record<string, unknown> | undefined, kind: ActionIconKind): string => {
    const v = cfg?.[FILL_CONFIG_KEY[kind]];
    return typeof v === 'string' ? v : '';
  };

  // Auto-fill a node's icon + label from an exec/open-file/key-combo target,
  // filling the program icon + name (#390, #419) or the keysym icon + short
  // label, e.g. "Mute" (#511). When
  // `targetChanged` (the program/file/chord the item points at actually changed),
  // the new target takes precedence and overwrites the icon + label even if they
  // were set manually, so re-pointing an item re-identifies it. Otherwise only an
  // auto-resolved, empty, or still-default value is filled, so a label/icon the
  // user typed or picked while keeping the same target survives. Shared by
  // SetActionTarget (a picked file) and SetActionConfig (a typed command / path /
  // chord).
  const autofillActionTarget = async (
    node: { icon?: string; iconAuto?: boolean; label?: string; labelAuto?: boolean },
    kind: ActionIconKind,
    target: string,
    targetChanged: boolean,
  ): Promise<void> => {
    const fill = await resolveActionFill(kind, target, deps.hostEnvironment);
    if (fill.icon && (targetChanged || !node.icon || node.iconAuto)) {
      node.icon = fill.icon;
      node.iconAuto = true;
    }
    if (fill.label && (targetChanged || node.labelAuto || isDefaultItemLabel(node.label ?? ''))) {
      node.label = fill.label;
      node.labelAuto = true;
    }
  };
  return {
    // The scene's sizes are logical px (#473): the editor's preview scales
    // them to the monitor itself, no device-pixel-ratio in. The active shape
    // plugin's module loads (cached) before the build so the preview renders
    // plugin nodes instead of wedges (#325 parity for the headless core).
    BuildScene: async (config, navigation, activeSector, centreActive, appearance) =>
      buildOverlaySvgScene(
        config,
        navigation,
        activeSector,
        appearance,
        deps.shapeModule ? await deps.shapeModule(config, appearance) : null,
        undefined,
        centreActive,
      ),
    // Pure menu-config transforms (the editor persists the result via
    // SetMenuConfig); the shared action/type logic lives in core/menu-edit.
    ApplyActionPick: (config, path, actionId) => applyActionPick(config, path, actionId),
    SetNodeKind: (config, path, kind) => setNodeKind(config, path, kind),
    // Tree structure edits: add a child / delete-or-collapse, plus where the
    // selection should land (the appended node / the post-delete slot).
    AddNode: (config, ringPath) => {
      const next = addNode(config, ringPath);
      const len = nodeAt(next, ringPath)?.branches?.length ?? 0;
      return { config: next, selection: len > 0 ? [...ringPath, len - 1] : [...ringPath] };
    },
    AddItem: (config, ringPath, item) => {
      const next = addItem(config, ringPath, item);
      const len = nodeAt(next, ringPath)?.branches?.length ?? 0;
      return { config: next, selection: len > 0 ? [...ringPath, len - 1] : [...ringPath] };
    },
    DeleteNode: (config, ringPath, index) => {
      const next = deleteOrCollapseNode(config, ringPath, index);
      return { config: next, selection: nextSelectionAfterDelete(next, ringPath, index) };
    },
    // Tree moves (MenuList part B): a within-ring reorder / a cross-ring move,
    // plus where the selection lands (the moved node; unchanged on a rejected
    // move: the transform returns the input config by identity then).
    MoveNode: (config, ringPath, from, to) => {
      const next = moveNode(config, ringPath, from, to);
      return { config: next, selection: [...ringPath, next === config ? from : to] };
    },
    MoveNodeBetween: (config, fromPath, toRingPath, toIndex) => {
      const moved = moveNodeBetween(config, fromPath, toRingPath, toIndex);
      return { config: moved.config, selection: moved.movedPath };
    },
    GetMoveTargets: (config, fromPath) => moveTargetRings(config, fromPath),
    // Navigation/input (C3): the one inspect model the navigation UI renders
    // and the one edit transform every binding mutation goes through. The
    // transform rejects by identity; `changed` carries that to the editor so
    // a rejected op writes nothing.
    InspectNavInput: (config, path, buttonCount, plugins) =>
      inspectNavInput(config, path, buttonCount, plugins),
    EditNavInput: (config, op, plugins) => {
      const next = editNavigation(config, op, plugins);
      const changed = next !== config;
      return { config: next, changed, navigationChanged: changed && navEditTouchesNavigation(op) };
    },
    // Desktop tab (C4): the render-ready model + the one edit transform. The
    // active menu's trigger button (default resolved here, not editor-side)
    // drives the conflict marking + the blocked rows.
    InspectDesktopSettings: (settings, config, buttonCount) =>
      inspectDesktopSettings(settings, config.triggerButton ?? DEFAULT_TRIGGER_BUTTON, buttonCount),
    EditDesktopSettings: (settings, op) => editDesktopSettings(settings, op),
    // Plugin-manager UI models (C5): the list, the consent + remove dialogs,
    // and the two shape pickers, all worded core-side.
    InspectPluginManager: (state) => inspectPluginManager(state),
    InspectPluginConsent: (picked) => inspectPluginConsent(picked),
    InspectPluginRemoval: (name, usages) => inspectPluginRemoval(name, usages),
    InspectShapeSelects: (state, appearance, config) =>
      inspectShapeSelects(state, appearance, config),
    // Catalog/context surface (C5 part 2): the source controls + header +
    // read-only banner, and the command palette, all worded core-side.
    InspectSourceState: (catalog, contextIds, profileId) =>
      inspectSourceState(catalog, contextIds, profileId),
    InspectPalette: (catalog, profileId, enabledOnly) =>
      inspectPalette(catalog, profileId, enabledOnly),
    InspectDeviceBar: (profiles, device, catalog) => inspectDeviceBar(profiles, device, catalog),
    GetMenuLimits: () => ({ maxDepth: MAX_MENU_DEPTH }),
    // Browse-for-file: write a picked file into the node's exec command (quoted)
    // or open-file path and auto-resolve its icon (kept if a manual icon is set).
    SetActionTarget: async (config, path, file) => {
      const copy = structuredClone(config);
      const node = nodeAt(copy, path);
      const kind = node?.action ? actionTargetKind(node.action.id) : null;
      if (!node || !node.action || !kind) return config;
      const oldTarget = targetOf(node.action.config, kind);
      const target = kind === 'exec' ? quoteCommandPath(file) : file;
      node.action.config = {
        ...(node.action.config ?? {}),
        [kind === 'exec' ? 'command' : 'path']: target,
      };
      await autofillActionTarget(node, kind, target, target !== oldTarget);
      return copy;
    },
    // Set a leaf/centre action's whole config (null clears it) and, for an
    // exec/open-file/key-combo action, auto-resolve the icon (+ label for the
    // path actions) from the new target. The schema config form commits through
    // this so typing a command fills the program's icon + name (#419), and a
    // key chord fills the keysym's standard icon (#511).
    SetActionConfig: async (config, path, cfg) => {
      const copy = structuredClone(config);
      const node = nodeAt(copy, path);
      if (!node?.action) return config;
      const kind = actionFillKind(node.action.id);
      const oldTarget = kind ? targetOf(node.action.config, kind) : '';
      if (cfg === null) delete node.action.config;
      else node.action.config = cfg;
      if (kind) {
        const target = targetOf(cfg ?? undefined, kind);
        if (target.trim() !== '')
          await autofillActionTarget(node, kind, target, target !== oldTarget);
      }
      return copy;
    },
    // The node's path-action kind (drives the Browse button) + a "won't fire"
    // warning from the on-disk check, or nulls when it has no exec/open-file
    // action or no target entered yet.
    InspectActionPath: (config, path) => {
      const node = nodeAt(config, path);
      const kind = node?.action ? actionTargetKind(node.action.id) : null;
      if (!node?.action || !kind) return { kind: null, warning: null };
      const cfg = node.action.config;
      const target =
        kind === 'exec'
          ? typeof cfg?.command === 'string'
            ? cfg.command
            : ''
          : typeof cfg?.path === 'string'
            ? cfg.path
            : '';
      const warning =
        target.trim() === '' ? null : actionPathHint(kind, checkActionPath(kind, target));
      return { kind, warning };
    },
    // The appearance sliders' bounds, single-sourced from the pie-appearance
    // constants so the editor never re-declares them.
    GetAppearanceRanges: () => ({
      scale: { min: PIE_SCALE_MIN, max: PIE_SCALE_MAX, step: PIE_SCALE_STEP },
      opacity: { min: PIE_OPACITY_MIN, max: PIE_OPACITY_MAX, step: PIE_OPACITY_STEP },
      labelScale: {
        min: PIE_LABEL_SCALE_MIN,
        max: PIE_LABEL_SCALE_MAX,
        step: PIE_LABEL_SCALE_STEP,
      },
      iconScale: { min: PIE_ICON_SCALE_MIN, max: PIE_ICON_SCALE_MAX, step: PIE_ICON_SCALE_STEP },
      balance: { min: PIE_BALANCE_MIN, max: PIE_BALANCE_MAX, step: PIE_BALANCE_STEP },
      wedgeGap: { min: PIE_WEDGE_GAP_MIN, max: PIE_WEDGE_GAP_MAX, step: PIE_WEDGE_GAP_STEP },
      wedgeHover: {
        min: PIE_WEDGE_HOVER_MIN,
        max: PIE_WEDGE_HOVER_MAX,
        step: PIE_WEDGE_HOVER_STEP,
      },
    }),
    // The font picker's presets: the "System" stack value (also how the editor
    // detects System mode) + the bundled face's display label, single-sourced.
    GetFontPresets: () => ({ systemStack: SYSTEM_FONT_UI, bundledLabel: BUNDLED_FONT_UI_LABEL }),
    EncodeIcon: (path) => encodeIconFile(path),
    // Read + validate a plugin folder (the inspect half of the old PICK_PLUGIN;
    // the native dialog stays Qt-side).
    InspectPlugin: async (path) => {
      const read = await readPluginManifest(path);
      if (!read.ok) {
        return { ok: false as const, reason: `not a valid plugin folder: ${read.reason}` };
      }
      return {
        ok: true as const,
        srcDir: path,
        name: read.manifest.name,
        permissions: read.manifest.permissions ?? [],
        trust: pluginTrust(read.manifest.id, path),
      };
    },
    ResolveActionIcon: (kind, target) =>
      resolveActionIcon(kind as ActionIconKind, target, deps.hostEnvironment),
    CheckActionPath: (kind, target) => checkActionPath(kind as FileActionKind, target),
    // No-op standalone; the live-preview effect (suppress the overlay pie, gate
    // axis forwarding) is wired in Phase D when the core drives the runtime.
    SetLive: (on, focused) => deps.live?.setLive(on, focused),
    SetLiveView: (navigation) => deps.live?.setView(navigation),
  };
}

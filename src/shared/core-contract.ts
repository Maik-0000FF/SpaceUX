// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Editor <-> headless-core contract (#457, Phase A1). The single source of truth
 * for the operations the Qt/QML editor calls on the headless JS core over D-Bus
 * (`org.spaceux.Core1`). No behaviour here, just the contract both sides
 * implement.
 *
 * Wire convention: uniform JSON-RPC (see org.spaceux.Core1.xml). Every method
 * takes one `s` "args" string and returns one `s` "result" string: args are the
 * logical argument tuple JSON-encoded as an array (an empty array for no-arg
 * methods); the result is the `result` type JSON-encoded (`null` for void). This
 * uniformity lets the server dispatch generically over one code path. The types
 * below are the JSON-decoded shapes, RE-USED from the existing shared modules so
 * the contract can never drift from the runtime types: nothing is re-declared.
 *
 * Why methods, not D-Bus properties: the `Get`/`Set`/`*Changed` triads could be
 * `org.freedesktop.DBus.Properties` (which would give the change signal for
 * free), but the payloads are JSON-in-strings and JSON blobs make awkward
 * properties, so the uniform "every operation is a method returning `s`" model
 * is the deliberate tradeoff.
 *
 * Validation: every `Set*` runs through the existing sanitizers on the core side
 * before it is applied/persisted (untrusted input never bypasses them). Expected
 * failures come back inside the result (`{ ok, error }` / a `conflict`), never as
 * a D-Bus error.
 *
 * A `Set*` with a `void` result is fire-and-forget: a clamp/reject is reconciled
 * via the matching `*Changed` signal or a re-`Get`, mirroring the current
 * single-client design (the caller knows what it set).
 *
 * Deliberate omissions vs the old IPC surface: native file / folder / image
 * pickers run in the Qt editor (`QFileDialog`), so only the core-side work
 * crosses the wire (`EncodeIcon` / `InspectPlugin` / `ResolveActionIcon` /
 * `CheckActionPath`). The old `EDITOR_PICK_FILE` (Qt picks the path locally) and
 * `EDITOR_READY` (the bus connection replaces the mount handshake) therefore have
 * no method here.
 */

import type { ActionPathCheck } from './ipc.js';
import type { AxesEvent, ButtonEvent } from './protocol.js';
import type {
  ContextMenusState,
  ContextSeedResult,
  DesktopSettings,
  EditorAction,
  EditorDeviceInfo,
  EditorWindowSize,
  InputSettings,
  MenuConfigChange,
  MenuConfigSnapshot,
  MenuWriteResult,
  PickIconResult,
  PieAppearance,
  PluginBridgeActionResult,
  PluginBridgeStatus,
  PluginCatalogResult,
  PluginImportResult,
  PluginInvalidatedPayload,
  PluginPickResult,
  PluginsState,
  PluginUninstallDescriptorRequest,
  PluginUninstallResult,
  PluginUsageReport,
  ProfileActionResult,
  ProfilesState,
  ThemeChoice,
} from './ipc.js';
import type { ActionRef, MenuConfig } from './menu.js';
import type { DesktopEditOp, DesktopEditResult, DesktopUiModel } from './desktop-ui.js';
import type {
  CatalogSnapshot,
  DeviceBarModel,
  PaletteModel,
  SourceStateModel,
} from './context-ui.js';
import type {
  PluginConsentModel,
  PluginManagerUiModel,
  PluginRemovalModel,
  ShapeSelectsModel,
} from './plugin-ui.js';
import type { NavEditOp, NavUiModel } from './nav-ui.js';
import type { OverlaySvgScene } from './pie-scene.js';

// ── D-Bus addressing ────────────────────────────────────────────────────────
export const CORE_SERVICE = 'org.spaceux.Core';
export const CORE_OBJECT_PATH = '/org/spaceux/Core';
export const CORE_INTERFACE = 'org.spaceux.Core1';

/** The editor's own bus identity (single instance + app-level control:
 *  Raise from a second launch, Quit from the tray's app quit). Mirrored by
 *  src/editor-qt/SingleInstance.cpp, which owns the name. */
export const EDITOR_SERVICE = 'org.spaceux.Editor';
export const EDITOR_OBJECT_PATH = '/org/spaceux/Editor';
export const EDITOR_INTERFACE = 'org.spaceux.Editor1';

// ── Typed method map: logical args -> result (the JSON-decoded shapes) ───────
export interface CoreMethods {
  // menu config & pie scene
  GetMenuConfig: { args: []; result: MenuConfigSnapshot };
  SetMenuConfig: {
    args: [config: MenuConfig, expectedMtime: number | null];
    result: MenuWriteResult;
  };
  BuildScene: {
    args: [
      config: MenuConfig,
      navigation: number[],
      activeSector: number | null,
      // Whether the centre/root is the active target (drives the depth-dot
      // indicator independently of `activeSector`). The live overlay derives it
      // from the puck (`activeSector === null`); the editor passes whether the
      // root node is the current selection, so the dot follows the viewed ring.
      centreActive: boolean,
      appearance: PieAppearance,
    ];
    result: OverlaySvgScene;
  };
  // Pure menu-config edit transforms (the shared action/type logic stays
  // core-side, #457): the editor passes its working config + a node path (index
  // array, `[]` = the centre/root) and persists the returned config via
  // SetMenuConfig. ApplyActionPick sets the dropdown action (clearing a stale
  // config/auto-icon, filling the Cancel label); SetNodeKind toggles a node
  // between a leaf action and a submenu.
  ApplyActionPick: {
    args: [config: MenuConfig, path: number[], actionId: string];
    result: MenuConfig;
  };
  SetNodeKind: {
    args: [config: MenuConfig, path: number[], kind: 'action' | 'submenu'];
    result: MenuConfig;
  };
  // Tree structure edits (#457): add a child to the ring at `ringPath` (`[]` =
  // top level), or delete/collapse the node at `ringPath`[`index`]. Both return
  // the new config to persist via SetMenuConfig plus where the editor moves the
  // selection (the appended node / the post-delete slot).
  AddNode: {
    args: [config: MenuConfig, ringPath: number[]];
    result: { config: MenuConfig; selection: number[] };
  };
  // The command palette's add (#76 D2b): append a fully-specified leaf (label
  // + optional icon + action) to the ring at `ringPath`.
  AddItem: {
    args: [
      config: MenuConfig,
      ringPath: number[],
      item: { label: string; icon?: string; action?: ActionRef },
    ];
    result: { config: MenuConfig; selection: number[] };
  };
  DeleteNode: {
    args: [config: MenuConfig, ringPath: number[], index: number];
    result: { config: MenuConfig; selection: number[] };
  };
  // Tree move edits (#457 MenuList part B): reorder within a ring (drag /
  // Alt+arrows), or move a node into another ring (cross-ring drag / keyboard
  // cut+paste). Both return the new config plus the moved node's path (the
  // source splice can shift the target ring's indices, so the editor re-selects
  // via the returned selection, never the inputs). A rejected move returns the
  // input config unchanged with the selection still on the node.
  MoveNode: {
    args: [config: MenuConfig, ringPath: number[], from: number, to: number];
    result: { config: MenuConfig; selection: number[] };
  };
  MoveNodeBetween: {
    args: [config: MenuConfig, fromPath: number[], toRingPath: number[], toIndex: number];
    result: { config: MenuConfig; selection: number[] };
  };
  // Every ring the node at `fromPath` may move into (no cycle, fits the depth
  // cap, not its own ring). Fetched once at drag start so the editor's
  // drop-line only shows where the move transform would actually accept.
  GetMoveTargets: {
    args: [config: MenuConfig, fromPath: number[]];
    result: number[][];
  };
  // Navigation/input UI model + edits (#457 C3): InspectNavInput returns
  // everything the "Menu settings" / "Navigation" sections, the per-item
  // gesture lists and the centre trigger render (options, labels, notes and
  // the unified conflict markers) in one call; `path` selects the per-item
  // part (null = none, [] = the centre, a ring path = that node).
  // EditNavInput applies one typed edit op and returns the new config to
  // persist via SetMenuConfig; a rejected/no-op edit comes back with
  // `changed: false` so the editor writes nothing (no mtime bump, no
  // re-render), mirroring the move transforms' identity rejection.
  // `navigationChanged` = the op touched the navigation block the style
  // presets match against, driving the editor's sticky-custom style display.
  // `plugins` (the GetPlugins snapshot, or null before the first pull) merges
  // plugin-contributed navigation-style presets into the style quick-pick and
  // resolves them on applyPreset (#195).
  InspectNavInput: {
    args: [
      config: MenuConfig,
      path: number[] | null,
      buttonCount: number,
      plugins: PluginsState | null,
    ];
    result: NavUiModel;
  };
  EditNavInput: {
    args: [config: MenuConfig, op: NavEditOp, plugins: PluginsState | null];
    result: { config: MenuConfig; changed: boolean; navigationChanged: boolean };
  };
  // Structural limits the editor enforces in the UI (so an add that the
  // validator would reject is disabled rather than attempted): the maximum
  // nesting depth (the centre is depth 0). Single-sourced from shared/menu.
  GetMenuLimits: { args: []; result: { maxDepth: number } };
  // Browse-for-file: set the node's exec command / open-file path from a picked
  // file (quoted for exec) and auto-resolve its icon, returning the new config
  // (the Qt editor picks the file via the native dialog, the core does the rest).
  SetActionTarget: {
    args: [config: MenuConfig, path: number[], file: string];
    result: MenuConfig;
  };
  // Set a leaf/centre action's whole config object (or null to clear it) and,
  // for an exec / open-file action, auto-resolve the icon + label from the new
  // target (a manually set icon/label is kept), returning the new config. The
  // schema config form commits through this so typing a command fills the
  // program's icon + name (#419).
  SetActionConfig: {
    args: [config: MenuConfig, path: number[], cfg: Record<string, unknown> | null];
    result: MenuConfig;
  };
  // Inspect a node's path action: its kind (drives the Browse button) and a
  // "this won't fire" warning from the on-disk check, or nulls when the node has
  // no exec / open-file action.
  InspectActionPath: {
    args: [config: MenuConfig, path: number[]];
    result: { kind: 'exec' | 'open-file' | null; warning: string | null };
  };
  // Desktop tab (#457 C4): InspectDesktopSettings returns the render-ready
  // model (axis cards with only the chosen function's fields, button rows,
  // copy and the unified conflict markers); EditDesktopSettings applies one
  // typed op and returns the next settings to adopt + persist via
  // SetDesktopSettings (`changed: false` = rejected/no-op, write nothing).
  InspectDesktopSettings: {
    args: [settings: DesktopSettings, config: MenuConfig, buttonCount: number];
    result: DesktopUiModel;
  };
  EditDesktopSettings: {
    args: [settings: DesktopSettings, op: DesktopEditOp];
    result: DesktopEditResult;
  };
  GetTheme: { args: []; result: ThemeChoice };
  SetTheme: { args: [theme: ThemeChoice]; result: void };
  // The editor window's remembered size (editor-settings.json `window`); null
  // when nothing is saved yet, so the editor opens at its default. Size only:
  // a Wayland client cannot position its own window (see EditorWindowSize);
  // the core validates the wire value at the boundary.
  GetEditorWindow: { args: []; result: EditorWindowSize | null };
  SetEditorWindow: { args: [size: EditorWindowSize]; result: void };

  // appearance & settings
  GetPieAppearance: { args: []; result: PieAppearance };
  SetPieAppearance: { args: [patch: Partial<PieAppearance>]; result: void };
  // The slider ranges (min/max/step) for the appearance controls, so the editor
  // reads the bounds from the core instead of re-declaring them.
  GetAppearanceRanges: {
    args: [];
    result: {
      scale: { min: number; max: number; step: number };
      opacity: { min: number; max: number; step: number };
      labelScale: { min: number; max: number; step: number };
      iconScale: { min: number; max: number; step: number };
      balance: { min: number; max: number; step: number };
    };
  };
  // The pie label-font picker's presets, so the editor reads the "System" stack
  // and the bundled face's display name from the core instead of re-declaring
  // them. `''` stored = bundled, `systemStack` = System, anything else = Custom.
  GetFontPresets: {
    args: [];
    result: { systemStack: string; bundledLabel: string };
  };
  GetInputSettings: { args: []; result: InputSettings };
  SetInputSettings: { args: [patch: Partial<InputSettings>]; result: void };
  GetDesktopSettings: { args: []; result: DesktopSettings };
  SetDesktopSettings: { args: [settings: DesktopSettings]; result: void };

  // device & profiles
  GetDeviceInfo: { args: []; result: EditorDeviceInfo };
  GetProfiles: { args: []; result: ProfilesState };
  SetProfileOverride: { args: [id: string | null]; result: void };
  SaveProfile: { args: []; result: ProfileActionResult };
  DeleteProfile: { args: [id: string]; result: ProfileActionResult };

  // Live preview (#177): the navigation runs CORE-side (the core owns the
  // axes stream, the config and the resolver); the editor reports its state
  // and mirrors the pushed outcome. `focused` gates the real pie's trigger
  // suppression (driving the preview vs the editor merely open behind).
  SetLive: { args: [on: boolean, focused: boolean]; result: void };
  // The editor's click-driven view path while live, so the core resolves
  // frames against the ring the editor actually shows.
  SetLiveView: { args: [navigation: number[]]; result: void };

  // icons & action paths (the logic the moved Qt dialogs feed)
  EncodeIcon: { args: [path: string]; result: PickIconResult };
  ResolveActionIcon: { args: [kind: string, target: string]; result: string | null };
  CheckActionPath: { args: [kind: string, target: string]; result: ActionPathCheck };

  // actions
  GetAvailableActions: { args: []; result: EditorAction[] };

  // plugins
  GetPlugins: { args: []; result: PluginsState };
  // Plugin-manager UI models (#457 C5): the manager list (kind sections,
  // badges, feature/permission chips, load errors), the import-consent dialog
  // (null = no consent needed), the remove confirm (usage scan folded into the
  // message), and the two shape pickers (the app-level appearance default +
  // the per-menu three-state override) in one call.
  InspectPluginManager: { args: [state: PluginsState]; result: PluginManagerUiModel };
  InspectPluginConsent: { args: [picked: PluginPickResult]; result: PluginConsentModel };
  InspectPluginRemoval: {
    args: [name: string, usages: PluginUsageReport | null];
    result: PluginRemovalModel;
  };
  InspectShapeSelects: {
    args: [state: PluginsState, appearance: PieAppearance, config: MenuConfig];
    result: ShapeSelectsModel;
  };
  // Catalog/context surface (#457 C5 part 2): InspectSourceState returns the
  // whole left-column source UI (read-only flag + banner, the Dynamic|Curated
  // source controls, the active-context header) off the catalog snapshot the
  // editor pulled; InspectPalette the expanded command palette (the editor
  // filters the search query locally).
  InspectSourceState: {
    args: [catalog: CatalogSnapshot, contextIds: string[], profileId: string | null];
    result: SourceStateModel;
  };
  InspectPalette: {
    args: [catalog: CatalogSnapshot, profileId: string | null, enabledOnly: boolean];
    result: PaletteModel;
  };
  // The toolbar device/profile bar (#113, D1): status + override controls.
  InspectDeviceBar: {
    args: [profiles: ProfilesState, device: EditorDeviceInfo, catalog: CatalogSnapshot];
    result: DeviceBarModel;
  };
  InspectPlugin: { args: [path: string]; result: PluginPickResult };
  ImportPlugin: { args: [srcDir: string]; result: PluginImportResult };
  UninstallPlugin: { args: [kind: string, id: string]; result: PluginUninstallResult };
  ScanPluginUsages: { args: [id: string, kind: string]; result: PluginUsageReport };
  GetPluginUninstallHook: { args: [id: string]; result: PluginUninstallDescriptorRequest };
  PerformPluginUninstallHook: { args: [id: string]; result: ProfileActionResult };
  GetPluginCatalog: { args: [id: string, loadAll: boolean]; result: PluginCatalogResult };
  GetShapeSource: { args: [id: string]; result: string | null };
  GetPluginBridge: { args: [id: string]; result: PluginBridgeStatus };
  InstallPluginBridge: { args: [id: string]; result: PluginBridgeActionResult };
  UninstallPluginBridge: { args: [id: string]; result: PluginBridgeActionResult };

  // context (curated pies)
  GetContextMenus: { args: []; result: ContextMenusState };
  SeedContext: { args: [id: string, key: string, overwrite: boolean]; result: ContextSeedResult };
  DeleteContext: { args: [id: string, key: string]; result: ProfileActionResult };

  // autostart
  GetAutostart: { args: []; result: boolean };
  SetAutostart: { args: [enabled: boolean]; result: boolean };
}

// ── Typed signal map: name -> pushed payload ────────────────────────────────
export interface CoreSignals {
  MenuConfigChanged: MenuConfigChange;
  PieAppearanceChanged: PieAppearance;
  DesktopSettingsChanged: DesktopSettings;
  DeviceInfo: EditorDeviceInfo;
  ProfilesChanged: ProfilesState;
  ContextMenusChanged: ContextMenusState;
  ActionsChanged: void;
  PluginInvalidated: PluginInvalidatedPayload;
  Axes: AxesEvent['values'];
  Button: Omit<ButtonEvent, 'event'>;
  /** The core-resolved live-preview outcome (#177): the drill path the
   *  preview should show, the highlighted sector (null = centre/deadzone),
   *  and whether the frame was a real movement (clears a click selection). */
  LiveNav: { navigation: number[]; sticky: number | null; movement: boolean };
}

// ── Operation names (the wire member names) ─────────────────────────────────
// `satisfies` ties each listed name to a real key of the typed maps above, so a
// typo or a stale name is a compile error.
export const CORE_METHODS = [
  'GetMenuConfig',
  'SetMenuConfig',
  'BuildScene',
  'ApplyActionPick',
  'SetNodeKind',
  'AddNode',
  'AddItem',
  'DeleteNode',
  'MoveNode',
  'MoveNodeBetween',
  'GetMoveTargets',
  'InspectNavInput',
  'EditNavInput',
  'InspectDesktopSettings',
  'EditDesktopSettings',
  'GetMenuLimits',
  'SetActionTarget',
  'SetActionConfig',
  'InspectActionPath',
  'GetTheme',
  'SetTheme',
  'GetEditorWindow',
  'SetEditorWindow',
  'GetPieAppearance',
  'SetPieAppearance',
  'GetAppearanceRanges',
  'GetFontPresets',
  'GetInputSettings',
  'SetInputSettings',
  'GetDesktopSettings',
  'SetDesktopSettings',
  'GetDeviceInfo',
  'GetProfiles',
  'SetProfileOverride',
  'SaveProfile',
  'DeleteProfile',
  'SetLive',
  'SetLiveView',
  'EncodeIcon',
  'ResolveActionIcon',
  'CheckActionPath',
  'GetAvailableActions',
  'GetPlugins',
  'InspectPluginManager',
  'InspectPluginConsent',
  'InspectPluginRemoval',
  'InspectShapeSelects',
  'InspectSourceState',
  'InspectPalette',
  'InspectDeviceBar',
  'InspectPlugin',
  'ImportPlugin',
  'UninstallPlugin',
  'ScanPluginUsages',
  'GetPluginUninstallHook',
  'PerformPluginUninstallHook',
  'GetPluginCatalog',
  'GetShapeSource',
  'GetPluginBridge',
  'InstallPluginBridge',
  'UninstallPluginBridge',
  'GetContextMenus',
  'SeedContext',
  'DeleteContext',
  'GetAutostart',
  'SetAutostart',
] as const satisfies readonly (keyof CoreMethods)[];
export type CoreMethodName = (typeof CORE_METHODS)[number];

export const CORE_SIGNALS = [
  'MenuConfigChanged',
  'PieAppearanceChanged',
  'DesktopSettingsChanged',
  'DeviceInfo',
  'ProfilesChanged',
  'ContextMenusChanged',
  'ActionsChanged',
  'PluginInvalidated',
  'Axes',
  'Button',
  'LiveNav',
] as const satisfies readonly (keyof CoreSignals)[];
export type CoreSignalName = (typeof CORE_SIGNALS)[number];

// Drift guard, the reverse of the `satisfies` above: `satisfies` rejects a name
// that is not a real key, and these two lines reject a real key that was left out
// of the array. A compile error here means CoreMethods/CoreSignals gained a
// member that CORE_METHODS/CORE_SIGNALS is missing.
true satisfies Exclude<keyof CoreMethods, CoreMethodName> extends never ? true : never;
true satisfies Exclude<keyof CoreSignals, CoreSignalName> extends never ? true : never;

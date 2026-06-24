// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor
import "paths.js" as Paths

// Phase B2 shell: the menu tree + node properties (left) and the live pie preview
// (right). The tree is the editor's MenuList; selecting a node shows its label in
// an editable field, and committing it writes the config back (SetMenuConfig).
// The preview builds the scene from the core's current config + appearance
// (GetMenuConfig + GetPieAppearance -> BuildScene) with the shared PieView (#344).
// Clicking a branch sector drills into it (the submenu becomes the active ring),
// a leaf selects it, and the inner breadcrumb ring navigates back up; the tree
// stays in sync. Everything rebuilds on the MenuConfigChanged /
// PieAppearanceChanged push. Tree moves (drag / Alt+arrows / cut+paste) run the
// core's MoveNode / MoveNodeBetween and re-select the moved node.
Window {
    id: window

    // Current menu config + its mtime (the write-back conflict baseline), the
    // built pie scene, the selected node's path ("" is the root) and the drill
    // path of the ring the preview shows ("" = the top-level ring): selecting a
    // node sets viewPath to its parent ring,
    // drilling pushes the branch onto viewPath.
    property var menuConfig: null
    property var menuMtime: null
    property var appearance: null
    property var scene: null
    // The available actions (EditorAction[]) for the properties Action dropdown;
    // refreshed on the ActionsChanged push.
    property var actions: []
    // The selected node's path-action status { kind, warning }: kind drives the
    // Browse-for-file button, warning the "won't fire" note. Refreshed by the
    // core (InspectActionPath) when the selection or config changes.
    property var pathInfo: ({
        "kind": null,
        "warning": null
    })
    // The appearance sliders' { min, max, step } ranges from the core (fetched
    // once); the Appearance panel reads them instead of re-declaring the bounds.
    property var ranges: null
    // Top-level tab: 0 = Settings (far left),
    // 1 = Pie menu (the 3-pane editor, the default). Desktop is the C4 slice.
    property int activeTab: 1
    // Settings-tab state (loaded from the core): launch-on-login, grab-while-pie,
    // and the font picker's presets ({ systemStack, bundledLabel }).
    property bool autostart: false
    property bool grabWhilePieOpen: false
    property var fontPresets: null
    // Max nesting depth the validator allows (from GetMenuLimits); the tree
    // disables the add button at this depth so an over-deep add isn't attempted.
    property int menuMaxDepth: 16
    // Draggable pane widths: the tree (left) + properties (right) panes can be
    // pulled WIDER via the split handles but never narrower than their initial
    // width; the preview takes the rest.
    property real treeWidth: Theme.panelLeftWidth
    property real propsWidth: Theme.panelRightWidth
    // The command palette's list cap, dragged via the horizontal splitter
    // above it (clamped between the minimum list and the tree's reserve).
    property real paletteListHeight: Theme.paletteMaxHeight
    // The pie's logical size at the SMALLEST scale, which the window minimum
    // keeps the preview pane from shrinking below (#473). displaySize is purely
    // proportional to scale and viewBoxSize is the scale-1 reference, so the
    // min-scale size is just viewBoxSize * scale.min, single-sourced from the
    // core (no re-derived geometry). 0 until the first scene + ranges arrive.
    readonly property real previewMinSize: (window.scene && window.ranges) ? window.scene.viewBoxSize * window.ranges.scale.min : 0
    property bool hasSelection: false
    property string selectedPath: ""
    property string viewPath: ""
    // The connected device's button count (GetDeviceInfo + the DeviceInfo
    // push; 0 = none/unknown -> the core's fallback range) and the
    // navigation/input UI model the Properties sections render (#457 C3),
    // refreshed on config / selection / device changes.
    property int deviceButtons: 0
    // The full device identity (vendor/product/name) the device bar shows;
    // deviceResolved gates UI that must not flash a fallback count (#481).
    property var deviceIdentity: null
    property bool deviceResolved: false
    // Profiles (#113, D1): the GetProfiles snapshot + the device-bar model.
    property var profilesState: null
    property var deviceBarModel: null
    property var navModel: null
    // Sticky-custom style display: once an edit touched the navigation block
    // (anything but picking a preset), the style dropdown holds "Custom" even
    // if a drag happens to pass exactly through a preset's values, so the
    // display can't flap mid-drag. Picking a preset or an external config
    // change re-matches honestly. Session-only, deliberately not persisted.
    property bool styleCustomized: false
    // Live preview (#177, D5): the core resolves the puck navigation and
    // pushes LiveNav deltas; the editor mirrors them. liveSticky drives the
    // preview highlight (-1 = centre/deadzone); adoptingLiveNav guards the
    // viewPath echo so a pushed adoption doesn't re-report itself.
    property bool livePreview: false
    property int liveSticky: -1
    property bool adoptingLiveNav: false
    // Desktop tab (#457 C4): the working desktop-mode settings + the
    // render-ready model from InspectDesktopSettings, refreshed on settings /
    // trigger / device changes. Edits adopt optimistically and persist
    // debounced (sliders fire per drag step; the write runs once it settles).
    property var desktopSettings: null
    property var desktopModel: null
    // Plugins (#457 C5): the GetPlugins snapshot, the manager-list model and
    // the two shape pickers' models, all refreshed on plugin changes. The
    // import/remove flows below adopt the snapshot the reply carries.
    property var pluginsState: null
    property var pluginManagerModel: null
    property var shapeSelects: null
    property bool pluginBusy: false
    // Catalog/context surface (#457 C5 part 2): the pulled catalog snapshot
    // (token-guarded against overlapping pulls), the curated context ids, the
    // device's active source id, and the render-ready models.
    property var catalogState: ({
        "plugin": null,
        "status": "idle",
        "reason": null,
        "groups": []
    })
    property int catalogToken: 0
    property bool catalogComplete: false
    property var contextIds: []
    property string profileId: ""
    property var sourceState: null
    property var paletteModel: null
    property bool sourceBusy: false
    property bool sourceIntentCurated: false
    property bool paletteEnabledOnly: false
    property var bridgeStatus: null
    property string bridgeNote: ""
    readonly property bool readOnly: sourceState !== null && sourceState.readOnly
    // Write-rejection banners: a conflict keeps the attempted config for
    // Overwrite (re-write onto the fresh baseline); any other rejection shows
    // its reason until dismissed. Cleared by the next successful write.
    property var conflictPending: null
    property string saveError: ""
    // Serialized + coalesced: a slider drag emits ops faster than the
    // edit->write round-trip, and every write must build on the PREVIOUS
    // write's config + mtime or the core rejects it as a conflict. So one op
    // runs at a time; ops arriving in flight queue, and an absolute op
    // (setDeadzone, setThreshold, ...) replaces a queued op with the same
    // kind + target so a drag collapses to its latest value. Structural ops
    // (addInput / removeInput) are never replaced.
    property bool navEditBusy: false
    property var navEditQueue: []
    // The config a write attempt carried, kept until its reply so a conflict
    // banner can offer Overwrite with exactly what was dropped.
    property var lastAttemptedConfig: null
    // Undo/redo over the menu-config document: every
    // successful own write pushes the prior document, remote
    // adoptions clear the history (undo never crosses a reload boundary), and
    // only the document is tracked, not the UI bookkeeping. Entries are the
    // adopted config objects, capped at Theme.undoHistoryLimit.
    property var undoStack: []
    property var redoStack: []
    // Non-null while an undo/redo restore write is in flight: { direction }.
    // The stacks shift only when that write lands (onMenuWritten), so a
    // rejected restore leaves the history untouched.
    property var pendingHistory: null
    // Pre-paint bootstrap: the first paint waits for the persisted theme (or
    // the short fallback below if the core is unreachable), so a light-themed
    // editor can't flash the built-in dark palette on startup.
    property bool themeReady: false
    // Gates the size persist until the remembered size was applied (or found
    // absent), so the pre-restore default can never overwrite the saved value.
    property bool windowSizeRestored: false

    // The selected sector within the active ring (the ring shown at viewPath),
    // or -1 when the selection isn't a direct child of the view (the root, or
    // the breadcrumb parent right after drilling). Drives the wedge highlight and
    // which depth dot lights.
    function activeSectorInView() {
        if (window.selectedPath === "" || Paths.parentPath(window.selectedPath) !== window.viewPath)
            return -1;

        return Paths.lastIndex(window.selectedPath);
    }

    // Build the pie from the cached config + appearance at the current viewPath.
    // Passes the active sector (wedge highlight) and whether the root is selected
    // (centreActive → the depth dot tracks the centre vs the viewed ring). Used
    // for navigation/selection, where the config is unchanged.
    function buildPie() {
        if (!window.menuConfig || !window.appearance)
            return ;

        const sector = window.livePreview ? window.liveSticky : window.activeSectorInView();
        // The scene is built at its logical reference size (#473); the core no
        // longer divides by a device-pixel-ratio. PiePreview shows it at that
        // real size and lets Qt scale it to the editor's monitor, so the preview
        // matches the native pie on that monitor.
        EditorClient.callAsync("BuildScene", [window.menuConfig, Paths.toIndices(window.viewPath), sector < 0 ? null : sector, window.selectedPath === "", window.appearance], function(sceneJson) {
            window.scene = JSON.parse(sceneJson);
        });
    }

    // Pull the config + appearance fresh, then build. Used on startup and on a
    // MenuConfigChanged push (the menu actually changed).
    function rebuildScene() {
        EditorClient.callAsync("GetMenuConfig", [], function(menuJson) {
            const snapshot = JSON.parse(menuJson);
            // An mtime the editor hasn't seen = the config changed OUTSIDE this
            // editor (own writes adopt their mtime in onMenuWritten before the
            // push arrives). A pending keyboard cut is positional, so it can't
            // survive an unknown structure change, so drop it.
            const external = window.menuMtime === null || snapshot.mtime !== window.menuMtime;
            if (window.menuMtime !== null && external)
                tree.clearCut();

            window.menuConfig = snapshot.config;
            window.menuMtime = snapshot.mtime;
            // Own writes already refreshed the nav model in onMenuWritten, so
            // only an external change re-inspects here (one inspect per edit,
            // not two). An external change also re-matches the style honestly
            // (the sticky-custom display only covers this session's edits).
            if (external) {
                // A remote adoption (external edit / device / profile / source
                // switch) is not an undoable step, and undo must never cross
                // it: drop the document history.
                window.undoStack = [];
                window.redoStack = [];
                window.pendingHistory = null;
                window.styleCustomized = false;
                window.refreshNavModel();
                window.refreshDesktopModel();
                // Own writes already refreshed the shape pickers in
                // onMenuWritten (same gating as the nav/desktop models).
                window.refreshShapeSelects();
            }
            EditorClient.callAsync("GetPieAppearance", [], function(apJson) {
                window.appearance = JSON.parse(apJson);
                window.buildPie();
                window.refreshPathInfo();
                // The external-branch inspect above ran BEFORE this reply set
                // the appearance, so its guard aborted; re-inspect now that
                // all inputs can be present (idempotent, still guarded), or
                // the shape pickers would only appear with the first
                // appearance push (a slider move).
                window.refreshShapeSelects();
            });
        });
    }

    // Re-pull the navigation/input UI model (#457 C3): everything the Menu
    // settings / Navigation sections + the per-item gesture lists render.
    // The per-item part follows the selection (null = none, [] = the centre).
    function refreshNavModel() {
        if (!window.menuConfig) {
            window.navModel = null;
            return ;
        }
        const path = window.hasSelection ? Paths.toIndices(window.selectedPath) : null;
        EditorClient.callAsync("InspectNavInput", [window.menuConfig, path, window.deviceButtons, window.pluginsState], function(json) {
            window.navModel = JSON.parse(json);
        });
    }

    function navOpSlot(op) {
        const structural = op.kind === "addInput" || op.kind === "removeInput";
        return structural ? null : JSON.stringify({
            "kind": op.kind,
            "target": op.target || null,
            "index": op.index !== undefined ? op.index : null
        });
    }

    // Apply one navigation/input edit op (EditNavInput) and persist the result;
    // the adopted write then refreshes the model + the pie.
    function editNav(op) {
        if (!window.menuConfig)
            return ;

        if (window.navEditBusy) {
            const slot = window.navOpSlot(op);
            const q = window.navEditQueue;
            if (slot !== null && q.length > 0 && window.navOpSlot(q[q.length - 1]) === slot)
                q[q.length - 1] = op;
            else
                q.push(op);
            return ;
        }
        window.navEditBusy = true;
        EditorClient.callAsync("EditNavInput", [window.menuConfig, op, window.pluginsState], function(resJson) {
            const res = JSON.parse(resJson);
            // A rejected/no-op edit writes nothing: no mtime bump, no push, no
            // re-render; just move on to the next queued op.
            if (res.changed !== true) {
                window.navEditBusy = false;
                if (window.navEditQueue.length > 0)
                    window.editNav(window.navEditQueue.shift());

                return ;
            }
            window.writeMenuConfig(res.config, function(wrJson) {
                if (res.navigationChanged === true)
                    window.styleCustomized = op.kind !== "applyPreset";

                window.navEditBusy = false;
                if (window.navEditQueue.length > 0)
                    window.editNav(window.navEditQueue.shift());

            });
        });
    }

    function fetchDeviceInfo() {
        EditorClient.callAsync("GetDeviceInfo", [], function(json) {
            window.adoptDeviceInfo(JSON.parse(json));
        });
    }

    function adoptDeviceInfo(info) {
        window.deviceButtons = info.buttons;
        window.deviceIdentity = info;
        window.deviceResolved = true;
        window.refreshDeviceBar();
        const nextProfile = info.profileId || "";
        if (nextProfile !== window.profileId) {
            window.profileId = nextProfile;
            window.refreshSourceState(true);
            window.refreshPalette();
        }
        window.refreshNavModel();
        window.refreshDesktopModel();
    }

    // ── Live preview (#177, D5) ───────────────────────────────────────────────
    function reportLive() {
        EditorClient.callAsync("SetLive", [window.livePreview, window.active === true]);
    }

    function setLivePreview(on) {
        window.livePreview = on;
        if (!on)
            window.liveSticky = -1;

        window.reportLive();
        if (on)
            EditorClient.callAsync("SetLiveView", [Paths.toIndices(window.viewPath)]);

        window.buildPie();
    }

    function adoptLiveNav(st) {
        window.adoptingLiveNav = true;
        const path = Paths.toPath(st.navigation);
        if (path !== window.viewPath)
            window.viewPath = path;

        window.liveSticky = st.sticky === null ? -1 : st.sticky;
        // The puck's node becomes the current selection (#447: last input
        // wins): the tree + Properties follow the highlight. With no hover,
        // a DRILLED view keeps drill semantics (the branch stays selected and
        // its ring active; selectNode("") would reset viewPath to the root
        // and fight the adopted path); the centre is the focus only at the
        // top level.
        if (window.liveSticky >= 0) {
            const target = Paths.childPath(path, window.liveSticky);
            if (st.movement || target !== window.selectedPath)
                window.selectNode(target);

        } else if (path !== "") {
            if (st.movement || window.selectedPath !== path || window.viewPath !== path)
                window.drillInto(path);

        } else if (st.movement || window.selectedPath !== "") {
            window.selectNode("");
        }
        window.buildPie();
        window.adoptingLiveNav = false;
    }

    // ── Profiles / device bar (#113, D1) ──────────────────────────────────────
    function refreshDeviceBar() {
        if (!window.profilesState || !window.deviceIdentity)
            return ;

        EditorClient.callAsync("InspectDeviceBar", [window.profilesState, window.deviceIdentity, window.catalogState], function(json) {
            window.deviceBarModel = JSON.parse(json);
        });
    }

    function fetchProfiles() {
        EditorClient.callAsync("GetProfiles", [], function(json) {
            window.profilesState = JSON.parse(json);
            window.refreshDeviceBar();
        });
    }

    function saveProfileFlow() {
        const successText = window.deviceBarModel ? window.deviceBarModel.saveSuccess : "";
        EditorClient.callAsync("SaveProfile", [], function(json) {
            const res = JSON.parse(json);
            toasts.notify(res.ok ? "success" : "error", res.ok ? successText : res.reason);
        });
    }

    function deleteProfileFlow() {
        const m = window.deviceBarModel;
        if (!m || m.deleteTarget === null)
            return ;

        confirm.askModel(m.deleteConfirm, function() {
            EditorClient.callAsync("DeleteProfile", [m.deleteTarget], function(json) {
                const res = JSON.parse(json);
                toasts.notify(res.ok ? "success" : "error", res.ok ? m.deleteSuccess : res.reason);
            });
        });
    }

    // ── Catalog/context (#457 C5 part 2) ──────────────────────────────────────
    // `profileChanged`: the active source just switched. A pending "Curated"
    // intent only survives while the plugin's own sources are (still) active,
    // so the segment doesn't stay highlighted over Auto / a device profile.
    function refreshSourceState(profileChanged) {
        EditorClient.callAsync("InspectSourceState", [window.catalogState, window.contextIds, window.profileId === "" ? null : window.profileId], function(json) {
            window.sourceState = JSON.parse(json);
            const src = window.sourceState.source;
            if (!src || (profileChanged === true && !src.isDynamic && src.activeContextKey === null))
                window.sourceIntentCurated = false;

        });
    }

    function refreshPalette() {
        EditorClient.callAsync("InspectPalette", [window.catalogState, window.profileId === "" ? null : window.profileId, window.paletteEnabledOnly], function(json) {
            window.paletteModel = JSON.parse(json);
        });
    }

    // Pull the catalog for the discovered catalog plugin. `all` cycles every
    // context in the host app (Load all); a refresh keeps the current scope.
    // Token-guarded: an overlapping older pull must not clobber a newer one.
    // A user-initiated pull (Load all / Usable now) announces start + outcome
    // as toasts, like the plugin-install flow; background refreshes stay quiet.
    function loadCatalogAnnounced(all) {
        if (window.paletteModel)
            toasts.notify("info", window.paletteModel.toastLoading);

        window.fetchCatalog(all, true);
    }

    function fetchCatalog(all, announce) {
        const p = window.pluginsState ? window.pluginsState.plugins.find(function(x) {
            return x.hasCatalog;
        }) : null;
        if (!p) {
            window.catalogState = {
                "plugin": null,
                "status": "ready",
                "reason": null,
                "groups": []
            };
            window.bridgeStatus = null;
            window.refreshSourceState();
            window.refreshPalette();
            window.refreshDeviceBar();
            return ;
        }
        const t = ++window.catalogToken;
        const pluginRef = {
            "id": p.id,
            "name": p.name,
            "contextLabel": p.contextLabel,
            "hasBridge": p.hasBridge
        };
        window.catalogState = Object.assign({
        }, window.catalogState, {
            "plugin": pluginRef,
            "status": "loading"
        });
        window.refreshSourceState();
        window.refreshPalette();
        EditorClient.callAsync("GetPluginCatalog", [p.id, all], function(json) {
            if (t !== window.catalogToken)
                return ;

            const res = JSON.parse(json);
            if (res.ok)
                window.catalogState = {
                "plugin": pluginRef,
                "status": "ready",
                "reason": null,
                "groups": res.catalog.groups
            };
            else
                window.catalogState = {
                "plugin": pluginRef,
                "status": "error",
                "reason": res.reason,
                "groups": []
            };
            if (res.ok)
                window.catalogComplete = res.catalog.complete === true;

            if (announce === true && window.paletteModel)
                toasts.notify(res.ok ? "success" : "error", res.ok ? window.paletteModel.toastLoaded : res.reason);

            window.refreshDeviceBar();
            window.refreshSourceState();
            window.refreshPalette();
        });
        if (p.hasBridge)
            window.fetchBridgeStatus(p.id);

    }

    function fetchContextIds() {
        EditorClient.callAsync("GetContextMenus", [], function(json) {
            window.contextIds = JSON.parse(json).ids;
            window.refreshSourceState();
        });
    }

    function fetchBridgeStatus(pluginId) {
        EditorClient.callAsync("GetPluginBridge", [pluginId], function(json) {
            window.bridgeStatus = JSON.parse(json);
        });
    }

    function chooseDynamic() {
        window.sourceIntentCurated = false;
        EditorClient.callAsync("SetProfileOverride", [window.sourceState.source.dynamicId]);
    }

    function pickContext(key) {
        const src = window.sourceState ? window.sourceState.source : null;
        if (!src || key === "")
            return ;

        const ctx = src.contexts.find(function(c) {
            return c.key === key;
        });
        if (!ctx)
            return ;

        // Already curated: just activate it; otherwise seed it from the live
        // catalog first (needs the bridge), then activate.
        if (ctx.curated) {
            EditorClient.callAsync("SetProfileOverride", [ctx.id]);
            return ;
        }
        window.sourceBusy = true;
        EditorClient.callAsync("SeedContext", [window.catalogState.plugin.id, key, false], function(json) {
            window.sourceBusy = false;
            const res = JSON.parse(json);
            if (res.ok)
                EditorClient.callAsync("SetProfileOverride", [res.id]);
            else
                toasts.notify("error", res.reason);
        });
    }

    function reseedContext() {
        const src = window.sourceState.source;
        confirm.askModel(src.reseedConfirm, function() {
            window.sourceBusy = true;
            EditorClient.callAsync("SeedContext", [window.catalogState.plugin.id, src.activeContextKey, true], function(json) {
                window.sourceBusy = false;
                const res = JSON.parse(json);
                toasts.notify(res.ok ? "success" : "error", res.ok ? src.reseedSuccess : res.reason);
            });
        });
    }

    function deleteContextPie() {
        const src = window.sourceState.source;
        confirm.askModel(src.deleteConfirm, function() {
            window.sourceBusy = true;
            EditorClient.callAsync("DeleteContext", [window.catalogState.plugin.id, src.activeContextKey], function(json) {
                window.sourceBusy = false;
                const res = JSON.parse(json);
                toasts.notify(res.ok ? "success" : "error", res.ok ? src.deleteSuccess : res.reason);
            });
        });
    }

    function bridgeAction(install) {
        const pluginId = window.catalogState.plugin.id;
        window.sourceBusy = true;
        window.bridgeNote = "";
        EditorClient.callAsync(install ? "InstallPluginBridge" : "UninstallPluginBridge", [pluginId], function(json) {
            window.sourceBusy = false;
            const res = JSON.parse(json);
            window.bridgeNote = res.ok ? (res.note || (install ? "Installed." : "Removed.")) : res.reason;
            window.fetchBridgeStatus(pluginId);
        });
    }

    function paletteAdd(command, label, icon) {
        const item = {
            "label": label,
            "action": {
                "id": window.paletteModel.runActionId,
                "config": {
                    "command": command
                }
            }
        };
        if (icon !== "")
            item.icon = icon;

        window.structEdit("AddItem", [Paths.toIndices(window.viewPath), item]);
    }

    // ── Plugins (#457 C5) ─────────────────────────────────────────────────────
    function refreshPluginUi() {
        if (!window.pluginsState)
            return ;

        EditorClient.callAsync("InspectPluginManager", [window.pluginsState], function(json) {
            window.pluginManagerModel = JSON.parse(json);
        });
        window.refreshShapeSelects();
    }

    function refreshShapeSelects() {
        if (!window.pluginsState || !window.appearance || !window.menuConfig)
            return ;

        EditorClient.callAsync("InspectShapeSelects", [window.pluginsState, window.appearance, window.menuConfig], function(json) {
            window.shapeSelects = JSON.parse(json);
        });
    }

    function fetchPlugins() {
        EditorClient.callAsync("GetPlugins", [], function(json) {
            window.adoptPluginsState(JSON.parse(json));
        });
    }

    // Adopt a fresh plugins snapshot (a pull, or the one an import/uninstall
    // reply carries) and re-inspect everything that lists plugins: the manager,
    // the shape pickers and the style quick-pick (#195 presets).
    function adoptPluginsState(state) {
        window.pluginsState = state;
        window.refreshPluginUi();
        window.refreshNavModel();
        window.fetchCatalog(false);
        // A removed/re-imported shape plugin changes how the scene renders
        // (wedge fallback / fresh module); rebuild so the preview can't keep
        // showing a stale shape.
        window.buildPie();
    }

    // Import: native folder pick -> core inspect -> consent (when the plugin
    // declares permissions or fails verification) -> install -> toasts.
    function importPluginFlow() {
        const dir = NativeDialogs.openFolder(qsTr("Choose a plugin folder"));
        if (dir.length === 0)
            return ;

        EditorClient.callAsync("InspectPlugin", [dir], function(json) {
            const picked = JSON.parse(json);
            if (picked.ok === false) {
                toasts.notify("error", picked.reason);
                return ;
            }
            if (picked.ok !== true)
                return ;

            EditorClient.callAsync("InspectPluginConsent", [picked], function(cJson) {
                const consent = JSON.parse(cJson);
                if (consent === null)
                    window.runImport(picked.srcDir);
                else
                    confirm.askModel(consent, function() {
                    window.runImport(picked.srcDir);
                });
            });
        });
    }

    function runImport(srcDir) {
        window.pluginBusy = true;
        EditorClient.callAsync("ImportPlugin", [srcDir], function(json) {
            window.pluginBusy = false;
            const r = JSON.parse(json);
            if (r.ok === true) {
                window.adoptPluginsState(r.state);
                toasts.notify("success", "Imported " + r.installed.name + " (" + r.installed.kind + ").");
                // A bridge-shipping plugin auto-installs its bridge on import;
                // surfaced separately so it can't mask the import result. A
                // bridge that couldn't install (no FreeCAD / sandbox) is
                // informational, not an error.
                if (r.bridge) {
                    if (r.bridge.ok)
                        toasts.notify("success", r.bridge.note || "Bridge installed.");
                    else
                        toasts.notify("info", "Bridge not installed: " + r.bridge.reason);
                }
            } else if (r.ok === false) {
                toasts.notify("error", r.reason);
            }
        });
    }

    // Remove: usage scan -> confirm (consequences folded into the message) ->
    // optional plugin cleanup hook (its own confirm; the uninstall proceeds
    // either way) -> uninstall -> toast.
    function removePluginFlow(kind, id, name) {
        EditorClient.callAsync("ScanPluginUsages", [id, kind], function(uJson) {
            const usages = JSON.parse(uJson);
            EditorClient.callAsync("InspectPluginRemoval", [name, usages], function(rJson) {
                confirm.askModel(JSON.parse(rJson), function() {
                    window.runUninstall(kind, id, name);
                });
            });
        });
    }

    function runUninstall(kind, id, name) {
        window.pluginBusy = true;
        EditorClient.callAsync("GetPluginUninstallHook", [id], function(hJson) {
            const hook = JSON.parse(hJson);
            const finish = function finish() {
                EditorClient.callAsync("UninstallPlugin", [kind, id], function(json) {
                    window.pluginBusy = false;
                    const r = JSON.parse(json);
                    window.adoptPluginsState(r.state);
                    toasts.notify(r.ok ? "success" : "error", r.ok ? "Removed " + name + "." : r.reason);
                });
            };
            if (hook.available === true)
                confirm.ask(qsTr("Plugin cleanup"), hook.message, qsTr("Run cleanup"), function() {
                EditorClient.callAsync("PerformPluginUninstallHook", [id], function(pJson) {
                    const pr = JSON.parse(pJson);
                    toasts.notify(pr.ok ? "success" : "error", pr.ok ? "Cleanup done." : pr.reason);
                    finish();
                });
            }, finish);
            else
                finish();
        });
    }

    // The per-menu shape override (#107): sentinel string from the picker ->
    // the three-state config field (absent = inherit, null = wedge, key =
    // that plugin shape), persisted like any other config edit.
    function setMenuShapeModel(v) {
        if (!window.menuConfig)
            return ;

        const copy = JSON.parse(JSON.stringify(window.menuConfig));
        if (v === "__inherit__")
            delete copy.shapeModel;
        else if (v === "")
            copy.shapeModel = null;
        else
            copy.shapeModel = v;
        window.writeMenuConfig(copy);
    }

    // ── Desktop tab (#457 C4) ─────────────────────────────────────────────────
    function refreshDesktopModel() {
        if (!window.desktopSettings || !window.menuConfig)
            return ;

        EditorClient.callAsync("InspectDesktopSettings", [window.desktopSettings, window.menuConfig, window.deviceButtons], function(json) {
            window.desktopModel = JSON.parse(json);
        });
    }

    function fetchDesktopSettings() {
        EditorClient.callAsync("GetDesktopSettings", [], function(json) {
            window.desktopSettings = JSON.parse(json);
            window.refreshDesktopModel();
        });
    }

    // Apply one desktop edit: adopt the transform's result optimistically (the
    // model re-inspects so the controls track instantly) and restart the
    // debounced persist, so a slider drag writes once instead of per step.
    function editDesktop(op) {
        if (!window.desktopSettings)
            return ;

        EditorClient.callAsync("EditDesktopSettings", [window.desktopSettings, op], function(resJson) {
            const res = JSON.parse(resJson);
            if (res.changed !== true)
                return ;

            window.desktopSettings = res.settings;
            // A numeric field edit is a slider drag: re-inspecting now would
            // rebuild the Repeater delegates and destroy the slider under the
            // cursor, so the refresh waits for the settle (the persist timer);
            // the read-out tracks the drag locally. Everything else (kind
            // changes, buttons, activation) re-inspects immediately.
            if (op.kind === "setAxisField" && typeof op.value === "number") {
                desktopPersist.restart();
            } else {
                window.refreshDesktopModel();
                desktopPersist.restart();
            }
        });
    }

    // Re-pull only the appearance, then rebuild the pie. Used on the
    // PieAppearanceChanged push (a slider/toggle change): the menu config and
    // the path-info are unaffected, so skip GetMenuConfig + refreshPathInfo,
    // which a slider drag would otherwise fire dozens of times (#473).
    function rebuildAppearance() {
        EditorClient.callAsync("GetPieAppearance", [], function(apJson) {
            window.appearance = JSON.parse(apJson);
            window.buildPie();
            // The app-level shape default feeds the pickers' inherit label.
            window.refreshShapeSelects();
        });
    }

    // Select a node: highlight it (tree + properties + the pie wedge) and show
    // the ring that contains it (viewPath = its parent).
    // The config is unchanged, so only the pie is rebuilt.
    function selectNode(path) {
        // hasSelection before selectedPath: the onSelectedPathChanged handler
        // refreshes the path-info and bails while nothing is selected, so the
        // flag must be set first or the very first selection gets no path-info.
        window.hasSelection = true;
        window.selectedPath = path;
        window.viewPath = Paths.parentPath(path);
        window.buildPie();
    }

    // Drill into a branch: it becomes the active ring and the selected node (the
    // tree + breadcrumb follow). Config unchanged, so only the pie is rebuilt.
    function drillInto(path) {
        window.hasSelection = true;
        window.selectedPath = path;
        window.viewPath = path;
        window.buildPie();
    }

    // Walk the recursive config to the node at `path` ("" = root, "/0/1" = a
    // branch). Returns null if the path doesn't resolve.
    function nodeByPath(config, path) {
        if (!config || !config.root)
            return null;

        let node = config.root;
        const parts = path.split("/").filter(function(p) {
            return p.length > 0;
        });
        for (let i = 0; i < parts.length; i++) {
            const idx = parseInt(parts[i]);
            if (!node.branches || idx < 0 || idx >= node.branches.length)
                return null;

            node = node.branches[idx];
        }
        return node;
    }

    // Handle a SetMenuConfig reply (the single write-result path). On success
    // adopt the core-validated config + its fresh mtime immediately, so a rapid
    // follow-up edit builds on the latest config + baseline instead of a stale
    // one (which would conflict and be dropped). A true conflict means an
    // external change; the core's MenuConfigChanged push then reconciles.
    function onMenuWritten(resJson) {
        const res = JSON.parse(resJson);
        // The restore marker is consumed on every reply: a rejected restore
        // (conflict / error) leaves the stacks untouched, and a later normal
        // write must not be mistaken for one.
        const history = window.pendingHistory;
        window.pendingHistory = null;
        if (res.ok === true) {
            if (history !== null) {
                // An undo/redo landed: the restored entry leaves its stack and
                // the document it replaced goes onto the opposite one.
                if (history.direction === "undo") {
                    window.redoStack = window.redoStack.concat([window.menuConfig]);
                    window.undoStack = window.undoStack.slice(0, -1);
                } else {
                    window.undoStack = window.undoStack.concat([window.menuConfig]);
                    window.redoStack = window.redoStack.slice(0, -1);
                }
            } else if (JSON.stringify(window.menuConfig) !== JSON.stringify(res.config)) {
                // A real edit: the prior document becomes undoable and the redo
                // branch dies (linear history). A no-op write (same document,
                // e.g. a blur that committed nothing) adds no entry — both
                // sides are core-serialized JSON, so the string compare is the
                // deep equality here.
                window.undoStack = window.undoStack.concat([window.menuConfig]).slice(-Theme.undoHistoryLimit);
                window.redoStack = [];
            }
            window.menuConfig = res.config;
            window.menuMtime = res.mtime;
            window.conflictPending = null;
            window.saveError = "";
            window.refreshNavModel();
            window.refreshDesktopModel();
            window.refreshShapeSelects();
        } else if (res.ok === 'conflict') {
            // The config changed under us (another editor / external write);
            // the writer reports it as ok:'conflict' WITH the file's current
            // mtime. Keep both: Overwrite re-writes the dropped edit against
            // exactly that baseline (a refetch could race or return a stale
            // in-memory state); the watcher push reconciles the view.
            window.conflictPending = {
                "config": window.lastAttemptedConfig,
                "mtime": res.mtime
            };
        } else {
            window.saveError = res.reason || qsTr("unknown error");
        }
        window.lastAttemptedConfig = null;
    }

    // One history step (Ctrl+Z / Ctrl+Y): restore the top of the stack via the
    // normal write path, so the core validates and every consumer (tree,
    // preview, pie) updates like any edit. Bails while a write or another
    // restore is in flight (the stacks must shift against the document the
    // reply replaces) and on a read-only source
    // (read-only no-ops).
    function stepHistory(direction) {
        const stack = direction === "undo" ? window.undoStack : window.redoStack;
        if (stack.length === 0 || !window.menuConfig || window.readOnly)
            return ;

        if (window.lastAttemptedConfig !== null || window.pendingHistory !== null)
            return ;

        // A focused text editor owns its shortcuts:
        // Ctrl+Z / Ctrl+Shift+Z never reach us there (the field claims
        // them via shortcut override), but Ctrl+Y is not an editing key on
        // Linux and would fall through to the document redo mid-typing.
        // cursorPosition marks the text-editing items (TextInput/TextEdit).
        const focus = window.activeFocusItem;
        if (focus !== null && focus.cursorPosition !== undefined)
            return ;

        window.pendingHistory = {
            "direction": direction
        };
        window.writeMenuConfig(stack[stack.length - 1]);
    }

    function writeMenuConfig(config, then) {
        window.lastAttemptedConfig = config;
        EditorClient.callAsync("SetMenuConfig", [config, window.menuMtime], function(wrJson) {
            window.onMenuWritten(wrJson);
            if (then)
                then(wrJson);

        });
    }

    // Overwrite: re-write the dropped edit against the disk mtime the conflict
    // reply carried (the external content loses, deliberately). A newer
    // external write between the conflict and the click re-raises the banner.
    function overwriteConflict() {
        const pending = window.conflictPending;
        window.conflictPending = null;
        if (!pending || !pending.config)
            return ;

        window.menuMtime = pending.mtime;
        window.writeMenuConfig(pending.config);
    }

    // Apply `mutator(nodeDraft)` to the node at `path` and write the config back.
    // Deep-copies the live config so the edit is atomic; on success the core
    // emits MenuConfigChanged, which re-pulls the snapshot and rebuilds the tree
    // + preview + properties. The single write path for every node edit (label,
    // icon, action, ...).
    function editNode(path, mutator) {
        if (!window.menuConfig)
            return ;

        const copy = JSON.parse(JSON.stringify(window.menuConfig));
        const node = window.nodeByPath(copy, path);
        if (!node)
            return ;

        mutator(node);
        window.writeMenuConfig(copy);
    }

    // Run a core config transform (ApplyActionPick / SetNodeKind / SetActionTarget)
    // on the working config and persist the result. `args` is the transform's args
    // after the config (e.g. [path, actionId]); the core returns the new config,
    // written back via SetMenuConfig. Keeps the shared action/type logic in the
    // core instead of duplicating it in QML.
    function editViaCore(method, args) {
        if (!window.menuConfig)
            return ;

        EditorClient.callAsync(method, [window.menuConfig].concat(args), function(cfgJson) {
            const newConfig = JSON.parse(cfgJson);
            window.writeMenuConfig(newConfig);
        });
    }

    // ── Tree structure edits (NodeTree) ───────────────────────────────────────
    // Count all descendants a node carries, for the delete-confirm wording.
    function countDescendants(node) {
        if (!node || !node.branches)
            return 0;

        let n = 0;
        for (let i = 0; i < node.branches.length; i++) n += 1 + window.countDescendants(node.branches[i])
        return n;
    }

    // Run a { config, selection } core transform (AddNode / DeleteNode), persist
    // it, and move the selection where the core says (the new / next node).
    // `onApplied` (optional) runs after a successful write, before the selection
    // moves; the tree re-keys its path-keyed view state (expand/cut) there.
    function structEdit(method, tailArgs, onApplied) {
        if (!window.menuConfig)
            return ;

        EditorClient.callAsync(method, [window.menuConfig].concat(tailArgs), function(resJson) {
            const res = JSON.parse(resJson);
            window.writeMenuConfig(res.config, function(wrJson) {
                const wr = JSON.parse(wrJson);
                if (wr.ok === true) {
                    if (onApplied)
                        onApplied(res.selection);

                    window.selectNode(Paths.toPath(res.selection));
                }
            });
        });
    }

    // ── Tree moves (MenuList part B) ───────────────────────────────────────────
    // Run a move transform (MoveNode / MoveNodeBetween) and persist it. The core
    // returns the moved node's path as the selection; a REJECTED move returns the
    // input config with the selection still on the node, detected here by the
    // unchanged path. Then nothing is written, the selection stays put and a
    // pending cut is kept so the user can pick another target.
    function applyMove(method, tailArgs, fromPath, paste) {
        if (!window.menuConfig)
            return ;

        EditorClient.callAsync(method, [window.menuConfig].concat(tailArgs), function(resJson) {
            const res = JSON.parse(resJson);
            const toPath = Paths.toPath(res.selection);
            if (toPath === fromPath)
                return ;

            window.writeMenuConfig(res.config, function(wrJson) {
                if (JSON.parse(wrJson).ok === true) {
                    tree.remapAfterMove(fromPath, toPath, paste);
                    window.selectNode(toPath);
                }
            });
        });
    }

    // Move the node at `fromPath` into `toRing`, inserting before gap `insertAt`
    // (a drag drop, or paste = true for the keyboard V). A same-ring gap maps to
    // the reorder index (`moveNode` splices the node out first, so a downward
    // insertion decrements; the node's own slot and the gap after it are no-ops).
    function moveInto(fromPath, toRing, insertAt, paste) {
        const fromIndex = Paths.lastIndex(fromPath);
        if (Paths.parentPath(fromPath) === toRing) {
            const to = insertAt > fromIndex ? insertAt - 1 : insertAt;
            if (to === fromIndex)
                return ;

            window.applyMove("MoveNode", [Paths.toIndices(toRing), fromIndex, to], fromPath, paste);
        } else {
            window.applyMove("MoveNodeBetween", [Paths.toIndices(fromPath), Paths.toIndices(toRing), insertAt], fromPath, paste);
        }
    }

    // Alt+↑/↓: reorder the node one slot within its ring (bounds-checked).
    function moveWithin(path, delta) {
        const ring = Paths.parentPath(path);
        const from = Paths.lastIndex(path);
        const to = from + delta;
        const parent = ring === "" ? window.menuConfig.root : window.nodeByPath(window.menuConfig, ring);
        const ringLen = (parent && parent.branches) ? parent.branches.length : 0;
        if (to < 0 || to >= ringLen)
            return ;

        window.applyMove("MoveNode", [Paths.toIndices(ring), from, to], path, false);
    }

    // A tree drag began: fetch the rings the dragged node may move into (the
    // drop-line gates on them; the move transform re-validates regardless).
    function fetchMoveTargets(path) {
        EditorClient.callAsync("GetMoveTargets", [window.menuConfig, Paths.toIndices(path)], function(json) {
            tree.moveTargets = JSON.parse(json).map(Paths.toPath);
        });
    }

    function addTopLevel() {
        window.structEdit("AddNode", [[]]);
    }

    // ＋ on a node: add a child into a branch, or turn a leaf into a submenu
    // (SetNodeKind seeds one child), then select the new child.
    function addChild(path, isBranch) {
        if (isBranch)
            window.structEdit("AddNode", [Paths.toIndices(path)]);
        else if (window.menuConfig)
            EditorClient.callAsync("SetNodeKind", [window.menuConfig, Paths.toIndices(path), "submenu"], function(cfgJson) {
            window.writeMenuConfig(JSON.parse(cfgJson), function(wrJson) {
                if (JSON.parse(wrJson).ok === true)
                    window.selectNode(path + "/0");

            });
        });
    }

    // 🗑 on a node: confirm when it drops a populated submenu, then delete.
    function deleteNodeAt(path) {
        const node = window.nodeByPath(window.menuConfig, path);
        const ringPath = Paths.toIndices(Paths.parentPath(path));
        const index = Paths.lastIndex(path);
        const count = window.countDescendants(node);
        // The tree's expand/cut state is path-keyed, so a delete re-keys it
        // (later siblings shift down; keys inside the deleted subtree drop).
        const remap = function remap() {
            tree.remapAfterDelete(Paths.parentPath(path), index);
        };
        if (count > 0) {
            const name = (node && node.label && node.label.length > 0) ? ("\"" + node.label + "\"") : qsTr("this submenu");
            const items = count === 1 ? qsTr("1 item") : qsTr("%1 items").arg(count);
            confirm.ask(qsTr("Delete submenu?"), qsTr("Delete %1 and its %2?").arg(name).arg(items), qsTr("Delete"), function() {
                window.structEdit("DeleteNode", [ringPath, index], remap);
            });
        } else {
            window.structEdit("DeleteNode", [ringPath, index], remap);
        }
    }

    // Inline rename: set the node's label. The centre/root may be label-less (it
    // renders ✕, mirroring the Properties label field's isRoot case); every other
    // node must keep a label or an icon, so clearing an icon-less one is rejected.
    function renameNode(path, label) {
        const trimmed = label.trim();
        const isRoot = path === "";
        window.editNode(path, function(s) {
            if (isRoot || trimmed !== "" || (s.icon && s.icon.length > 0))
                s.label = trimmed;

        });
    }

    // Pull the available actions for the Action dropdown; refreshed on startup
    // and on the core's ActionsChanged push (a plugin load/unload).
    function fetchActions() {
        EditorClient.callAsync("GetAvailableActions", [], function(json) {
            window.actions = JSON.parse(json);
        });
    }

    // Pull the appearance slider ranges once (they're constants).
    function fetchRanges() {
        EditorClient.callAsync("GetAppearanceRanges", [], function(json) {
            window.ranges = JSON.parse(json);
        });
    }

    // Patch the pie appearance (fire-and-forget); the core's PieAppearanceChanged
    // push then re-pulls it + rebuilds the preview.
    function setAppearance(patch) {
        EditorClient.callAsync("SetPieAppearance", [patch]);
    }

    // Restore the remembered window size before the reveal (#457 D7). Size
    // only: a Wayland client can't position its own window, so the restore
    // reduces to a clamp of the remembered size to
    // the window's own screen (a size saved on a larger monitor must not
    // restore beyond the screen it opens on; QML doesn't expose a per-screen
    // *available* area, so the full screen size is the bound). null = nothing
    // saved, keep the Theme defaults.
    function applySavedSize(saved) {
        if (saved !== null) {
            window.width = Math.min(Math.round(saved.width), Screen.width);
            window.height = Math.min(Math.round(saved.height), Screen.height);
        }
        window.windowSizeRestored = true;
        // The assignments above armed the persist via onWidth/HeightChanged;
        // writing the just-read value back would be a pointless save.
        windowSizePersist.stop();
    }

    // Persist the current size: debounced while resizing, flushed (sync) on
    // close so the final geometry survives the process exit. Only a normal
    // windowed size is remembered; a maximized/fullscreen size would restore
    // as a giant floating window.
    function saveWindowSize(flush) {
        if (!window.windowSizeRestored || window.visibility !== Window.Windowed)
            return ;

        const size = {
            "width": window.width,
            "height": window.height
        };
        if (flush)
            EditorClient.callSync("SetEditorWindow", [size]);
        else
            EditorClient.callAsync("SetEditorWindow", [size]);
    }

    // Settings tab: pull the editor theme, autostart, grab and the font presets.
    function fetchSettings() {
        EditorClient.callAsync("GetTheme", [], function(json) {
            Theme.theme = JSON.parse(json);
            window.themeReady = true;
        });
        EditorClient.callAsync("GetEditorWindow", [], function(json) {
            window.applySavedSize(JSON.parse(json));
        });
        EditorClient.callAsync("GetAutostart", [], function(json) {
            window.autostart = JSON.parse(json);
        });
        EditorClient.callAsync("GetInputSettings", [], function(json) {
            window.grabWhilePieOpen = JSON.parse(json).grabWhilePieOpen;
        });
        EditorClient.callAsync("GetFontPresets", [], function(json) {
            window.fontPresets = JSON.parse(json);
        });
        EditorClient.callAsync("GetMenuLimits", [], function(json) {
            window.menuMaxDepth = JSON.parse(json).maxDepth;
        });
        window.fetchDeviceInfo();
        window.fetchDesktopSettings();
        window.fetchPlugins();
        window.fetchContextIds();
        window.fetchProfiles();
    }

    // Settings setters. Theme + grab are optimistic (void); autostart adopts the
    // core's authoritative result (it re-reads the on-disk autostart entry).
    function setTheme(choice) {
        Theme.theme = choice;
        EditorClient.callAsync("SetTheme", [choice]);
    }

    function setAutostart(on) {
        window.autostart = on;
        EditorClient.callAsync("SetAutostart", [on], function(json) {
            window.autostart = JSON.parse(json);
        });
    }

    function setGrab(on) {
        window.grabWhilePieOpen = on;
        EditorClient.callAsync("SetInputSettings", [{
            "grabWhilePieOpen": on
        }]);
    }

    function setFontUi(next) {
        EditorClient.callAsync("SetPieAppearance", [{
            "fontUi": next
        }]);
    }

    function setFontMono(next) {
        EditorClient.callAsync("SetPieAppearance", [{
            "fontMono": next
        }]);
    }

    // Ask the core whether the selected node is a path action and whether its
    // target resolves. The config commits coarsely (on blur / write-back), so no
    // debounce is needed; refreshed on selection + config change.
    function refreshPathInfo() {
        if (!window.menuConfig || !window.hasSelection) {
            window.pathInfo = {
                "kind": null,
                "warning": null
            };
            return ;
        }
        EditorClient.callAsync("InspectActionPath", [window.menuConfig, Paths.toIndices(window.selectedPath)], function(json) {
            window.pathInfo = JSON.parse(json);
        });
    }

    width: Theme.windowWidth
    height: Theme.windowHeight
    // Keep the pie at its smallest scale (#473) always fully visible without
    // scrollbars: the preview pane never shrinks below the min-scale pie, so the
    // side panels can't be squeezed over it. The pie is square, so the same
    // bound applies to both axes; width also reserves the two side panels.
    minimumWidth: window.treeWidth + window.propsWidth + 2 * Theme.splitHandleWidth + Math.ceil(window.previewMinSize)
    minimumHeight: Math.ceil(window.previewMinSize)
    visible: themeReady || themeFallback.triggered
    title: qsTr("SpaceUX Editor")
    color: Theme.base
    onSelectedPathChanged: {
        window.refreshPathInfo();
        window.refreshNavModel();
    }
    // Focus gates the trigger suppression core-side ("driving the preview" vs
    // "editor open behind"); re-report on every focus change while live.
    onActiveChanged: {
        if (window.livePreview)
            window.reportLive();

    }
    onViewPathChanged: {
        if (window.livePreview && !window.adoptingLiveNav)
            EditorClient.callAsync("SetLiveView", [Paths.toIndices(window.viewPath)]);

    }
    // Covers the first selection of the centre ("" stays "" but hasSelection
    // flips), which onSelectedPathChanged alone would miss.
    onHasSelectionChanged: window.refreshNavModel()
    // Remember the window size, settled (a drag-resize streams a value per
    // frame; saveWindowSize gates out the pre-restore default).
    onWidthChanged: windowSizePersist.restart()
    onHeightChanged: windowSizePersist.restart()
    // The process exits with the window: flush the pending debounced writes
    // synchronously, their timers would never fire again.
    onClosing: {
        windowSizePersist.stop();
        window.saveWindowSize(true);
        if (desktopPersist.running) {
            desktopPersist.stop();
            EditorClient.callSync("SetDesktopSettings", [window.desktopSettings]);
        }
    }
    Component.onCompleted: {
        window.rebuildScene();
        window.fetchActions();
        window.fetchRanges();
        window.fetchSettings();
    }

    // Top tab bar (Settings | Pie menu; Desktop is the C4 slice) + the switched
    // content. Settings is the far-left tab; Pie menu
    // (the 3-pane editor) is the default.
    Column {
        anchors.fill: parent
        spacing: 0

        Item {
            width: parent.width
            height: tabs.height

            TabBar {
                id: tabs

                width: parent.width
                tabs: [qsTr("Settings"), qsTr("Pie menu"), qsTr("Desktop")]
                currentIndex: window.activeTab
                onSelected: function(i) {
                    window.activeTab = i;
                }
            }

            // The device/profile strip at the tab bar's right end (#113, D1).
            DeviceBar {
                anchors.right: parent.right
                anchors.rightMargin: Theme.spaceMd
                anchors.verticalCenter: parent.verticalCenter
                model: window.deviceBarModel
            }

        }

        // Write-rejection banner: a conflict (the config changed outside the
        // editor between our baseline and the write; the dropped edit can be
        // re-applied) or a failed save (reason + dismiss). One at a time,
        // conflict first.
        Rectangle {
            id: writeBanner

            readonly property bool isConflict: window.conflictPending !== null

            // The alert-role automation surface (conflict + failed save).
            Accessible.role: Accessible.AlertMessage
            Accessible.name: writeBanner.isConflict ? qsTr("Configuration changed outside the editor") : window.saveError
            visible: isConflict || window.saveError !== ""
            width: parent.width
            height: visible ? writeBannerRow.implicitHeight + 2 * Theme.spaceSm : 0
            color: Theme.surface

            Row {
                id: writeBannerRow

                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: Theme.spaceMd
                anchors.rightMargin: Theme.spaceMd
                spacing: Theme.spaceMd

                Text {
                    width: parent.width - writeBannerButtons.implicitWidth - Theme.spaceMd
                    anchors.verticalCenter: parent.verticalCenter
                    text: writeBanner.isConflict ? qsTr("The configuration was changed outside the editor; your last edit was not saved.") : qsTr("Save failed: %1").arg(window.saveError)
                    color: writeBanner.isConflict ? Theme.warn : Theme.danger
                    font.pixelSize: Theme.fontSm
                    wrapMode: Text.Wrap
                }

                Row {
                    id: writeBannerButtons

                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Theme.spaceSm

                    Item {
                        visible: writeBanner.isConflict
                        implicitWidth: keepBtn.implicitWidth
                        implicitHeight: keepBtn.implicitHeight

                        Button {
                            id: keepBtn

                            text: qsTr("Keep external")
                            onClicked: window.conflictPending = null
                        }

                        HoverHint {
                            text: qsTr("Keep the configuration as changed outside; your dropped edit is discarded.")
                        }

                    }

                    Item {
                        visible: writeBanner.isConflict
                        implicitWidth: overwriteBtn.implicitWidth
                        implicitHeight: overwriteBtn.implicitHeight

                        Button {
                            id: overwriteBtn

                            destructive: true
                            text: qsTr("Overwrite")
                            onClicked: window.overwriteConflict()
                        }

                        HoverHint {
                            text: qsTr("Re-apply your dropped edit over the outside change.")
                        }

                    }

                    Button {
                        visible: !writeBanner.isConflict
                        text: qsTr("Dismiss")
                        onClicked: window.saveError = ""
                    }

                }

            }

        }

        // Read-only source banner (#77): the active pie is plugin-provided and
        // not editable; persistent state, with the one-click way back.
        Rectangle {
            id: readOnlyBanner

            // The status-role automation surface (read-only note).
            Accessible.role: Accessible.StaticText
            Accessible.name: qsTr("Read-only source")
            visible: window.readOnly
            width: parent.width
            height: visible ? bannerRow.implicitHeight + 2 * Theme.spaceSm : 0
            color: Theme.surface

            Row {
                id: bannerRow

                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: Theme.spaceMd
                anchors.rightMargin: Theme.spaceMd
                spacing: Theme.spaceMd

                Text {
                    width: parent.width - switchBtn.implicitWidth - Theme.spaceMd
                    anchors.verticalCenter: parent.verticalCenter
                    text: (window.sourceState && window.sourceState.banner) ? window.sourceState.banner.text : ""
                    color: Theme.text
                    font.pixelSize: Theme.fontSm
                    wrapMode: Text.Wrap
                }

                Item {
                    id: switchBtn

                    anchors.verticalCenter: parent.verticalCenter
                    implicitWidth: switchInner.implicitWidth
                    implicitHeight: switchInner.implicitHeight

                    Button {
                        id: switchInner

                        text: (window.sourceState && window.sourceState.banner) ? window.sourceState.banner.switchLabel : ""
                        onClicked: EditorClient.callAsync("SetProfileOverride", [null])
                    }

                    HoverHint {
                        text: (window.sourceState && window.sourceState.banner) ? window.sourceState.banner.switchTooltip : ""
                    }

                }

            }

        }

        Item {
            width: parent.width
            height: parent.height - tabs.height - writeBanner.height - readOnlyBanner.height

            // Three panes: the menu structure (left), the interactive pie preview
            // (centre, flexes), and the selected node's properties (right).
            Row {
                id: paneRow

                anchors.fill: parent
                visible: window.activeTab === 1

                // Menu structure (left): the plugin source switch + active
                // context header above the tree, the command palette below.
                Rectangle {
                    id: leftPane

                    width: window.treeWidth
                    height: parent.height
                    color: Theme.panel

                    PluginSourcePanel {
                        id: sourcePanel

                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.margins: model !== null ? Theme.spaceMd : 0
                        // visible alone keeps the implicit height; collapse so
                        // the tree doesn't sit under dead space without a
                        // catalog plugin (same pattern as the context header).
                        height: model !== null ? implicitHeight : 0
                        model: window.sourceState ? window.sourceState.source : null
                        intentCurated: window.sourceIntentCurated
                        busy: window.sourceBusy
                        catalogBusy: window.paletteModel !== null && window.paletteModel.busy === true
                        bridge: window.bridgeStatus
                        bridgeNote: window.bridgeNote
                        onDynamicChosen: window.chooseDynamic()
                        onCuratedIntent: window.sourceIntentCurated = true
                        onContextPicked: function(key) {
                            window.pickContext(key);
                        }
                        onLoadAllRequested: window.loadCatalogAnnounced(true)
                        onReseedRequested: window.reseedContext()
                        onDeleteRequested: window.deleteContextPie()
                        onBridgeInstallRequested: window.bridgeAction(true)
                        onBridgeUninstallRequested: window.bridgeAction(false)
                    }

                    // The active curated context above the tree (#229).
                    Row {
                        id: contextHeader

                        anchors.top: sourcePanel.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.margins: visible ? Theme.spaceMd : 0
                        visible: window.sourceState !== null && window.sourceState.header !== null
                        height: visible ? Theme.controlHeight : 0
                        spacing: Theme.spaceSm

                        Image {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: window.sourceState !== null && window.sourceState.header !== null && window.sourceState.header.icon !== null
                            source: (window.sourceState && window.sourceState.header && window.sourceState.header.icon) ? window.sourceState.header.icon : ""
                            width: Theme.iconSize
                            height: Theme.iconSize
                            sourceSize.width: Theme.iconSize * 2
                            sourceSize.height: Theme.iconSize * 2
                            fillMode: Image.PreserveAspectFit
                        }

                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: (window.sourceState && window.sourceState.header) ? window.sourceState.header.label : ""
                            color: Theme.text
                            font.pixelSize: Theme.fontMd
                            font.bold: true
                        }

                    }

                    NodeTree {
                        id: tree

                        anchors.top: contextHeader.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: paletteSplit.top
                        config: window.menuConfig
                        selectedPath: window.selectedPath
                        readOnly: window.readOnly
                        maxDepth: window.menuMaxDepth
                        onNodeSelected: function(path) {
                            window.selectNode(path);
                        }
                        onAddTopLevelRequested: window.addTopLevel()
                        onAddChildRequested: function(path, isBranch) {
                            window.addChild(path, isBranch);
                        }
                        onDeleteRequested: function(path) {
                            window.deleteNodeAt(path);
                        }
                        onRenameCommitted: function(path, label) {
                            window.renameNode(path, label);
                        }
                        onDragStarted: function(path) {
                            window.fetchMoveTargets(path);
                        }
                        onMoveRequested: function(fromPath, toRing, insertAt, paste) {
                            window.moveInto(fromPath, toRing, insertAt, paste);
                        }
                        onReorderRequested: function(path, delta) {
                            window.moveWithin(path, delta);
                        }
                    }

                    // Drag to resize the palette's command list (#457): the
                    // splitter translates its position into the list cap,
                    // leaving the tree its minimum height.
                    SplitHandle {
                        id: paletteSplit

                        horizontal: true
                        visible: window.paletteModel !== null
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: palette.top
                        onDragged: function(y) {
                            const chrome = palette.implicitHeight - palette.listHeightNow;
                            const total = leftPane.height - y - Theme.spaceMd;
                            const maxList = leftPane.height - sourcePanel.height - contextHeader.height - Theme.treeMinHeight - chrome;
                            window.paletteListHeight = Math.max(Theme.paletteMinListHeight, Math.min(total - chrome, maxList));
                        }
                    }

                    CommandPalette {
                        id: palette

                        anchors.bottom: parent.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.margins: model !== null ? Theme.spaceMd : 0
                        // The palette caps its own command list (scrollable);
                        // only collapse the whole block when hidden.
                        height: model !== null ? implicitHeight : 0
                        model: window.paletteModel
                        listCap: window.paletteListHeight
                        enabledOnly: window.paletteEnabledOnly
                        onEnabledOnlyToggled: function(on) {
                            window.paletteEnabledOnly = on;
                            if (on)
                                window.loadCatalogAnnounced(window.catalogComplete);
                            else
                                window.refreshPalette();
                        }
                        onLoadAllRequested: window.loadCatalogAnnounced(true)
                        onCommandAdded: function(command, label, icon) {
                            window.paletteAdd(command, label, icon);
                        }
                    }

                }

                // Drag to widen the tree (never below its initial width); the
                // preview gives up the space.
                SplitHandle {
                    height: parent.height
                    onDragged: function(x) {
                        window.treeWidth = Math.max(Theme.panelLeftWidth, Math.min(x, paneRow.width - window.propsWidth - window.previewMinSize - 2 * Theme.splitHandleWidth));
                    }
                }

                // Pie preview (centre): the shared renderer plus the drill / breadcrumb /
                // select hit-test. Clicking a branch sector drills in, a leaf selects it,
                // a breadcrumb sector navigates up, the centre hole selects the root.
                Item {
                    width: parent.width - window.treeWidth - window.propsWidth - 2 * Theme.splitHandleWidth
                    height: parent.height

                    PiePreview {
                        id: piePreview

                        anchors.fill: parent
                        readOnly: window.readOnly
                        scene: window.scene
                        onDrillRequested: function(index) {
                            window.drillInto(Paths.childPath(window.viewPath, index));
                        }
                        onSelectRequested: function(index) {
                            window.selectNode(Paths.childPath(window.viewPath, index));
                        }
                        onBreadcrumbRequested: function(index) {
                            window.selectNode(Paths.childPath(Paths.parentPath(window.viewPath), index));
                        }
                        onCentreRequested: function() {
                            window.selectNode("");
                        }
                        onReorderRequested: function(from, to) {
                            window.applyMove("MoveNode", [Paths.toIndices(window.viewPath), from, to], Paths.childPath(window.viewPath, from), false);
                        }
                    }

                    // Live preview (#177): drive the highlight with the real
                    // puck; the navigation resolves core-side and is mirrored
                    // here as a non-destructive sandbox.
                    Item {
                        anchors.top: parent.top
                        anchors.left: parent.left
                        anchors.margins: Theme.spaceMd
                        width: liveToggle.implicitWidth
                        height: liveToggle.implicitHeight

                        Toggle {
                            id: liveToggle

                            checked: window.livePreview
                            label: qsTr("Live Preview")
                            onToggled: function(on) {
                                window.setLivePreview(on);
                            }
                        }

                        HoverHint {
                            text: qsTr("Drive the preview highlight with the live SpaceMouse puck")
                        }

                    }

                }

                // Drag to widen the properties (never below its initial width);
                // the preview gives up the space.
                SplitHandle {
                    height: parent.height
                    onDragged: function(x) {
                        window.propsWidth = Math.max(Theme.panelRightWidth, Math.min(paneRow.width - x, paneRow.width - window.treeWidth - window.previewMinSize - 2 * Theme.splitHandleWidth));
                    }
                }

                // Selected-node properties (right). The centre/root edits through the
                // same panel (isRoot drops the Type toggle). Trivial sets go through
                // editNode; the action/type transforms go through the core (editViaCore),
                // both bound to the current selection.
                Properties {
                    width: window.propsWidth
                    height: parent.height
                    node: window.hasSelection ? window.nodeByPath(window.menuConfig, window.selectedPath) : null
                    isRoot: window.selectedPath === ""
                    path: window.selectedPath
                    actions: window.actions
                    pathInfo: window.pathInfo
                    appearance: window.appearance
                    ranges: window.ranges
                    setAppearance: function(patch) {
                        window.setAppearance(patch);
                    }
                    editNode: function(mutator) {
                        window.editNode(window.selectedPath, mutator);
                    }
                    editViaCore: function(method, tail) {
                        window.editViaCore(method, [Paths.toIndices(window.selectedPath)].concat(tail));
                    }
                    navModel: window.navModel
                    styleCustomized: window.styleCustomized
                    editNav: function(op) {
                        window.editNav(op);
                    }
                    shapeSelects: window.shapeSelects
                    setMenuShape: function(v) {
                        window.setMenuShapeModel(v);
                    }
                    readOnly: window.readOnly
                    deviceBarModel: window.deviceBarModel
                    saveProfile: function() {
                        window.saveProfileFlow();
                    }
                    deleteProfile: function() {
                        window.deleteProfileFlow();
                    }
                    overrideProfile: function(v) {
                        EditorClient.callAsync("SetProfileOverride", [v === "" ? null : v]);
                    }
                }

            }

            // Desktop tab (#457 C4): desktop-mode config off the core model.
            DesktopPage {
                anchors.fill: parent
                visible: window.activeTab === 2
                model: window.desktopModel
                deviceResolved: window.deviceResolved
                actions: window.actions
                editDesktop: function(op) {
                    window.editDesktop(op);
                }
            }

            // Settings tab (far left). Global app-level preferences; the host
            // supplies the values + setters that talk to the core.
            SettingsPage {
                anchors.fill: parent
                visible: window.activeTab === 0
                themeChoice: Theme.theme
                setTheme: function(v) {
                    window.setTheme(v);
                }
                autostart: window.autostart
                setAutostart: function(c) {
                    window.setAutostart(c);
                }
                fontUi: window.appearance ? window.appearance.fontUi : ""
                fontMono: window.appearance ? window.appearance.fontMono : ""
                fontPresets: window.fontPresets
                setFontUi: function(next) {
                    window.setFontUi(next);
                }
                setFontMono: function(next) {
                    window.setFontMono(next);
                }
                grabWhilePieOpen: window.grabWhilePieOpen
                setGrab: function(c) {
                    window.setGrab(c);
                }
                pluginsModel: window.pluginManagerModel
                pluginBusy: window.pluginBusy
                importPlugin: function() {
                    window.importPluginFlow();
                }
                removePlugin: function(kind, id, name) {
                    window.removePluginFlow(kind, id, name);
                }
            }

        }

    }

    Text {
        visible: !EditorClient.connected
        anchors.centerIn: parent
        color: Theme.danger
        font.pixelSize: Theme.fontXl
        text: qsTr("Core not reachable")
    }

    // Show the window after a bounded wait even if the theme never arrives
    // (core unreachable); a late reply then restyles in place.
    Timer {
        id: themeFallback

        property bool triggered: false

        interval: Theme.themeBootstrapTimeoutMs
        running: !window.themeReady
        onTriggered: triggered = true
    }

    // The editor's monospace surfaces follow the appearance's fontMono
    // override; '' falls back to the named default. Lives on the Theme
    // singleton so every consumer reads the one token.
    Binding {
        target: Theme
        property: "fontMono"
        value: window.appearance && window.appearance.fontMono !== "" ? window.appearance.fontMono : Theme.fontMonoDefault
    }

    // Undo/redo over the document history. A focused text field consumes
    // these first through the shortcut-override path, so editing a field
    // keeps the field's own native undo.
    Shortcut {
        sequences: [StandardKey.Undo]
        onActivated: window.stepHistory("undo")
    }

    Shortcut {
        // StandardKey.Redo is Ctrl+Shift+Z here; Ctrl+Y is the other common
        // redo binding, keep both working.
        sequences: [StandardKey.Redo, "Ctrl+Y"]
        onActivated: window.stepHistory("redo")
    }

    // Debounced window-size persist (#457 D7); the final flush rides onClosing.
    Timer {
        id: windowSizePersist

        interval: Theme.windowSizeSaveDebounceMs
        repeat: false
        onTriggered: window.saveWindowSize(false)
    }

    // Debounced desktop-settings persist (the shared debounce rides the model).
    Timer {
        id: desktopPersist

        interval: window.desktopModel ? window.desktopModel.persistDebounceMs : 0
        repeat: false
        onTriggered: {
            EditorClient.callAsync("SetDesktopSettings", [window.desktopSettings]);
            // The deferred re-inspect for slider drags (see editDesktop).
            window.refreshDesktopModel();
        }
    }

    // Modal confirm (the destructive tree delete + the plugin dialogs), over
    // everything; the toast host above it for transient results.
    ConfirmDialog {
        id: confirm
    }

    ToastStack {
        id: toasts
    }

    Connections {
        function onCoreSignal(name, payloadJson) {
            if (name === "MenuConfigChanged") {
                window.rebuildScene();
            } else if (name === "PieAppearanceChanged") {
                window.rebuildAppearance();
            } else if (name === "ActionsChanged") {
                window.fetchActions();
                window.fetchPlugins();
            } else if (name === "PluginInvalidated") {
                window.fetchPlugins();
            } else if (name === "DeviceInfo") {
                window.adoptDeviceInfo(JSON.parse(payloadJson));
            } else if (name === "ContextMenusChanged") {
                window.contextIds = JSON.parse(payloadJson).ids;
                window.refreshSourceState();
            } else if (name === "ProfilesChanged") {
                window.profilesState = JSON.parse(payloadJson);
                window.fetchDeviceInfo();
                window.refreshDeviceBar();
            } else if (name === "LiveNav") {
                if (window.livePreview)
                    window.adoptLiveNav(JSON.parse(payloadJson));

            } else if (name === "DesktopSettingsChanged") {
                window.desktopSettings = JSON.parse(payloadJson);
                window.refreshDesktopModel();
            }
        }

        function onConnectedChanged() {
            // A core restart strands an in-flight nav edit: its reply never
            // comes, which would leave the queue blocked forever. Reset it on
            // any connection change; queued ops are stale against the
            // restarted core's config anyway.
            window.navEditBusy = false;
            window.navEditQueue = [];
            if (EditorClient.connected) {
                window.rebuildScene();
                window.fetchActions();
                window.fetchRanges();
                window.fetchSettings();
            }
        }

        target: EditorClient
    }

}

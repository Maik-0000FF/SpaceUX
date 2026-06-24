// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor
import "paths.js" as Paths

// Right sidebar: editable properties of the selected node (#457 Phase C1 item
// editing). The centre is a node like any other (#129): when the root is
// selected it edits through the same fields, just without the Type toggle. This
// commit ports the Behavior block's Label + Icon; Action / Type / config land in
// the following commits, and the per-item Entry/Exit gesture bindings ride with
// the navigation/input port. Edits run through `editNode`, a Main-provided
// applier that deep-copies the config, mutates the node at the selected path and
// writes it back (SetMenuConfig) — so this component owns no client or path logic.
Rectangle {
    id: root

    // The edited node object (from the live config), or null when nothing is
    // selected. `isRoot` is true for the centre/root node; `path` is its
    // "/"-joined selection path (for field reset keys).
    property var node: null
    property bool isRoot: false
    property string path: ""
    // The available actions (EditorAction[] from GetAvailableActions), for the
    // Action dropdown.
    property var actions: []
    // The selected node's path-action status { kind, warning } from the core:
    // kind ("exec"/"open-file"/null) shows the Browse button, warning the note.
    property var pathInfo: null
    // editNode(mutator): apply `mutator(nodeDraft)` to the selected node and
    // write back (trivial field sets). editViaCore(method, tailArgs): run a core
    // transform (ApplyActionPick / SetNodeKind) on the selected node and persist
    // the result, so the shared action/type logic stays core-side. Both supplied
    // by Main.
    property var editNode: null
    property var editViaCore: null
    // Global pie appearance + slider ranges + setter, forwarded to the
    // Appearance section at the top of the panel.
    property var appearance: null
    property var ranges: null
    property var setAppearance: null
    // The navigation/input UI model (InspectNavInput) + the op applier
    // (EditNavInput + write-back), both Main-provided (#457 C3). The model
    // feeds the Menu settings / Navigation sections and the per-item gesture
    // lists below.
    property var navModel: null
    property var editNav: null
    // Sticky-custom style display (see Main.styleCustomized).
    property bool styleCustomized: false
    // The shape pickers' models (InspectShapeSelects, C5) + the per-menu setter.
    property var shapeSelects: null
    property var setMenuShape: null
    // Read-only source (#77): config-editing sections disable; appearance
    // stays live (it edits the app appearance, not the plugin's config).
    property bool readOnly: false
    // The device bar's model carries the save-profile state (#113); the save
    // lives here by the appearance, since a profile bundles config + look.
    property var deviceBarModel: null
    property var saveProfile: null
    property var deleteProfile: null
    property var overrideProfile: null

    // EditNavInput target for this node's per-item bindings.
    function nodeTarget(binding) {
        return {
            "scope": "node",
            "path": Paths.toIndices(root.path),
            "binding": binding
        };
    }

    color: Theme.panel

    // Last icon-pick error (too large / unsupported), shown under the Icon row.
    property string iconError: ""

    // Whether a node carries a renderable icon (a non-empty data URI / path).
    function hasIcon(n) {
        return n && typeof n.icon === "string" && n.icon.length > 0;
    }
    // Effective visibility of a part (#520): the per-item tri-state flag wins
    // (true = forced hidden, false = forced shown), else the global toggle
    // decides. Drives the eye's struck state and the override it toggles to.
    function partEffectivelyHidden(flag, globalHide) {
        if (flag === true)
            return true;
        if (flag === false)
            return false;
        return !!globalHide;
    }
    function labelEffectivelyHidden() {
        return root.partEffectivelyHidden(root.node ? root.node.labelHidden : undefined, root.appearance && root.appearance.hideLabels);
    }
    function iconEffectivelyHidden() {
        return root.partEffectivelyHidden(root.node ? root.node.iconHidden : undefined, root.appearance && root.appearance.hideIcons);
    }
    // The flag a click on the eye should set, given the current effective state
    // and the global toggle (#520). Flips the effective visibility, but returns
    // `undefined` (inherit the global again) when the wanted state already
    // matches the global one, so toggling back never leaves a stuck override.
    function nextVisibilityFlag(currentEffectiveHidden, globalHide) {
        var wantHidden = !currentEffectiveHidden;
        return wantHidden === !!globalHide ? undefined : wantHidden;
    }
    // The config schema the selected action declares (looked up in the
    // GetAvailableActions list by id), or null when it declares none. Drives the
    // schema-driven config form (#419); without it the raw-JSON editor is used.
    function actionConfigSchema(n) {
        if (!n || !n.action || !root.actions)
            return null;
        for (var i = 0; i < root.actions.length; ++i) {
            if (root.actions[i].id === n.action.id)
                return root.actions[i].config || null;
        }
        return null;
    }
    function apply(mutator) {
        if (root.editNode)
            root.editNode(mutator);
    }

    // The panel scrolls: the global Appearance section sits on top, the selected
    // node's editor below.
    PanelFlickable {
        id: scroll
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: content
            width: parent.width
            spacing: Theme.spaceLg

            // Global pie appearance (theme, sliders, toggles). Collapsed on
            // start so the selected node's properties are the focus; click the
            // header to expand it.
            // The device profile (#113), embedded by the appearance it
            // bundles: which source drives the live config (Auto = follow the
            // device), save the current config + look as the device's
            // profile, delete the active one.
            Column {
                width: parent.width
                spacing: Theme.spaceXs
                visible: root.deviceBarModel !== null

                Text {
                    text: qsTr("Profile")
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontXs
                }

                // One line: the dropdown stretches, Save/Delete sit right of
                // it pinned to the column edge.
                Item {
                    width: parent.width
                    height: Theme.controlHeight

                    Item {
                        anchors.left: parent.left
                        anchors.right: profileButtons.left
                        anchors.rightMargin: Theme.spaceSm
                        height: Theme.controlHeight

                        Select {
                            anchors.fill: parent
                            model: root.deviceBarModel ? root.deviceBarModel.options : []
                            value: root.deviceBarModel ? root.deviceBarModel.value : ""
                            onActivated: function(v) {
                                if (root.overrideProfile)
                                    root.overrideProfile(v);

                            }
                        }

                        HoverHint {
                            text: root.deviceBarModel ? root.deviceBarModel.selectTooltip : ""
                        }

                    }

                    Row {
                        id: profileButtons

                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: Theme.spaceSm

                        Item {
                            width: saveProfileBtn.implicitWidth
                            height: saveProfileBtn.implicitHeight

                            Button {
                                id: saveProfileBtn

                                text: root.deviceBarModel ? root.deviceBarModel.saveLabel : ""
                                enabled: root.deviceBarModel !== null && root.deviceBarModel.saveEnabled
                                opacity: enabled ? 1 : Theme.disabledOpacity
                                onClicked: {
                                    if (root.saveProfile)
                                        root.saveProfile();

                                }
                            }

                            HoverHint {
                                text: root.deviceBarModel ? root.deviceBarModel.saveTooltip : ""
                            }

                        }

                        Item {
                            width: deleteProfileBtn.implicitWidth
                            height: deleteProfileBtn.implicitHeight

                            // Quiet at rest; the red lives in the
                            // destructive confirm that guards the action.
                            Button {
                                id: deleteProfileBtn

                                text: root.deviceBarModel ? root.deviceBarModel.deleteLabel : ""
                                enabled: root.deviceBarModel !== null && root.deviceBarModel.deleteEnabled
                                opacity: enabled ? 1 : Theme.disabledOpacity
                                onClicked: {
                                    if (root.deleteProfile)
                                        root.deleteProfile();

                                }
                            }

                            HoverHint {
                                text: root.deviceBarModel ? root.deviceBarModel.deleteTooltip : ""
                            }

                        }

                    }

                }

            }

            Appearance {
                width: parent.width
                expanded: false
                appearance: root.appearance
                ranges: root.ranges
                setAppearance: root.setAppearance
                shapeSelect: root.shapeSelects ? root.shapeSelects.appearance : null
            }

            // Menu-wide settings + the global navigation gestures (#457 C3),
            // collapsed on start so the
            // selected node's properties stay the focus.
            Section {
                width: parent.width
                title: qsTr("Menu settings")
                expanded: false

                MenuSettingsSection {
                    width: parent.width
                    model: root.navModel ? root.navModel.menuSettings : null
                    editNav: root.editNav
                    shapeMenu: root.shapeSelects ? root.shapeSelects.menu : null
                    setMenuShape: root.setMenuShape
                    enabled: !root.readOnly
                    opacity: enabled ? 1 : Theme.disabledOpacity
                }
            }

            Section {
                width: parent.width
                title: qsTr("Navigation")
                expanded: false

                NavigationSection {
                    width: parent.width
                    enabled: !root.readOnly
                    opacity: enabled ? 1 : Theme.disabledOpacity
                    model: root.navModel
                    styleCustomized: root.styleCustomized
                    editNav: root.editNav
                }
            }

            Rectangle {
                width: parent.width
                height: Theme.borderWidth
                color: Theme.surface
            }

            // The selected node's properties (or a hint when nothing is picked).
            Text {
                color: Theme.text
                font.pixelSize: Theme.fontLg
                font.bold: true
                text: qsTr("Properties")
            }
            Text {
                visible: root.node === null
                color: Theme.textFaint
                font.pixelSize: Theme.fontSm
                text: qsTr("Select a node to edit it.")
            }

            Column {
                visible: root.node !== null
                width: parent.width
                spacing: Theme.spaceLg
                enabled: !root.readOnly
                opacity: enabled ? 1 : Theme.disabledOpacity

                // A node is edited along the flow you run with the puck (#130):
                // how you reach it (Entry), what it does (Behavior), how you
                // leave it (Exit). The centre has no Entry/Exit; its trigger
                // section sits at the end instead.
                Column {
                    visible: !root.isRoot
                    width: parent.width
                    spacing: Theme.spaceXs

                    Text {
                        text: qsTr("↳ Entry")
                        color: Theme.text
                        font.pixelSize: Theme.fontSm
                        font.bold: true
                    }

                    Text {
                        width: parent.width
                        text: qsTr("Reached by aiming at it or stepping onto it (the global navigation). A per-item entry gesture lands later.")
                        color: Theme.textFaint
                        font.pixelSize: Theme.fontXs
                        wrapMode: Text.Wrap
                    }
                }

                Text {
                    text: qsTr("Behavior")
                    color: Theme.text
                    font.pixelSize: Theme.fontSm
                    font.bold: true
                }

                // Label. Commits on Enter / focus-loss (not per keystroke) so the
                // write-back + rebuild can't reset the field mid-typing. An icon-less
                // ring item can't be saved blank (the core validator rejects it), so an
                // empty value there is dropped back to the node's label; the centre may
                // be label-less (it renders ✕), so it writes through blank as "".
                Column {
                    width: parent.width
                    spacing: Theme.spaceXs

                    Item {
                        width: parent.width
                        height: Theme.controlHeight

                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            color: Theme.textMuted
                            font.pixelSize: Theme.fontXs
                            text: qsTr("Label")
                        }
                        // Hide the label in the pie without clearing it (#515). A
                        // label can be hidden once there is text to hide; the centre
                        // (root) renders ✕ when empty, so it can hide that too.
                        EyeToggle {
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            visible: root.node && (root.isRoot || (typeof root.node.label === "string" && root.node.label.length > 0))
                            hidden: root.labelEffectivelyHidden()
                            tooltip: hidden ? qsTr("Show the label in the pie") : qsTr("Hide the label in the pie")
                            // Flip the effective state: set an explicit override,
                            // or clear it back to inherit when the wanted state
                            // matches the global one (#520).
                            onToggled: root.apply(function (s) {
                                var v = root.nextVisibilityFlag(root.labelEffectivelyHidden(), root.appearance && root.appearance.hideLabels);
                                if (v === undefined)
                                    delete s.labelHidden;
                                else
                                    s.labelHidden = v;
                            })
                        }
                    }
                    Rectangle {
                        width: parent.width
                        height: Theme.controlHeight
                        radius: Theme.radiusSm
                        color: Theme.base

                        TextInput {
                            id: labelInput
                            anchors.fill: parent
                            anchors.margins: Theme.spaceSm
                            color: Theme.text
                            font.pixelSize: Theme.fontMd
                            clip: true

                            TextContextMenu {
                                id: ctxMenu
                            }

                            // Reload the field when the edited node changes (the label
                            // commits on finish, so this never fires mid-typing).
                            property var trackedNode: root.node
                            onTrackedNodeChanged: text = root.node ? (root.node.label || "") : ""

                            onEditingFinished: {
                                if (ctxMenu.active)
                                    return;
                                if (!root.isRoot && text.trim() === "" && !root.hasIcon(root.node)) {
                                    text = root.node ? (root.node.label || "") : "";
                                    return;
                                }
                                root.apply(function (s) {
                                    s.label = (root.isRoot && text.trim() === "") ? "" : text;
                                    // A typed label is manual: stop auto-fill from
                                    // a later target change overwriting it (#419).
                                    delete s.labelAuto;
                                });
                            }
                        }
                    }
                }

                // Icon. A native file pick feeds the core's EncodeIcon (size guard + SVG
                // sanitize) which returns the data URI stored on the node. A hand-picked
                // icon is manual: the iconAuto flag is cleared so a later action browse
                // won't replace it.
                Column {
                    width: parent.width
                    spacing: Theme.spaceXs

                    Item {
                        width: parent.width
                        height: Theme.controlHeight

                        Text {
                            anchors.left: parent.left
                            anchors.verticalCenter: parent.verticalCenter
                            color: Theme.textMuted
                            font.pixelSize: Theme.fontXs
                            text: qsTr("Icon")
                        }
                        // Hide the icon in the pie without removing it (#515),
                        // available once the node carries an icon to hide.
                        EyeToggle {
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            visible: root.hasIcon(root.node)
                            hidden: root.iconEffectivelyHidden()
                            tooltip: hidden ? qsTr("Show the icon in the pie") : qsTr("Hide the icon in the pie")
                            // Flip the effective state: explicit override, or clear
                            // back to inherit when the wanted state matches the
                            // global one (#520).
                            onToggled: root.apply(function (s) {
                                var v = root.nextVisibilityFlag(root.iconEffectivelyHidden(), root.appearance && root.appearance.hideIcons);
                                if (v === undefined)
                                    delete s.iconHidden;
                                else
                                    s.iconHidden = v;
                            })
                        }
                    }
                    Row {
                        width: parent.width
                        spacing: Theme.spaceSm

                        Image {
                            visible: root.hasIcon(root.node)
                            source: root.hasIcon(root.node) ? root.node.icon : ""
                            width: Theme.iconSize
                            height: Theme.iconSize
                            sourceSize.width: Theme.iconSize * 2
                            sourceSize.height: Theme.iconSize * 2
                            fillMode: Image.PreserveAspectFit
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Button {
                            anchors.verticalCenter: parent.verticalCenter
                            text: root.hasIcon(root.node) ? qsTr("Replace…") : qsTr("Choose…")
                            onClicked: {
                                root.iconError = "";
                                // The desktop's own file chooser (the portal on Wayland),
                                // shared by every browse action via NativeDialogs.
                                const path = NativeDialogs.openFile(qsTr("Choose an icon"), [qsTr("Images (*.png *.svg *.jpg *.jpeg *.webp *.ico)"), qsTr("All files (*)")]);
                                if (path.length === 0)
                                    return;
                                EditorClient.callAsync("EncodeIcon", [path], function (resJson) {
                                    const r = JSON.parse(resJson);
                                    if (r.ok)
                                        root.apply(function (s) {
                                            s.icon = r.dataUri;
                                            delete s.iconAuto;
                                        });
                                    else
                                        root.iconError = r.reason;
                                });
                            }
                        }
                        Button {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: root.node && root.node.icon !== undefined
                            text: qsTr("Remove")
                            onClicked: root.apply(function (s) {
                                delete s.icon;
                                delete s.iconAuto;
                                delete s.iconHidden;
                            })
                        }
                    }
                    Text {
                        visible: root.iconError.length > 0
                        width: parent.width
                        color: Theme.danger
                        font.pixelSize: Theme.fontXs
                        wrapMode: Text.Wrap
                        text: root.iconError
                    }
                }

                // Type: convert a ring item between a leaf action and a submenu. The
                // centre always hosts the ring, so it has no Type toggle. The conversion
                // runs through the core's SetNodeKind (shared leaf/submenu logic).
                Column {
                    visible: !root.isRoot
                    width: parent.width
                    spacing: Theme.spaceXs

                    Text {
                        color: Theme.textMuted
                        font.pixelSize: Theme.fontXs
                        text: qsTr("Type")
                    }
                    Select {
                        width: parent.width
                        model: [
                            {
                                "value": "action",
                                "label": qsTr("Action")
                            },
                            {
                                "value": "submenu",
                                "label": qsTr("Submenu")
                            }
                        ]
                        value: (root.node && root.node.branches !== undefined) ? "submenu" : "action"
                        onActivated: function (v) {
                            const isSubmenu = root.node && root.node.branches !== undefined;
                            if ((v === "submenu") === isSubmenu)
                                return;
                            if (root.editViaCore)
                                root.editViaCore("SetNodeKind", [v]);
                        }
                    }
                }

                // Action: a leaf's action, or the centre's on-commit action (the centre
                // always can carry one alongside its ring). Hidden for a non-root submenu.
                Column {
                    visible: root.isRoot || (root.node && root.node.branches === undefined)
                    width: parent.width
                    spacing: Theme.spaceMd

                    ActionField {
                        width: parent.width
                        action: root.node ? root.node.action : null
                        actions: root.actions
                        onPicked: function (id) {
                            if (root.editViaCore)
                                root.editViaCore("ApplyActionPick", [id]);
                        }
                        onCustomChanged: function (text) {
                            root.apply(function (s) {
                                if (s.action)
                                    s.action.id = text;
                                else
                                    s.action = {
                                        "id": text
                                    };
                            });
                        }
                        onCleared: root.apply(function (s) {
                            delete s.action;
                        })
                    }

                    // Browse for the exec command / open-file path (shown only for those
                    // path actions). The native picker feeds the core's SetActionTarget,
                    // which quotes for exec and auto-resolves the icon.
                    Button {
                        visible: root.pathInfo && root.pathInfo.kind
                        text: qsTr("Browse for file…")
                        onClicked: {
                            const file = NativeDialogs.openFile(qsTr("Choose a file"), []);
                            if (file.length > 0 && root.editViaCore)
                                root.editViaCore("SetActionTarget", [file]);
                        }
                    }

                    // "Won't fire" note from the on-disk check (the runtime only logs it).
                    Text {
                        visible: root.pathInfo && root.pathInfo.warning
                        width: parent.width
                        color: Theme.danger
                        font.pixelSize: Theme.fontXs
                        wrapMode: Text.Wrap
                        text: "⚠ " + (root.pathInfo ? root.pathInfo.warning : "")
                    }

                    // Config + After action ride inside the action block, shown
                    // only when there's an action to configure / keep open. Config
                    // comes first so the action's own field (e.g. Command) sits
                    // directly under the action picker, above the After-action choice.
                    Column {
                        visible: root.node && root.node.action !== undefined
                        width: parent.width
                        spacing: Theme.spaceMd

                        // Config: schema-driven fields when the action declares a
                        // schema (#419, the built-ins and well-declared plugins);
                        // the raw-JSON editor only when it declares no schema at all
                        // (a plugin action whose fields we can't show). An action
                        // that declares an empty schema (e.g. Cancel) takes no
                        // config, so it shows neither. No toggle: the form preserves
                        // config keys beyond the schema, so a schema-backed action
                        // never needs the JSON fallback.
                        Column {
                            id: configBlock
                            width: parent.width
                            spacing: Theme.spaceXs

                            readonly property var actionSchema: root.actionConfigSchema(root.node)
                            // Whether the action declares a config schema at all; an
                            // empty {} still counts (it means "zero fields"), which
                            // is how a fieldless action shows neither form nor JSON.
                            readonly property bool hasSchema: configBlock.actionSchema !== null && configBlock.actionSchema !== undefined
                            readonly property bool formable: configBlock.hasSchema && Object.keys(configBlock.actionSchema).length > 0
                            readonly property var cfgValue: (root.node && root.node.action) ? root.node.action.config : undefined
                            readonly property var resetKey: root.path + "|" + ((root.node && root.node.action) ? root.node.action.id : "")

                            // Commit via the core so an exec/open-file target
                            // auto-resolves the program icon + name (#419); the
                            // core sets the config and fills icon/label when auto.
                            function commitConfig(cfg) {
                                if (root.editViaCore)
                                    root.editViaCore("SetActionConfig", [cfg === undefined ? null : cfg]);
                            }

                            ActionConfigForm {
                                visible: configBlock.formable
                                width: parent.width
                                schema: configBlock.actionSchema
                                value: configBlock.cfgValue
                                resetKey: configBlock.resetKey
                                editConfig: configBlock.commitConfig
                            }

                            ConfigEditor {
                                visible: !configBlock.hasSchema
                                width: parent.width
                                value: configBlock.cfgValue
                                resetKey: configBlock.resetKey
                                editConfig: configBlock.commitConfig
                            }
                        }

                        Column {
                            width: parent.width
                            spacing: Theme.spaceXs

                            Text {
                                color: Theme.textMuted
                                font.pixelSize: Theme.fontXs
                                text: qsTr("After action")
                            }
                            Select {
                                width: parent.width
                                model: [
                                    {
                                        "value": "close",
                                        "label": qsTr("Close menu")
                                    },
                                    {
                                        "value": "keep",
                                        "label": qsTr("Keep menu open")
                                    }
                                ]
                                value: (root.node && root.node.keepOpen) ? "keep" : "close"
                                onActivated: function (v) {
                                    root.apply(function (s) {
                                        if (v === "keep")
                                            s.keepOpen = true;
                                        else
                                            delete s.keepOpen;
                                    });
                                }
                            }
                        }

                        // Per-item activation (#130): an input that fires THIS
                        // item's binding while it's hovered, on top of the
                        // global trigger. The centre uses its commit gesture
                        // (the Trigger section below) instead.
                        GestureInputList {
                            visible: !root.isRoot
                            width: parent.width
                            heading: qsTr("Activate with")
                            model: (root.navModel && root.navModel.node) ? root.navModel.node.activation : null
                            onSetInput: function (index, value) {
                                if (root.editNav)
                                    root.editNav({
                                    "kind": "setInput",
                                    "target": root.nodeTarget("activation"),
                                    "index": index,
                                    "value": value
                                });
                            }
                            onSetThreshold: function (index, threshold) {
                                if (root.editNav)
                                    root.editNav({
                                    "kind": "setThreshold",
                                    "target": root.nodeTarget("activation"),
                                    "index": index,
                                    "threshold": threshold
                                });
                            }
                            onRemoveInput: function (index) {
                                if (root.editNav)
                                    root.editNav({
                                    "kind": "removeInput",
                                    "target": root.nodeTarget("activation"),
                                    "index": index
                                });
                            }
                            onAddInput: {
                                if (root.editNav)
                                    root.editNav({
                                    "kind": "addInput",
                                    "target": root.nodeTarget("activation")
                                });
                            }
                        }
                    }
                }

                // ↱ Exit (#130): an input that, while this node is hovered,
                // deselects back to the centre (the menu stays open). Resolved
                // ahead of the global gestures, so it wins on a shared input
                // (the shadow note flags that).
                Column {
                    visible: !root.isRoot
                    width: parent.width
                    spacing: Theme.spaceXs

                    Text {
                        text: qsTr("↱ Exit")
                        color: Theme.text
                        font.pixelSize: Theme.fontSm
                        font.bold: true
                    }

                    Text {
                        width: parent.width
                        text: qsTr("\"Go back\" pops to the parent ring. A per-item exit instead returns focus to the centre while the menu stays open, handy when an activation shadows Go back here.")
                        color: Theme.textFaint
                        font.pixelSize: Theme.fontXs
                        wrapMode: Text.Wrap
                    }

                    GestureInputList {
                        width: parent.width
                        heading: qsTr("Exit with")
                        model: (root.navModel && root.navModel.node) ? root.navModel.node.exit : null
                        onSetInput: function (index, value) {
                            if (root.editNav)
                                root.editNav({
                                "kind": "setInput",
                                "target": root.nodeTarget("exit"),
                                "index": index,
                                "value": value
                            });
                        }
                        onSetThreshold: function (index, threshold) {
                            if (root.editNav)
                                root.editNav({
                                "kind": "setThreshold",
                                "target": root.nodeTarget("exit"),
                                "index": index,
                                "threshold": threshold
                            });
                        }
                        onRemoveInput: function (index) {
                            if (root.editNav)
                                root.editNav({
                                "kind": "removeInput",
                                "target": root.nodeTarget("exit"),
                                "index": index
                            });
                        }
                        onAddInput: {
                            if (root.editNav)
                                root.editNav({
                                "kind": "addInput",
                                "target": root.nodeTarget("exit")
                            });
                        }
                    }
                }

                // The centre's trigger (#129): its commitCenter gesture, the
                // per-item "Activate with" parallel, shown instead of
                // Entry/Exit/activation. No shadow warning: it's the centre's
                // own commit, not a per-item override of a global gesture.
                Column {
                    visible: root.isRoot
                    width: parent.width
                    spacing: Theme.spaceXs

                    Text {
                        text: qsTr("Trigger")
                        color: Theme.text
                        font.pixelSize: Theme.fontSm
                        font.bold: true
                    }

                    Text {
                        width: parent.width
                        text: qsTr("How the centre is triggered: the commit gesture that fires its action (or dismisses, when it has none).")
                        color: Theme.textFaint
                        font.pixelSize: Theme.fontXs
                        wrapMode: Text.Wrap
                    }

                    GestureInputList {
                        width: parent.width
                        heading: qsTr("Activate with")
                        model: (root.navModel && root.navModel.centre) ? root.navModel.centre.commit : null
                        onSetInput: function (index, value) {
                            if (root.editNav)
                                root.editNav({
                                "kind": "setInput",
                                "target": {
                                    "scope": "nav",
                                    "gesture": "commitCenter"
                                },
                                "index": index,
                                "value": value
                            });
                        }
                        onSetThreshold: function (index, threshold) {
                            if (root.editNav)
                                root.editNav({
                                "kind": "setThreshold",
                                "target": {
                                    "scope": "nav",
                                    "gesture": "commitCenter"
                                },
                                "index": index,
                                "threshold": threshold
                            });
                        }
                        onRemoveInput: function (index) {
                            if (root.editNav)
                                root.editNav({
                                "kind": "removeInput",
                                "target": {
                                    "scope": "nav",
                                    "gesture": "commitCenter"
                                },
                                "index": index
                            });
                        }
                        onAddInput: {
                            if (root.editNav)
                                root.editNav({
                                "kind": "addInput",
                                "target": {
                                    "scope": "nav",
                                    "gesture": "commitCenter"
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    // The same reusable scrollbar as the preview, on the scrolling panel.
    ScrollBar {
        flickable: scroll
        orientation: Qt.Vertical
        anchors.right: parent.right
        anchors.top: scroll.top
        anchors.bottom: scroll.bottom
    }
}

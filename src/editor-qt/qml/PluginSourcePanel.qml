// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The catalog plugin's pie source switch (#193 / #457 C5 part 2), the Qt port
// of PluginSourceControls: Dynamic (the live plugin pie, read-only) vs Curated
// (the user's editable per-context pie, picked from the context dropdown and
// seeded on first use), with re-seed / delete on the active curated pie and
// the bridge-addon block underneath. Renders the core's source model; the
// flows (override switch, seed, confirms, bridge) live in Main.
Column {
    id: root

    // SourceStateModel.source from the core (null hides the panel).
    property var model: null
    // "Curated clicked but no context picked yet": shows the picker without
    // switching until a context is chosen. Owned by Main (reset on source
    // changes away from the plugin).
    property bool intentCurated: false
    property bool busy: false
    // A catalog pull in flight (the palette model's busy): locks Load all so a
    // second announced pull (duplicate toasts) can't start from here either.
    property bool catalogBusy: false
    // The bridge status ({ resolved, installed, label, reason } | null) + note.
    property var bridge: null
    property string bridgeNote: ""

    signal dynamicChosen()
    signal curatedIntent()
    signal contextPicked(string key)
    signal loadAllRequested()
    signal reseedRequested()
    signal deleteRequested()
    signal bridgeInstallRequested()
    signal bridgeUninstallRequested()

    readonly property bool showCurated: model !== null && (model.activeContextKey !== null || intentCurated)

    visible: model !== null
    spacing: Theme.spaceSm

    Text {
        text: root.model ? root.model.title : ""
        color: Theme.text
        font.pixelSize: Theme.fontSm
        font.bold: true
    }

    SegmentedControl {
        segments: root.model ? [{
            "label": root.model.dynamicLabel,
            "active": root.model.isDynamic && !root.showCurated,
            "tooltip": root.model.dynamicTooltip
        }, {
            "label": root.model.curatedLabel,
            "active": root.showCurated,
            "tooltip": root.model.curatedTooltip
        }] : []
        onSelected: function(index) {
            if (index === 0)
                root.dynamicChosen();
            else
                root.curatedIntent();
        }
    }

    Item {
        visible: root.showCurated
        width: parent.width
        height: Theme.controlHeight

        Select {
            anchors.left: parent.left
            anchors.right: loadAllBtn.left
            anchors.rightMargin: Theme.spaceSm
            anchors.verticalCenter: parent.verticalCenter
            // The context picker: per-option icon + a curated ● marker.
            model: root.model ? root.model.contexts.map(function(c) {
                return {
                    "value": c.key,
                    "label": c.label,
                    "icon": c.icon || "",
                    "marker": c.curated ? "●" : ""
                };
            }) : []
            value: (root.model && root.model.activeContextKey !== null) ? root.model.activeContextKey : ""
            placeholder: root.model ? root.model.pickerPlaceholder : ""
            onActivated: function(key) {
                if (!root.busy)
                    root.contextPicked(key);
            }
        }

        Item {
            id: loadAllBtn

            width: loadAllInner.implicitWidth
            height: loadAllInner.implicitHeight
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter

            Button {
                id: loadAllInner

                text: root.model ? root.model.loadAllLabel : ""
                enabled: !root.busy && !root.catalogBusy
                opacity: enabled ? 1 : Theme.disabledOpacity
                onClicked: root.loadAllRequested()
            }

            HoverHint {
                text: root.model ? root.model.loadAllTooltip : ""
            }

        }

    }

    Row {
        visible: root.model !== null && root.model.activeContextKey !== null
        spacing: Theme.spaceSm

        Item {
            implicitWidth: reseedBtn.implicitWidth
            implicitHeight: reseedBtn.implicitHeight

            Button {
                id: reseedBtn

                text: root.model ? root.model.reseedLabel : ""
                enabled: !root.busy
                opacity: enabled ? 1 : Theme.disabledOpacity
                onClicked: root.reseedRequested()
            }

            HoverHint {
                text: root.model ? root.model.reseedTooltip : ""
            }

        }

        Item {
            implicitWidth: deleteBtn.implicitWidth
            implicitHeight: deleteBtn.implicitHeight

            Button {
                id: deleteBtn

                text: root.model ? root.model.deleteLabel : ""
                enabled: !root.busy
                opacity: enabled ? 1 : Theme.disabledOpacity
                onClicked: root.deleteRequested()
            }

            HoverHint {
                text: root.model ? root.model.deleteTooltip : ""
            }

        }

    }

    Text {
        visible: root.busy
        text: qsTr("Working…")
        color: Theme.textFaint
        font.pixelSize: Theme.fontXs
    }

    Text {
        visible: root.showCurated && !root.busy && root.model !== null && root.model.contexts.length === 0
        width: parent.width
        text: root.model ? root.model.emptyNote : ""
        color: Theme.textFaint
        font.pixelSize: Theme.fontXs
        wrapMode: Text.Wrap
    }

    // The bridge-addon block (#189b): status + install/update/remove, all
    // wording from the plugin via the status payload.
    Column {
        visible: root.model !== null && root.model.hasBridge && root.bridge !== null
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            width: parent.width
            text: root.bridge ? (root.bridge.resolved ? (qsTr("Bridge addon: ") + (root.bridge.installed ? qsTr("installed (%1)").arg(root.bridge.label) : qsTr("not installed (%1)").arg(root.bridge.label))) : root.bridge.reason) : ""
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

        Row {
            visible: root.bridge !== null && root.bridge.resolved
            spacing: Theme.spaceSm

            Button {
                text: (root.bridge && root.bridge.installed) ? qsTr("Reinstall") : qsTr("Install")
                enabled: !root.busy
                opacity: enabled ? 1 : Theme.disabledOpacity
                onClicked: root.bridgeInstallRequested()
            }

            Button {
                visible: root.bridge !== null && root.bridge.installed
                text: qsTr("Remove")
                enabled: !root.busy
                opacity: enabled ? 1 : Theme.disabledOpacity
                onClicked: root.bridgeUninstallRequested()
            }

        }

        Text {
            visible: root.bridgeNote !== ""
            width: parent.width
            text: root.bridgeNote
            color: Theme.textFaint
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

}

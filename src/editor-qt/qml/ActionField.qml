// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// The Action picker (#457): a dropdown of the known actions (builtins + plugins)
// plus "No action" and a "Custom…" escape that reveals a raw pluginId/actionName
// field, so arbitrary or not-currently-loaded actions still work. Stateless about
// which node it edits; emits picked / customChanged / cleared and the parent
// applies them (the known pick goes through the core's ApplyActionPick, the
// custom id is a trivial set). Resets its custom mode when the edited node changes.
Item {
    id: root

    // The node's action ({ id, config } or undefined) and the available actions
    // (EditorAction[] from GetAvailableActions).
    property var action: null
    property var actions: []

    signal picked(string id)
    signal customChanged(string text)
    signal cleared

    readonly property string customSentinel: "__custom__"
    // Mirrors BUILTIN_PLUGIN_ID: a built-in action shows its bare label; a plugin
    // action is suffixed with its source so a shared label stays distinct.
    readonly property string builtinPrefix: "org.spaceux.builtins/"

    readonly property string current: (root.action && root.action.id) ? root.action.id : ""
    readonly property bool isKnown: {
        for (let i = 0; i < root.actions.length; ++i)
            if (root.actions[i].id === root.current)
                return true;
        return false;
    }
    property bool customMode: false
    readonly property bool showCustom: customMode || (current !== "" && !isKnown)

    function selectModel() {
        const out = [{
                "value": "",
                "label": qsTr("No action (label only)")
            }];
        for (let i = 0; i < root.actions.length; ++i) {
            const a = root.actions[i];
            const label = a.id.indexOf(root.builtinPrefix) === 0 ? a.label : a.label + " (" + a.source + ")";
            out.push({
                "value": a.id,
                "label": label
            });
        }
        out.push({
            "value": root.customSentinel,
            "label": qsTr("Custom…")
        });
        return out;
    }

    // Reset the custom field + mode when the edited node changes, so a
    // half-typed custom id never carries over to another node.
    property var trackedAction: root.action
    onTrackedActionChanged: {
        root.customMode = false;
        customInput.text = root.current;
    }

    implicitHeight: column.implicitHeight

    Column {
        id: column
        width: parent.width
        spacing: Theme.spaceMd

        Column {
            width: parent.width
            spacing: Theme.spaceXs

            Text {
                color: Theme.textMuted
                font.pixelSize: Theme.fontXs
                text: qsTr("Action")
            }
            Select {
                width: parent.width
                model: root.selectModel()
                value: root.showCustom ? root.customSentinel : (root.isKnown ? root.current : "")
                onActivated: function (v) {
                    if (v === root.customSentinel) {
                        root.customMode = true;
                    } else if (v === "") {
                        root.customMode = false;
                        root.cleared();
                    } else {
                        root.customMode = false;
                        root.picked(v);
                    }
                }
            }
        }

        Column {
            visible: root.showCustom
            width: parent.width
            spacing: Theme.spaceXs

            Text {
                color: Theme.textMuted
                font.pixelSize: Theme.fontXs
                text: qsTr("Action ID")
            }
            Rectangle {
                width: parent.width
                height: Theme.controlHeight
                radius: Theme.radiusSm
                color: Theme.base

                TextInput {
                    id: customInput
                    anchors.fill: parent
                    anchors.margins: Theme.spaceSm
                    color: Theme.text
                    font.pixelSize: Theme.fontMd
                    clip: true
                    text: root.current
                    onEditingFinished: {
                        if (ctxMenu.active)
                            return;
                        root.customChanged(text);
                    }

                    TextContextMenu {
                        id: ctxMenu
                    }
                }
            }
        }
    }
}

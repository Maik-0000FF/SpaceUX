// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The menu-wide settings (#457 C3), the Qt port of the editor's MenuSettings:
// the trigger button that opens this pie (every option carries its unified
// double-booking marker, #75) and what the button does once the pie is open.
// The per-menu shape override joins with the plugin slice. Everything renders
// off the core's nav model; edits go out as EditNavInput ops via `editNav`.
Column {
    id: root

    // navModel.menuSettings from the core (or null until the first inspect).
    property var model: null
    // editNav(op): Main-provided applier running EditNavInput + the write-back.
    property var editNav: null
    // The per-menu shape override's model (InspectShapeSelects.menu, C5) + the
    // Main-provided setter (sentinel string in, three-state config field out).
    property var shapeMenu: null
    property var setMenuShape: null

    spacing: Theme.spaceMd

    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: qsTr("Trigger button")
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }

        Select {
            width: parent.width
            model: root.model ? root.model.trigger.options : []
            value: root.model ? String(root.model.trigger.value) : "0"
            onActivated: function(v) {
                if (root.editNav)
                    root.editNav({
                    "kind": "setTriggerButton",
                    "button": parseInt(v)
                });
            }
        }

        Text {
            visible: root.model !== null && root.model.trigger.rangeError !== null
            width: parent.width
            text: root.model && root.model.trigger.rangeError ? root.model.trigger.rangeError : ""
            color: Theme.danger
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

        Text {
            visible: root.model !== null && root.model.trigger.conflictNote !== null
            width: parent.width
            text: root.model && root.model.trigger.conflictNote ? root.model.trigger.conflictNote : ""
            color: Theme.warn
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: qsTr("Trigger behavior")
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }

        Select {
            width: parent.width
            model: root.model ? root.model.mode.options : []
            value: root.model ? root.model.mode.value : "toggle"
            onActivated: function(v) {
                if (root.editNav)
                    root.editNav({
                    "kind": "setTriggerMode",
                    "mode": v
                });
            }
        }

        Text {
            width: parent.width
            text: root.model ? root.model.mode.note : ""
            color: Theme.textFaint
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

    // Per-menu shape override (#107, C5): inherit the app default, force the
    // wedge, or force an installed plugin shape for this menu only.
    Column {
        visible: root.shapeMenu !== null
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: qsTr("Shape model")
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }

        Item {
            width: parent.width
            height: shapeSelect.implicitHeight

            Select {
                id: shapeSelect

                width: parent.width
                model: root.shapeMenu ? root.shapeMenu.options : []
                value: root.shapeMenu ? root.shapeMenu.value : ""
                onActivated: function(v) {
                    if (root.setMenuShape)
                        root.setMenuShape(v);
                }
            }

            HoverHint {
                text: root.shapeMenu ? root.shapeMenu.tooltip : ""
            }

        }

        Text {
            width: parent.width
            text: root.shapeMenu ? root.shapeMenu.note : ""
            color: Theme.textFaint
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

}

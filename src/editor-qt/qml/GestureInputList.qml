// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// One gesture's binding editor (#457 C3), the Qt port of the editor's
// GestureInputList: an optional sub-heading, one NavInputRow per bound input,
// an "+ Add input" button, and the pre-worded warnings the core's model put
// under it (conflict lines, the shadow note, the reachability hint).
// Presentation only: every edit is emitted for the host to turn into an
// EditNavInput op against the gesture/binding this list renders.
Column {
    id: root

    property string heading: ""
    // One GestureListModel from the core: { rows, warnings }.
    property var model: null

    signal setInput(int index, string value)
    signal setThreshold(int index, real threshold)
    signal removeInput(int index)
    signal addInput()

    spacing: Theme.spaceSm

    Text {
        visible: root.heading !== ""
        text: root.heading
        color: Theme.textMuted
        font.pixelSize: Theme.fontXs
        font.bold: true
    }

    Repeater {
        model: root.model ? root.model.rows : []

        delegate: NavInputRow {
            id: inputRow

            required property var modelData
            required property int index

            width: root.width
            row: inputRow.modelData
            onPicked: function(v) {
                root.setInput(inputRow.index, v);
            }
            onThresholdEdited: function(t) {
                root.setThreshold(inputRow.index, t);
            }
            onRemoved: root.removeInput(inputRow.index)
        }

    }

    Button {
        text: qsTr("+ Add input")
        onClicked: root.addInput()
    }

    Repeater {
        model: root.model ? root.model.warnings : []

        delegate: Text {
            required property var modelData

            width: root.width
            text: "⚠ " + modelData
            color: Theme.warn
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

}

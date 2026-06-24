// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A reusable visibility toggle (#515) in the editor's small glyph-button style,
// matching the tree's ＋/✎/🗑 controls (see RowButton): an eye glyph, struck
// through and dimmed when the part is hidden, like the visibility toggles in the
// Blender outliner / FreeCAD model tree. `hidden` in, `toggled()` out on click.
// Controlled by the parent. Keyboard-operable (Tab focus, Space/Return) and
// exposed over AT-SPI as a named checkable, part of the automation surface.
Rectangle {
    id: root

    property bool hidden: false
    // Hover help text (the central bubble); the parent supplies it so the
    // wording can reflect what is hidden and the current state.
    property string tooltip: ""
    signal toggled

    implicitWidth: Theme.controlHeight
    implicitHeight: Theme.controlHeight
    // No frame / background: the control is just the glyph, which brightens on
    // hover / focus for feedback.
    color: "transparent"
    activeFocusOnTab: true

    Accessible.role: Accessible.CheckBox
    Accessible.name: qsTr("Visible")
    Accessible.checkable: true
    Accessible.checked: !root.hidden
    Accessible.onToggleAction: root.toggled()
    Accessible.onPressAction: root.toggled()
    Keys.onPressed: function (event) {
        if (event.key === Qt.Key_Space || event.key === Qt.Key_Return) {
            root.toggled();
            event.accepted = true;
        }
    }

    Text {
        anchors.centerIn: parent
        text: "👁"
        font.pixelSize: Theme.fontXl
        // Struck through + faint when hidden; full strength on hover / focus.
        font.strikeout: root.hidden
        color: root.hidden
            ? Theme.textFaint
            : ((area.containsMouse || root.activeFocus) ? Theme.text : Theme.textMuted)
    }

    MouseArea {
        id: area
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.toggled()
    }

    HoverHint {
        text: root.tooltip
    }
}

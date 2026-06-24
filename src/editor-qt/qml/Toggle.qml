// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// An on/off switch (#457), the Qt port of the editor's ui/Toggle. `checked` in,
// `toggled(checked)` out on click; an optional `label` sits to its right.
// Controlled by the parent. One component so every switch matches.
// Keyboard-operable (Tab focus, Space) and exposed over AT-SPI as a named
// checkable — the switch-role automation surface.
Row {
    id: root

    property bool checked: false
    property string label: ""
    signal toggled(bool checked)

    spacing: Theme.spaceMd
    activeFocusOnTab: true
    Accessible.role: Accessible.CheckBox
    Accessible.name: root.label
    Accessible.checkable: true
    Accessible.checked: root.checked
    Accessible.onToggleAction: root.toggled(!root.checked)
    Accessible.onPressAction: root.toggled(!root.checked)
    Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Space) {
            root.toggled(!root.checked);
            event.accepted = true;
        }
    }

    Rectangle {
        id: track
        width: Theme.toggleWidth
        height: Theme.toggleHeight
        radius: height / 2
        anchors.verticalCenter: parent.verticalCenter
        color: root.checked ? Theme.accent : Theme.surface
        border.color: root.activeFocus ? Theme.borderFocus : (root.checked ? Theme.accent : Theme.surfaceStrong)
        border.width: Theme.borderWidth

        Rectangle {
            width: Theme.toggleKnob
            height: Theme.toggleKnob
            radius: height / 2
            color: Theme.text
            anchors.verticalCenter: parent.verticalCenter
            x: root.checked ? parent.width - width - (parent.height - height) / 2 : (parent.height - height) / 2
            Behavior on x {
                NumberAnimation {
                    duration: 90
                }
            }
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.toggled(!root.checked)
        }
    }

    Text {
        visible: root.label.length > 0
        anchors.verticalCenter: parent.verticalCenter
        text: root.label
        color: Theme.text
        font.pixelSize: Theme.fontMd
    }
}

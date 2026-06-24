// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A small reusable secondary button (#457), the Qt port of the editor's
// ui/Button styled to the dark theme. Sizes to its label plus padding and emits
// `clicked`. One component so every button in the editor shares the look.
// Keyboard-operable (Tab focus, Space/Enter) and exposed over AT-SPI as a
// named button — the button-role automation surface.
Rectangle {
    id: root

    property alias text: label.text
    // Destructive actions (delete / remove): danger-tinted label + border.
    property bool destructive: false
    signal clicked()

    implicitWidth: label.implicitWidth + Theme.spaceMd + Theme.spaceLg
    implicitHeight: Theme.rowHeight
    radius: Theme.radius
    color: mouse.pressed ? Theme.surfaceStrong : mouse.containsMouse ? Theme.buttonHover : Theme.surface
    border.color: root.activeFocus ? Theme.borderFocus : (root.destructive ? Theme.danger : Theme.surfaceStrong)
    border.width: Theme.borderWidth
    activeFocusOnTab: true
    Accessible.role: Accessible.Button
    Accessible.name: label.text
    Accessible.onPressAction: root.clicked()
    Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.clicked();
            event.accepted = true;
        }
    }

    Text {
        id: label
        anchors.centerIn: parent
        color: root.destructive ? Theme.danger : Theme.text
        font.pixelSize: Theme.fontSm
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.clicked()
    }
}

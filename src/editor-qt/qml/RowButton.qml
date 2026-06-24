// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A small glyph action button for a tree row (#457): the ＋ / ✎ / 🗑 controls.
// Square, hover-highlighted, emits `clicked`. One component so the three match.
Rectangle {
    id: root

    property string glyph: ""
    // AT-SPI name (the automation surface); the glyph is the
    // fallback. Not a tab stop: the tree's own keyboard covers the row ops.
    property string accessibleName: ""

    signal clicked()

    Accessible.role: Accessible.Button
    Accessible.name: root.accessibleName !== "" ? root.accessibleName : root.glyph
    Accessible.onPressAction: root.clicked()

    implicitWidth: Theme.rowHeight
    implicitHeight: Theme.rowHeight
    radius: Theme.radiusSm
    // `enabled` is the Item built-in: false disables the child MouseArea too, so
    // a click on a disabled button falls through (e.g. the ＋ at max nesting depth).
    opacity: enabled ? 1 : 0.35
    color: area.containsMouse ? Theme.buttonHover : "transparent"

    Text {
        anchors.centerIn: parent
        text: root.glyph
        color: area.containsMouse ? Theme.text : Theme.textMuted
        font.pixelSize: Theme.fontMd
    }

    MouseArea {
        id: area

        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.clicked()
    }

}

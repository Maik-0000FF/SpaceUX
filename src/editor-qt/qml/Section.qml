// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A collapsible titled section (#457): the clickable header toggles its content.
// Consumer children go into the content column (default property), stacked. One
// component so every settings section behaves the same.
Column {
    id: root

    property string title: ""
    property bool expanded: true
    default property alias content: contentColumn.data

    spacing: 0

    Rectangle {
        width: parent.width
        height: Theme.controlHeight
        color: "transparent"

        Row {
            anchors.fill: parent
            spacing: Theme.spaceSm

            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.expanded ? "▾" : "▸"
                color: Theme.textMuted
                font.pixelSize: Theme.fontSm
            }
            Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.title
                color: Theme.text
                font.pixelSize: Theme.fontMd
                font.bold: true
            }
        }
        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.expanded = !root.expanded
        }
    }

    Column {
        id: contentColumn
        width: parent.width
        visible: root.expanded
        spacing: Theme.spaceMd
        bottomPadding: visible ? Theme.spaceMd : 0
    }
}

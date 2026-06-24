// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// One Settings-page section (#457): a heading, a
// description line, then the control(s). Consumer
// children go in the content column below the text (default property).
Column {
    id: root

    property string title: ""
    property string description: ""
    default property alias content: contentCol.data

    spacing: Theme.spaceSm

    Text {
        text: root.title
        color: Theme.text
        font.pixelSize: Theme.fontLg
        font.bold: true
    }
    Text {
        visible: root.description !== ""
        text: root.description
        color: Theme.textMuted
        font.pixelSize: Theme.fontSm
        width: parent.width
        wrapMode: Text.WordWrap
    }
    Column {
        id: contentCol
        width: parent.width
        spacing: Theme.spaceSm
        topPadding: Theme.spaceXs
    }
}

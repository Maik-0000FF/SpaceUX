// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The editor's top tab strip (#457; Settings is
// the far-left tab). A Row of tab buttons; the active one is highlighted with an
// accent underline. Reusable: set `tabs` (labels) + `currentIndex`, listen to
// `selected(index)`.
Rectangle {
    id: root

    property var tabs: []
    property int currentIndex: 0
    signal selected(int index)

    implicitHeight: Theme.tabBarHeight
    color: Theme.panel
    // Keyboard-operable (Tab focus, arrows switch the page) and exposed over
    // AT-SPI as a page-tab list with one named tab per entry (a deliberate
    // upgrade over plain buttons without a tablist role or arrow keys).
    activeFocusOnTab: true
    Accessible.role: Accessible.PageTabList
    Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Left && root.currentIndex > 0) {
            root.selected(root.currentIndex - 1);
            event.accepted = true;
        } else if (event.key === Qt.Key_Right && root.currentIndex < root.tabs.length - 1) {
            root.selected(root.currentIndex + 1);
            event.accepted = true;
        }
    }

    Row {
        anchors.left: parent.left
        anchors.leftMargin: Theme.spaceMd
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        spacing: Theme.spaceXs

        Repeater {
            model: root.tabs

            delegate: Item {
                id: tab

                required property int index
                required property string modelData

                width: label.implicitWidth + 2 * Theme.spaceLg
                height: parent.height
                Accessible.role: Accessible.PageTab
                Accessible.name: tab.modelData
                Accessible.onPressAction: root.selected(tab.index)

                Text {
                    id: label
                    anchors.centerIn: parent
                    text: tab.modelData
                    color: root.currentIndex === tab.index ? Theme.text : Theme.textMuted
                    font.pixelSize: Theme.fontMd
                }
                Rectangle {
                    anchors.bottom: parent.bottom
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: parent.width - 2 * Theme.spaceSm
                    height: Theme.borderWidth * 2
                    color: Theme.accent
                    visible: root.currentIndex === tab.index
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.selected(tab.index)
                }
            }
        }
    }

    // Bottom divider under the strip.
    Rectangle {
        anchors.bottom: parent.bottom
        width: parent.width
        height: Theme.borderWidth
        color: Theme.surface
    }
}

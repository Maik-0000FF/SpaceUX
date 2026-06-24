// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A thin draggable divider between two editor panes (a #457 improvement
// over fixed columns). The default is a vertical bar between
// side-by-side panes reporting the cursor's x within the parent; `horizontal`
// flips it to a flat bar between stacked panes reporting y (the palette-height
// splitter). The host turns the position into a pane size and clamps it. A
// wider invisible hit area makes the thin bar easy to grab; it highlights on
// hover and drag.
Rectangle {
    id: root

    property bool horizontal: false
    signal dragged(real posInParent)

    width: root.horizontal ? 0 : Theme.splitHandleWidth
    height: root.horizontal ? Theme.splitHandleWidth : 0
    color: (area.containsMouse || area.pressed) ? Theme.borderFocus : Theme.surface

    MouseArea {
        id: area

        anchors.fill: parent
        anchors.leftMargin: root.horizontal ? 0 : -Theme.spaceXs
        anchors.rightMargin: root.horizontal ? 0 : -Theme.spaceXs
        anchors.topMargin: root.horizontal ? -Theme.spaceXs : 0
        anchors.bottomMargin: root.horizontal ? -Theme.spaceXs : 0
        hoverEnabled: true
        cursorShape: root.horizontal ? Qt.SplitVCursor : Qt.SplitHCursor
        onPositionChanged: {
            if (pressed) {
                const p = area.mapToItem(root.parent, mouseX, mouseY);
                root.dragged(root.horizontal ? p.y : p.x);
            }
        }
    }

}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// A hover help bubble (#457 C5): place it INSIDE any item and set `text`; while
// the parent is hovered, the wrapped text shows in a themed bubble at the
// window top level (over open popups too), pulled inside the window edges.
// THE one bubble implementation: ConflictMark and the plugin badges/chips all
// render their hover help through this, so the look + timing live here.
Item {
    id: root

    property string text: ""

    anchors.fill: parent

    HoverHandler {
        id: hover

        enabled: root.text !== ""
    }

    // The open/close delays: a pointer passing
    // through doesn't flash bubbles, and a brief pointer excursion off the
    // trigger doesn't flicker an open one closed.
    Timer {
        id: openDelay

        interval: Theme.tooltipOpenDelayMs
        running: hover.hovered && root.text !== ""
        onTriggered: bubble.shown = true
    }

    Timer {
        id: closeDelay

        interval: Theme.tooltipCloseDelayMs
        running: !hover.hovered && bubble.shown
        onTriggered: bubble.shown = false
    }

    Rectangle {
        id: bubble

        property bool shown: false

        // The tooltip-role automation surface.
        Accessible.role: Accessible.ToolTip
        Accessible.name: root.text
        parent: Window.contentItem
        visible: shown && root.text !== ""
        // Above the dropdown popup layer: a hint can sit inside an open option
        // list (same window-level parent), and its bubble must win.
        z: Theme.zPopup + 2
        width: Math.min(bubbleText.implicitWidth, Theme.tooltipMaxWidth) + 2 * Theme.spaceMd
        height: bubbleText.contentHeight + 2 * Theme.spaceSm
        radius: Theme.radiusSm
        color: Theme.panel
        border.color: Theme.surfaceStrong
        border.width: Theme.borderWidth
        onVisibleChanged: {
            if (!visible)
                return ;
            // Pick the side with more room:
            // below the trigger by default, above when the bottom would clip
            // and there is more room up there; clamp into the window on both
            // axes with the edge margin.
            const top = root.mapToItem(Window.contentItem, 0, 0);
            const winH = Window.contentItem.height;
            const below = winH - (top.y + root.height);
            const fitsBelow = below >= height + Theme.tooltipGap;
            const placeAbove = !fitsBelow && top.y >= below;
            const rawY = placeAbove ? top.y - Theme.tooltipGap - height : top.y + root.height + Theme.tooltipGap;
            x = Math.max(Theme.tooltipEdge, Math.min(top.x, Window.contentItem.width - width - Theme.tooltipEdge));
            y = Math.max(Theme.tooltipEdge, Math.min(rawY, winH - height - Theme.tooltipEdge));
        }

        Text {
            id: bubbleText

            anchors.fill: parent
            anchors.leftMargin: Theme.spaceMd
            anchors.rightMargin: Theme.spaceMd
            anchors.topMargin: Theme.spaceSm
            anchors.bottomMargin: Theme.spaceSm
            verticalAlignment: Text.AlignVCenter
            text: root.text
            wrapMode: Text.Wrap
            color: Theme.text
            font.pixelSize: Theme.fontSm
        }

    }

}

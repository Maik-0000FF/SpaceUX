// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A thin scrollbar bound to a Flickable (#473), built from plain QtQuick so the
// QtQuick.Controls Breeze style stays out. Set `flickable` + `orientation`; it
// shows only when that axis overflows. The thumb purely reflects the Flickable's
// position; a track click/drag maps the cursor to the content position (the
// Slider pattern), so there is no binding fight between the drag and the bind.
// Reusable across the scrollable panels (the preview, the properties).
Item {
    id: root

    property Flickable flickable: null
    property int orientation: Qt.Vertical

    readonly property bool vertical: orientation === Qt.Vertical
    readonly property real sizeRatio: !flickable ? 1 : (vertical ? flickable.visibleArea.heightRatio : flickable.visibleArea.widthRatio)
    readonly property real posRatio: !flickable ? 0 : (vertical ? flickable.visibleArea.yPosition : flickable.visibleArea.xPosition)
    // The track length + the thumb length along the bound axis.
    readonly property real track: vertical ? height : width
    readonly property real thumbLen: Math.max(track * sizeRatio, Theme.scrollBarMinThumb)

    visible: flickable !== null && sizeRatio < 1
    implicitWidth: Theme.scrollBarWidth
    implicitHeight: Theme.scrollBarWidth

    // Map a cursor position on the track to the flickable's content position,
    // centring the thumb on the cursor and clamping to the scrollable range.
    function scrollTo(pos) {
        const free = root.track - root.thumbLen;
        if (free <= 0 || !root.flickable)
            return;
        let p = Math.max(0, Math.min(1, (pos - root.thumbLen / 2) / free));
        if (root.vertical)
            root.flickable.contentY = p * (root.flickable.contentHeight - root.flickable.height);
        else
            root.flickable.contentX = p * (root.flickable.contentWidth - root.flickable.width);
    }

    Rectangle {
        id: thumb
        radius: Math.min(width, height) / 2
        color: trackArea.pressed ? Theme.textFaint : Theme.surfaceStrong
        width: root.vertical ? root.width : root.thumbLen
        height: root.vertical ? root.thumbLen : root.height
        x: root.vertical ? 0 : root.posRatio * root.track
        y: root.vertical ? root.posRatio * root.track : 0
    }

    MouseArea {
        id: trackArea
        anchors.fill: parent
        onPressed: function (mouse) {
            root.scrollTo(root.vertical ? mouse.y : mouse.x);
        }
        onPositionChanged: function (mouse) {
            if (pressed)
                root.scrollTo(root.vertical ? mouse.y : mouse.x);
        }
    }
}

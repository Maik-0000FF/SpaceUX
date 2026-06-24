// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A desktop-mannered scroll container: the wheel and the scroll bar scroll,
// dragging the content does NOT pan (Flickable's touch-style default), so
// sliders, range grips and other draggable controls inside a panel can't
// fight the panel itself. Every panel uses this; the pie preview keeps the
// plain Flickable's drag-panning deliberately (it pans a canvas, not a form).
// Wheel: vertical scrolls contentY, horizontal (a tilt wheel / touchpad) or
// Shift+wheel scrolls contentX; touchpad pixel deltas are used when present.
Flickable {
    id: root

    interactive: false
    boundsBehavior: Flickable.StopAtBounds

    function scrollStep(angle, pixel) {
        // Touchpads report exact pixel deltas; wheels report angle in 1/8
        // degree, 120 per notch.
        return pixel !== 0 ? pixel : (angle / 120) * Theme.wheelScrollStep;
    }

    WheelHandler {
        acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
        onWheel: function(event) {
            const dy = root.scrollStep(event.angleDelta.y, event.pixelDelta.y);
            const dx = root.scrollStep(event.angleDelta.x, event.pixelDelta.x);
            const shift = (event.modifiers & Qt.ShiftModifier) !== 0;
            const moveX = shift ? dy : dx;
            const moveY = shift ? 0 : dy;
            if (root.contentHeight > root.height && moveY !== 0)
                root.contentY = Math.max(0, Math.min(root.contentY - moveY, root.contentHeight - root.height));

            if (root.contentWidth > root.width && moveX !== 0)
                root.contentX = Math.max(0, Math.min(root.contentX - moveX, root.contentWidth - root.width));

            event.accepted = true;
        }
    }

}

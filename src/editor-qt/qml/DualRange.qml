// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A two-handle range slider (#457 C3), the Qt port of the editor's ui/DualRange:
// `low`/`high` in [from, to] snapped to `step`, with the band between the
// handles filled. Dragging grabs the nearest handle and a handle can't cross
// the other. Controlled like Slider: the parent owns the values and re-feeds
// them; drags track locally so the handle never lags the round-trip.
Item {
    id: root

    property real from: 0
    property real to: 100
    property real step: 5
    property real low: 0
    property real high: 100
    property bool disabled: false
    signal moved(real low, real high)

    // Local drag state (see Slider.qml for the rationale): the handles track
    // local values while dragging and re-sync to the fed-back props when idle.
    // -2 = pressed on OVERLAPPING handles, handle still undecided: the first
    // drag direction picks it (left = low, right = high), so a collapsed pair
    // separates either way at any position (a deliberate improvement over the
    // previous max-only special case).
    property int dragging: -1 // -1 idle, -2 undecided (overlap), 0 low handle, 1 high handle
    property real localLow: low
    property real localHigh: high
    property real lastLow: NaN
    property real lastHigh: NaN
    // The handle the keyboard steps (0 low, 1 high); Up/Down switch it. Named
    // deviation (#457): one tab stop carries both handles (instead of two
    // stops) to keep the focus chain short.
    property int focusHandle: 0

    implicitHeight: Theme.controlHeight
    implicitWidth: Theme.panelRightWidth / 2
    opacity: disabled ? Theme.disabledOpacity : 1
    activeFocusOnTab: !disabled
    Accessible.role: Accessible.Slider
    Accessible.onIncreaseAction: root.stepBy(1)
    Accessible.onDecreaseAction: root.stepBy(-1)

    // One keyboard/AT-SPI step of the focused handle; the handles can't cross,
    // like the drag path.
    function stepBy(direction) {
        if (root.disabled)
            return ;

        if (root.focusHandle === 0) {
            const v = Math.max(root.from, Math.min(root.localHigh, root.localLow + direction * root.step));
            if (v !== root.lastLow) {
                root.localLow = v;
                root.lastLow = v;
                root.moved(v, root.localHigh);
            }
        } else {
            const v = Math.max(root.localLow, Math.min(root.to, root.localHigh + direction * root.step));
            if (v !== root.lastHigh) {
                root.localHigh = v;
                root.lastHigh = v;
                root.moved(root.localLow, v);
            }
        }
    }

    Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Left)
            root.stepBy(-1);
        else if (event.key === Qt.Key_Right)
            root.stepBy(1);
        else if (event.key === Qt.Key_Up || event.key === Qt.Key_Down)
            root.focusHandle = root.focusHandle === 0 ? 1 : 0;
        else
            return ;

        event.accepted = true;
    }

    onLowChanged: {
        root.lastLow = root.low;
        if (root.dragging < 0)
            root.localLow = root.low;

    }
    onHighChanged: {
        root.lastHigh = root.high;
        if (root.dragging < 0)
            root.localHigh = root.high;

    }

    function ratioOf(v) {
        return (root.to > root.from) ? Math.max(0, Math.min(1, (v - root.from) / (root.to - root.from))) : 0;
    }

    function valueAt(px) {
        const usable = root.width - Theme.sliderHandle;
        const t = usable > 0 ? Math.max(0, Math.min(1, (px - Theme.sliderHandle / 2) / usable)) : 0;
        let v = root.from + Math.round((t * (root.to - root.from)) / root.step) * root.step;
        return Math.max(root.from, Math.min(root.to, v));
    }

    function dragTo(px) {
        const v = root.valueAt(px);
        // An undecided overlap press resolves on the first real movement: a
        // pull below the pair grabs the low handle, above grabs the high one.
        if (root.dragging === -2) {
            if (v < root.localLow)
                root.dragging = 0;
            else if (v > root.localHigh)
                root.dragging = 1;
            else
                return ;
            root.focusHandle = root.dragging;
        }
        if (root.dragging === 0)
            root.localLow = Math.min(v, root.localHigh);
        else if (root.dragging === 1)
            root.localHigh = Math.max(v, root.localLow);
        if (root.localLow !== root.lastLow || root.localHigh !== root.lastHigh) {
            root.lastLow = root.localLow;
            root.lastHigh = root.localHigh;
            root.moved(root.localLow, root.localHigh);
        }
    }

    Rectangle {
        id: groove

        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        height: Theme.sliderTrackHeight
        radius: height / 2
        color: Theme.surface

        // The selected band between the two handles.
        Rectangle {
            x: root.ratioOf(root.localLow) * (root.width - Theme.sliderHandle) + Theme.sliderHandle / 2
            width: (root.ratioOf(root.localHigh) - root.ratioOf(root.localLow)) * (root.width - Theme.sliderHandle)
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            radius: parent.radius
            color: Theme.accent
        }

    }

    Rectangle {
        id: lowHandle

        width: Theme.sliderHandle
        height: Theme.sliderHandle
        radius: width / 2
        color: Theme.text
        border.color: root.activeFocus && root.focusHandle === 0 ? Theme.borderFocus : Theme.surfaceStrong
        border.width: Theme.borderWidth
        anchors.verticalCenter: parent.verticalCenter
        x: root.ratioOf(root.localLow) * (root.width - width)
    }

    Rectangle {
        id: highHandle

        width: Theme.sliderHandle
        height: Theme.sliderHandle
        radius: width / 2
        color: Theme.text
        border.color: root.activeFocus && root.focusHandle === 1 ? Theme.borderFocus : Theme.surfaceStrong
        border.width: Theme.borderWidth
        anchors.verticalCenter: parent.verticalCenter
        x: root.ratioOf(root.localHigh) * (root.width - width)
    }

    MouseArea {
        anchors.fill: parent
        enabled: !root.disabled
        onPressed: function(mouse) {
            root.forceActiveFocus();
            // Overlapping handles: leave the pick to the first drag direction
            // (see `dragging`); otherwise grab the nearest handle.
            if (root.localLow === root.localHigh) {
                root.dragging = -2;
                return ;
            }
            const v = root.valueAt(mouse.x);
            const dLow = Math.abs(v - root.localLow);
            const dHigh = Math.abs(v - root.localHigh);
            root.dragging = dLow < dHigh ? 0 : 1;
            // The keyboard steps the handle the mouse last worked.
            root.focusHandle = root.dragging;
            root.dragTo(mouse.x);
        }
        onPositionChanged: function(mouse) {
            if (pressed)
                root.dragTo(mouse.x);

        }
        onReleased: root.dragging = -1
        onCanceled: root.dragging = -1
    }

}

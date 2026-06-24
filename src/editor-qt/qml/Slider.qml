// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A horizontal value slider (#457), the Qt port of the editor's ui/Slider, built
// from plain QtQuick. `value` in [from, to] snapped to `step`; dragging (or
// clicking) the groove emits `moved(value)`. Controlled: the parent owns the
// value and re-feeds it, so the appearance round-trip stays the single source.
// One component so every slider matches. Keyboard-operable (Tab focus,
// arrows/Home/End step like a native range input) and
// exposed over AT-SPI as a slider.
Item {
    id: root

    property real from: 0
    property real to: 1
    property real step: 0.05
    property real value: 0
    signal moved(real value)

    activeFocusOnTab: true
    Accessible.role: Accessible.Slider
    Accessible.onIncreaseAction: root.stepBy(1)
    Accessible.onDecreaseAction: root.stepBy(-1)

    // One keyboard/AT-SPI step: the same snapped emit path as a drag, so the
    // dedupe and the controlled round-trip behave identically.
    function stepBy(direction) {
        const v = Math.max(root.from, Math.min(root.to, root.localValue + direction * root.step));
        root.localValue = v;
        if (v !== root.lastEmitted) {
            root.lastEmitted = v;
            root.moved(v);
        }
    }

    Keys.onPressed: function(event) {
        if (event.key === Qt.Key_Left || event.key === Qt.Key_Down)
            root.stepBy(-1);
        else if (event.key === Qt.Key_Right || event.key === Qt.Key_Up)
            root.stepBy(1);
        else if (event.key === Qt.Key_Home)
            root.stepBy((root.from - root.localValue) / root.step);
        else if (event.key === Qt.Key_End)
            root.stepBy((root.to - root.localValue) / root.step);
        else
            return ;

        event.accepted = true;
    }

    // The handle always tracks a LOCAL value, not `value`: `value` is fed back
    // asynchronously (the appearance round-trips through the core), so reading it
    // would make the handle lag a round-trip behind the cursor and snap back for a
    // frame on release. `localValue` is set live while dragging and re-synced to
    // `value` when idle (onValueChanged), so an external change or a core clamp
    // still lands, without the lag.
    property bool dragging: false
    property real localValue: value

    implicitHeight: Theme.controlHeight
    implicitWidth: Theme.panelRightWidth / 2

    readonly property real ratio: (to > from) ? Math.max(0, Math.min(1, (localValue - from) / (to - from))) : 0

    // Dedupe against the last value we emitted, not `value` (which lags), so a
    // drag doesn't re-emit the same step many times (a flood of identical
    // writes). Re-baselined whenever `value` changes; the local value tracks it
    // while idle.
    property real lastEmitted: NaN
    onValueChanged: {
        root.lastEmitted = root.value;
        if (!root.dragging)
            root.localValue = root.value;
    }

    // Map a pointer x (over the whole control) to a stepped value and emit it.
    function moveTo(px) {
        const usable = root.width - handle.width;
        const t = usable > 0 ? Math.max(0, Math.min(1, (px - handle.width / 2) / usable)) : 0;
        let v = root.from + Math.round((t * (root.to - root.from)) / root.step) * root.step;
        v = Math.max(root.from, Math.min(root.to, v));
        root.localValue = v;
        if (v !== root.lastEmitted) {
            root.lastEmitted = v;
            root.moved(v);
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

        Rectangle {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            width: parent.width * root.ratio
            radius: parent.radius
            color: Theme.accent
        }
    }

    Rectangle {
        id: handle
        width: Theme.sliderHandle
        height: Theme.sliderHandle
        radius: width / 2
        color: Theme.text
        border.color: root.activeFocus ? Theme.borderFocus : Theme.surfaceStrong
        border.width: Theme.borderWidth
        anchors.verticalCenter: parent.verticalCenter
        x: root.ratio * (root.width - width)
    }

    MouseArea {
        anchors.fill: parent
        onPressed: function (mouse) {
            root.forceActiveFocus();
            root.dragging = true;
            root.moveTo(mouse.x);
        }
        onPositionChanged: function (mouse) {
            if (pressed)
                root.moveTo(mouse.x);
        }
        onReleased: root.dragging = false
        onCanceled: root.dragging = false
    }
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A labelled appearance slider with a percent readout (#457): the row used for
// every pie value (size / opacity / label / icon / ring / center). `range` is
// the core's { min, max, step }; dragging emits `moved(value)`. One component so
// the six rows are identical.
Column {
    id: root

    property string label: ""
    property var range: null
    property real value: 0
    // decimals >= 0 switches the read-out from the appearance percent to a
    // fixed formatted value ("1.0x", "300 ms"): value.toFixed(decimals) +
    // suffix, rendered from the slider's LIVE local value so it tracks a drag
    // without waiting for the fed-back model, in a fixed-width column so a
    // digit-count change can't resize the slider mid-drag.
    property int decimals: -1
    property string suffix: ""
    signal moved(real value)

    // Optional visibility eye in the caption row (#518): shown when `showEye`,
    // reflects `eyeHidden`, emits `eyeToggled`. It sits beside the label, not the
    // slider, so the slider width stays constant.
    property bool showEye: false
    property bool eyeHidden: false
    property string eyeTooltip: ""
    signal eyeToggled

    spacing: Theme.spaceXs

    Item {
        width: parent.width
        height: root.showEye ? Theme.controlHeight : caption.implicitHeight

        Text {
            id: caption
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
            text: root.label
        }
        EyeToggle {
            visible: root.showEye
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            hidden: root.eyeHidden
            tooltip: root.eyeTooltip
            onToggled: root.eyeToggled()
        }
    }
    Item {
        width: parent.width
        height: Theme.controlHeight

        Slider {
            id: slider

            anchors.left: parent.left
            anchors.right: valueLabel.left
            anchors.rightMargin: Theme.spaceMd
            anchors.verticalCenter: parent.verticalCenter
            from: root.range ? root.range.min : 0
            to: root.range ? root.range.max : 1
            step: root.range ? root.range.step : 1
            value: root.value
            onMoved: function (v) {
                root.moved(v);
            }
        }
        Text {
            id: valueLabel
            width: root.decimals >= 0 ? Theme.sliderValueWidth : implicitWidth
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            horizontalAlignment: Text.AlignRight
            text: root.decimals >= 0 ? slider.localValue.toFixed(root.decimals) + root.suffix : Math.round(root.value * 100) + "%"
            color: Theme.text
            font.family: root.decimals >= 0 ? Theme.fontMono : Application.font.family
            font.pixelSize: Theme.fontSm
        }
    }
}

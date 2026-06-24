// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// A segmented two-or-more-way switch (#457 C5 part 2), the Qt port of
// ui/SegmentedControl: one pill row of mutually exclusive segments, the active
// one filled. `segments` is [{ label, active, tooltip }]; clicking emits
// `selected(index)`. One component so every mode switch matches.
// Keyboard-operable (Tab focus, arrows cycle the active segment) and exposed
// over AT-SPI as a named group of selectable segments.
Rectangle {
    id: root

    property var segments: []
    signal selected(int index)

    implicitWidth: row.implicitWidth + 2 * Theme.borderWidth
    implicitHeight: Theme.controlHeight
    radius: Theme.radius
    color: Theme.base
    border.color: root.activeFocus ? Theme.borderFocus : Theme.surface
    border.width: Theme.borderWidth
    activeFocusOnTab: true
    Accessible.role: Accessible.Grouping
    Accessible.name: {
        for (let i = 0; i < root.segments.length; ++i) {
            if (root.segments[i].active)
                return root.segments[i].label;

        }
        return "";
    }

    // Arrows move the active segment: one stop + arrows is the native
    // radiogroup model (a deliberate upgrade over per-segment tab stops).
    Keys.onPressed: function(event) {
        let active = 0;
        for (let i = 0; i < root.segments.length; ++i) {
            if (root.segments[i].active)
                active = i;

        }
        if (event.key === Qt.Key_Left || event.key === Qt.Key_Up) {
            if (active > 0)
                root.selected(active - 1);

            event.accepted = true;
        } else if (event.key === Qt.Key_Right || event.key === Qt.Key_Down) {
            if (active < root.segments.length - 1)
                root.selected(active + 1);

            event.accepted = true;
        }
    }

    Row {
        id: row

        anchors.centerIn: parent
        spacing: 0

        Repeater {
            model: root.segments

            delegate: Rectangle {
                id: segment

                required property var modelData
                required property int index

                width: segLabel.implicitWidth + 2 * Theme.spaceLg
                height: Theme.controlHeight - 2 * Theme.borderWidth
                radius: Theme.radiusSm
                color: segment.modelData.active ? Theme.surfaceStrong : (segMouse.containsMouse ? Theme.buttonHover : "transparent")
                Accessible.role: Accessible.RadioButton
                Accessible.name: segment.modelData.label
                Accessible.checkable: true
                Accessible.checked: segment.modelData.active === true
                Accessible.onPressAction: root.selected(segment.index)

                Text {
                    id: segLabel

                    anchors.centerIn: parent
                    text: segment.modelData.label
                    color: segment.modelData.active ? Theme.text : Theme.textMuted
                    font.pixelSize: Theme.fontSm
                }

                MouseArea {
                    id: segMouse

                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        root.forceActiveFocus();
                        root.selected(segment.index);
                    }
                }

                HoverHint {
                    text: segment.modelData.tooltip || ""
                }

            }

        }

    }

}

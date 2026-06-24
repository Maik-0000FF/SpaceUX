// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The device status at the right end of the tab bar (#113, #457 D1): the
// status dot (green = device connected, amber = daemon up but no device,
// red = daemon unreachable) + the device name;
// vid:pid and the active profile live in the hover. Purely read-only — the
// profile controls (override, save, delete) sit in the Properties column.
Row {
    id: root

    // DeviceBarModel from the core (null hides the strip).
    property var model: null

    spacing: Theme.spaceSm
    visible: model !== null
    // The status-role automation surface, named by the device label.
    Accessible.role: Accessible.StaticText
    Accessible.name: root.model ? root.model.deviceLabel : ""

    Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: Theme.statusDotSize
        height: Theme.statusDotSize
        radius: Theme.statusDotSize / 2
        color: !root.model ? Theme.textFaint : root.model.status === "ok" ? Theme.success : root.model.status === "no-device" ? Theme.warn : Theme.danger
    }

    Item {
        anchors.verticalCenter: parent.verticalCenter
        width: deviceText.implicitWidth
        height: Theme.controlHeight

        Text {
            id: deviceText

            anchors.verticalCenter: parent.verticalCenter
            text: root.model ? root.model.deviceLabel : ""
            color: (root.model && root.model.connected) ? Theme.textMuted : Theme.textFaint
            font.pixelSize: Theme.fontSm
        }

        HoverHint {
            text: root.model ? root.model.deviceTooltip : ""
        }

    }

}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The app-wide toast host (#457 C5), the Qt port of ToastStack: transient
// success / error / info messages any flow raises via `notify(kind, text)`,
// stacked bottom-right, each dismissible and auto-clearing (errors linger
// longer; see the Theme toast tokens). Mounted once over everything in Main.
Item {
    id: root

    anchors.fill: parent
    z: Theme.zPopup + 5

    function notify(kind, text) {
        toasts.append({
            "kind": kind,
            "text": text
        });
    }

    ListModel {
        id: toasts
    }

    Column {
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.margins: Theme.spaceXl
        spacing: Theme.spaceSm

        Repeater {
            model: toasts

            delegate: Rectangle {
                id: toast

                required property var model
                required property int index
                readonly property color tint: toast.model.kind === "success" ? Theme.success : toast.model.kind === "error" ? Theme.danger : Theme.accent

                width: Theme.toastWidth
                height: toastText.contentHeight + 2 * Theme.spaceMd
                radius: Theme.radius
                color: Theme.panel
                border.color: toast.tint
                border.width: Theme.borderWidth
                // The alert/status automation surface: an error toast
                // announces as an alert, the rest read as text.
                Accessible.role: toast.model.kind === "error" ? Accessible.AlertMessage : Accessible.StaticText
                Accessible.name: toast.model.text

                Text {
                    id: toastText

                    anchors.left: parent.left
                    anchors.right: closeBtn.left
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Theme.spaceMd
                    anchors.rightMargin: Theme.spaceSm
                    text: toast.model.text
                    color: Theme.text
                    font.pixelSize: Theme.fontSm
                    wrapMode: Text.Wrap
                }

                RowButton {
                    id: closeBtn

                    glyph: "✕"
                    accessibleName: qsTr("Dismiss notification")
                    anchors.right: parent.right
                    anchors.rightMargin: Theme.spaceXs
                    anchors.verticalCenter: parent.verticalCenter
                    onClicked: toasts.remove(toast.index)
                }

                Timer {
                    interval: toast.model.kind === "error" ? Theme.toastErrorTtlMs : Theme.toastTtlMs
                    running: true
                    onTriggered: toasts.remove(toast.index)
                }

            }

        }

    }

}

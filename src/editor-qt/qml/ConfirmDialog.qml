// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A modal confirm dialog (#457), the Qt port of ConfirmDialog: a dimmed backdrop
// over the whole window plus a centred box with a title, message and Cancel /
// Confirm. Open it via `ask(title, message, confirmLabel, callback)`; Confirm
// runs the stored callback. Used for the destructive tree delete (a submenu with
// children). The host fills it over everything.
Item {
    id: root

    property bool open: false
    property string title: ""
    property string message: ""
    property string confirmLabel: qsTr("Confirm")
    // Destructive confirms (delete / remove / impersonator install) tint the
    // confirm button via the shared Button variant.
    property bool destructive: false
    // Rich consent content (C5, the plugin-import dialog): an optional trust
    // badge, an optional warning line, and permission chips, all worded by the
    // core model. Cleared by plain ask().
    property var badge: null
    property string warn: ""
    property string permissionsLabel: ""
    property var permissions: []
    property var onConfirm: null
    // Optional: runs when the dialog is dismissed without confirming (the
    // uninstall flow proceeds to the uninstall whether or not the optional
    // cleanup hook was accepted).
    property var onCancel: null

    anchors.fill: parent
    visible: open
    z: Theme.zPopup + 10
    focus: open
    onOpenChanged: if (open)
        root.forceActiveFocus()
    Keys.onEscapePressed: root.close()
    // Enter confirms only non-destructive dialogs: an accidental Enter must
    // not trigger a delete / remove / discard-edits confirm.
    Keys.onReturnPressed: if (!root.destructive)
        root.confirmAndClose()
    Keys.onEnterPressed: if (!root.destructive)
        root.confirmAndClose()

    function ask(t, m, cl, cb, cancelCb) {
        root.onCancel = cancelCb || null;
        root.badge = null;
        root.warn = "";
        root.permissionsLabel = "";
        root.permissions = [];
        root.destructive = false;
        root.title = t;
        root.message = m;
        root.confirmLabel = cl;
        root.onConfirm = cb;
        root.open = true;
    }
    // Open from a core-built dialog model ({ title, message, confirmLabel,
    // destructive, badge?, warn?, permissionsLabel?, permissions? }).
    function askModel(model, cb, cancelCb) {
        root.onCancel = cancelCb || null;
        root.badge = model.badge || null;
        root.warn = model.warn || "";
        root.permissionsLabel = model.permissionsLabel || "";
        root.permissions = model.permissions || [];
        root.destructive = model.destructive === true;
        root.title = model.title;
        root.message = model.message;
        root.confirmLabel = model.confirmLabel;
        root.onConfirm = cb;
        root.open = true;
    }
    function close() {
        const cancelCb = root.onCancel;
        root.open = false;
        root.onConfirm = null;
        root.onCancel = null;
        if (cancelCb)
            cancelCb();

    }
    function confirmAndClose() {
        const cb = root.onConfirm;
        root.onCancel = null;
        root.close();
        if (cb)
            cb();
    }

    // Dimmed backdrop; a click outside the box cancels.
    Rectangle {
        anchors.fill: parent
        color: "#000000"
        opacity: 0.5
        MouseArea {
            anchors.fill: parent
            onClicked: root.close()
        }
    }

    Rectangle {
        anchors.centerIn: parent
        width: Theme.dialogWidth
        height: box.height + 2 * Theme.spaceXl
        radius: Theme.radius
        color: Theme.panel
        border.color: Theme.surfaceStrong
        border.width: Theme.borderWidth
        // The dialog-role automation surface, named by its title.
        Accessible.role: Accessible.Dialog
        Accessible.name: root.title

        // Eat clicks so a click on the box doesn't fall through to the backdrop.
        MouseArea {
            anchors.fill: parent
        }

        Column {
            id: box
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.margins: Theme.spaceXl
            spacing: Theme.spaceLg

            Text {
                width: parent.width
                text: root.title
                color: Theme.text
                font.pixelSize: Theme.fontLg
                font.bold: true
                wrapMode: Text.WordWrap
            }
            PluginBadge {
                visible: root.badge !== null
                label: root.badge ? root.badge.label : ""
                badgeStyle: root.badge ? root.badge.style : "chip"
                tooltip: root.badge ? root.badge.tooltip : ""
            }
            Text {
                visible: root.warn !== ""
                width: parent.width
                text: root.warn
                color: Theme.danger
                font.pixelSize: Theme.fontSm
                wrapMode: Text.WordWrap
            }
            Flow {
                visible: root.permissions.length > 0
                width: parent.width
                spacing: Theme.spaceSm

                Text {
                    text: root.permissionsLabel
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontXs
                }

                Repeater {
                    model: root.permissions

                    delegate: PluginBadge {
                        required property var modelData

                        label: modelData
                    }

                }

            }
            Text {
                width: parent.width
                text: root.message
                color: Theme.textMuted
                font.pixelSize: Theme.fontMd
                wrapMode: Text.WordWrap
            }
            Row {
                anchors.right: parent.right
                spacing: Theme.spaceMd

                Button {
                    text: qsTr("Cancel")
                    onClicked: root.close()
                }
                Button {
                    text: root.confirmLabel
                    destructive: root.destructive
                    onClicked: root.confirmAndClose()
                }
            }
        }
    }
}

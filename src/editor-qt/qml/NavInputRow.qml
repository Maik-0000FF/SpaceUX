// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// One input-binding picker row (#457 C3), the Qt port of the editor's
// NavInputRow: the input dropdown (options come ready-made from the core's
// nav model: none / buttons / split axes / magnitudes, stale values flagged),
// an inline threshold field for the analog kinds, the unified conflict marker,
// and a remove button. Presentation only: the caller owns where the binding
// lives; every change is emitted as a signal the host turns into an
// EditNavInput op.
Item {
    id: root

    // One NavInputRowModel from the core: { value, threshold, options, conflict }.
    property var row: null

    signal picked(string value)
    signal thresholdEdited(real threshold)
    signal removed()

    implicitHeight: Theme.controlHeight
    implicitWidth: parent ? parent.width : Theme.panelRightWidth

    Row {
        anchors.fill: parent
        spacing: Theme.spaceSm

        Select {
            width: root.width - (thresholdBox.visible ? thresholdBox.width + Theme.spaceSm : 0) - Theme.conflictSlot - removeBtn.width - 2 * Theme.spaceSm
            anchors.verticalCenter: parent.verticalCenter
            model: root.row ? root.row.options : []
            value: root.row ? root.row.value : "none"
            onActivated: function(v) {
                root.picked(v);
            }
        }

        // The analog threshold. Commits on Enter / focus-loss; an empty or
        // non-positive entry reverts to the committed value.
        Rectangle {
            id: thresholdBox

            visible: root.row !== null && root.row.threshold !== null
            width: Theme.navThresholdWidth
            height: Theme.controlHeight
            anchors.verticalCenter: parent.verticalCenter
            radius: Theme.radiusSm
            color: Theme.base
            border.color: Theme.surface
            border.width: Theme.borderWidth

            TextInput {
                id: thresholdInput

                anchors.fill: parent
                anchors.margins: Theme.spaceSm
                color: Theme.text
                font.pixelSize: Theme.fontMd
                horizontalAlignment: TextInput.AlignRight
                clip: true
                validator: IntValidator {
                    bottom: 1
                }

                TextContextMenu {
                    id: ctxMenu
                }

                property var trackedRow: root.row
                // The nav model refreshes on every edit (a new row object each
                // time); while the user is typing here, their draft wins over
                // the fed-back value, so only re-sync without focus.
                onTrackedRowChanged: {
                    if (!thresholdInput.activeFocus)
                        text = (root.row && root.row.threshold !== null) ? String(root.row.threshold) : "";

                }
                onEditingFinished: {
                    if (ctxMenu.active)
                        return;
                    const v = Number(text);
                    if (Number.isFinite(v) && v > 0)
                        root.thresholdEdited(v);
                    else
                        text = (root.row && root.row.threshold !== null) ? String(root.row.threshold) : "";
                }
            }

        }

        // The unified conflict marker (a fixed slot, so it never shifts the row).
        ConflictMark {
            anchors.verticalCenter: parent.verticalCenter
            conflict: root.row ? root.row.conflict : null
        }

        RowButton {
            id: removeBtn

            glyph: "✕"
            anchors.verticalCenter: parent.verticalCenter
            onClicked: root.removed()
        }

    }

}

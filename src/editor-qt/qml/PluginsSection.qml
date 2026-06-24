// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The plugin manager (#457 C5), the Qt port of PluginManager: import a
// downloaded plugin folder, list what's installed (kind sections with trust /
// origin badges, feature + permission chips), and remove plugins. Renders the
// core's InspectPluginManager model; the import/remove flows live in Main
// (native folder pick, consent + remove confirms, toasts).
Column {
    id: root

    // The PluginManagerUiModel from the core (or null until the first inspect).
    property var model: null
    // Disables the actions while an import/remove flow runs.
    property bool busy: false

    signal importRequested()
    signal removeRequested(string kind, string id, string name)

    spacing: Theme.spaceMd

    Button {
        text: root.model ? root.model.importLabel : ""
        enabled: !root.busy
        opacity: enabled ? 1 : Theme.disabledOpacity
        onClicked: root.importRequested()
    }

    Text {
        visible: root.model !== null && root.model.sections.length === 0
        text: root.model ? root.model.emptyText : ""
        color: Theme.textFaint
        font.pixelSize: Theme.fontSm
    }

    Repeater {
        model: root.model ? root.model.sections : []

        delegate: Column {
            id: kindSection

            required property var modelData

            width: root.width
            spacing: Theme.spaceSm

            Text {
                text: kindSection.modelData.heading
                color: Theme.text
                font.pixelSize: Theme.fontSm
                font.bold: true
            }

            Repeater {
                model: kindSection.modelData.items

                delegate: Rectangle {
                    id: item

                    required property var modelData

                    width: kindSection.width
                    height: itemBody.implicitHeight + 2 * Theme.spaceMd
                    radius: Theme.radiusSm
                    color: Theme.base
                    border.color: Theme.surface
                    border.width: Theme.borderWidth

                    Column {
                        id: itemBody

                        anchors.left: parent.left
                        anchors.right: removeSlot.left
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceSm
                        spacing: Theme.spaceXs

                        // Name + the badge row (kind, origin, trust).
                        Flow {
                            width: itemBody.width
                            spacing: Theme.spaceSm

                            Text {
                                text: item.modelData.name
                                color: Theme.text
                                font.pixelSize: Theme.fontMd
                                font.bold: true
                            }

                            Repeater {
                                model: item.modelData.badges

                                delegate: PluginBadge {
                                    required property var modelData

                                    label: modelData.label
                                    badgeStyle: modelData.style
                                    tooltip: modelData.tooltip
                                }

                            }

                        }

                        // What the plugin brings, as chips.
                        Flow {
                            visible: item.modelData.features.length > 0
                            width: itemBody.width
                            spacing: Theme.spaceSm

                            Repeater {
                                model: item.modelData.features

                                delegate: PluginBadge {
                                    required property var modelData

                                    label: modelData.label
                                    tooltip: modelData.tooltip
                                }

                            }

                        }

                        // Declared permissions (transparency; not yet enforced).
                        Flow {
                            visible: item.modelData.permissions.length > 0
                            width: itemBody.width
                            spacing: Theme.spaceSm

                            Repeater {
                                model: item.modelData.permissions

                                delegate: PluginBadge {
                                    required property var modelData

                                    label: modelData.label
                                    badgeStyle: "warnChip"
                                    tooltip: modelData.tooltip
                                }

                            }

                        }

                        Text {
                            text: item.modelData.meta
                            color: Theme.textFaint
                            font.pixelSize: Theme.fontXs
                        }

                    }

                    // Remove (disabled with hover help for bundled plugins).
                    Item {
                        id: removeSlot

                        anchors.right: parent.right
                        anchors.rightMargin: Theme.spaceMd
                        anchors.verticalCenter: parent.verticalCenter
                        width: removeBtn.implicitWidth
                        height: removeBtn.implicitHeight

                        Button {
                            id: removeBtn

                            text: qsTr("Remove")
                            enabled: item.modelData.removable && !root.busy
                            opacity: enabled ? 1 : Theme.disabledOpacity
                            onClicked: root.removeRequested(item.modelData.kind, item.modelData.id, item.modelData.name)
                        }

                        HoverHint {
                            text: item.modelData.removeTooltip || ""
                        }

                    }

                }

            }

        }

    }

    // Plugins that failed to load (bad manifest, unreadable dir).
    Column {
        visible: root.model !== null && root.model.errors.length > 0
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: root.model ? root.model.errorsHeading : ""
            color: Theme.text
            font.pixelSize: Theme.fontSm
            font.bold: true
        }

        Repeater {
            model: root.model ? root.model.errors : []

            delegate: Column {
                id: errorRow

                required property var modelData

                width: parent.width
                spacing: 0

                Text {
                    width: parent.width
                    text: errorRow.modelData.dir
                    color: Theme.textFaint
                    font.pixelSize: Theme.fontXs
                    elide: Text.ElideMiddle
                }

                Text {
                    width: parent.width
                    text: errorRow.modelData.reason
                    color: Theme.danger
                    font.pixelSize: Theme.fontXs
                    wrapMode: Text.Wrap
                }

            }

        }

    }

}

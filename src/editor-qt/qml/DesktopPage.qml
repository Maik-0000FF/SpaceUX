// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The Desktop tab (#199 / #457 C4), the Qt port of the editor's
// DesktopSettings page: the global desktop-mode config, axis-centric. Every
// section renders off the core's InspectDesktopSettings model (axis cards
// carry only the chosen function's fields; button rows carry the unified
// conflict markers); every change goes out as one EditDesktopSettings op via
// `editDesktop`. While desktop mode is off, everything but the Activation
// control dims and disables.
Rectangle {
    id: root

    // The DesktopUiModel from the core (or null until the first inspect).
    property var model: null
    // The available actions (EditorAction[]) for a button's action picker.
    property var actions: []
    // editDesktop(op): Main-provided applier running EditDesktopSettings, the
    // optimistic adopt and the debounced persist.
    property var editDesktop: null
    // Button rows render only once the device info resolved, so the fallback
    // count can't flash and collapse to the real one.
    property bool deviceResolved: false

    color: Theme.base

    function apply(op) {
        if (root.editDesktop)
            root.editDesktop(op);

    }

    PanelFlickable {
        id: scroll

        anchors.fill: parent
        anchors.margins: Theme.spaceXl
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: content

            width: Math.min(parent.width, Theme.settingsMaxWidth)
            spacing: Theme.spaceLg

            Text {
                text: qsTr("Desktop mode")
                color: Theme.text
                font.pixelSize: Theme.fontLg
                font.bold: true
            }

            Text {
                width: parent.width
                text: root.model ? root.model.description : ""
                color: Theme.textMuted
                font.pixelSize: Theme.fontSm
                wrapMode: Text.Wrap
            }

            // Activation: Off / Always on / Toggle with a button.
            Column {
                width: parent.width
                spacing: Theme.spaceXs

                Text {
                    text: qsTr("Activation")
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontXs
                }

                Select {
                    width: parent.width
                    model: root.model ? root.model.activation.options : []
                    value: root.model ? root.model.activation.value : "off"
                    onActivated: function(v) {
                        root.apply({
                            "kind": "setActivation",
                            "value": v
                        });
                    }
                }

            }

            // The toggle-button picker (enabled toggle mode only), with the
            // unified conflict marker beside it.
            Column {
                visible: root.model !== null && root.model.toggle !== null
                width: parent.width
                spacing: Theme.spaceXs

                Text {
                    text: qsTr("Toggle button")
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontXs
                }

                Row {
                    width: parent.width
                    spacing: Theme.spaceSm

                    Select {
                        width: parent.width - Theme.conflictSlot - Theme.spaceSm
                        anchors.verticalCenter: parent.verticalCenter
                        model: (root.model && root.model.toggle) ? root.model.toggle.options : []
                        value: (root.model && root.model.toggle) ? root.model.toggle.value : "0"
                        onActivated: function(v) {
                            root.apply({
                                "kind": "setToggleButton",
                                "button": parseInt(v)
                            });
                        }
                    }

                    ConflictMark {
                        anchors.verticalCenter: parent.verticalCenter
                        conflict: (root.model && root.model.toggle) ? root.model.toggle.conflict : null
                    }

                }

            }

            // Suspend-while-pie-open, dimmed with the body while disabled.
            Column {
                width: parent.width
                spacing: Theme.spaceXs
                enabled: root.model !== null && root.model.controlsEnabled
                opacity: enabled ? 1 : Theme.disabledOpacity

                Toggle {
                    checked: root.model ? root.model.suspend.value : true
                    label: root.model ? root.model.suspend.label : ""
                    onToggled: function(c) {
                        root.apply({
                            "kind": "setSuspend",
                            "value": c
                        });
                    }
                }

                Text {
                    width: parent.width
                    text: root.model ? root.model.suspend.note : ""
                    color: Theme.textFaint
                    font.pixelSize: Theme.fontXs
                    wrapMode: Text.Wrap
                }

            }

            // Axes + Buttons + Reset: the whole body dims and disables while
            // desktop mode is off (only Activation stays live to re-enable).
            Column {
                width: parent.width
                spacing: Theme.spaceLg
                enabled: root.model !== null && root.model.controlsEnabled
                opacity: enabled ? 1 : Theme.disabledOpacity

                Text {
                    text: root.model ? root.model.axes.heading : ""
                    color: Theme.text
                    font.pixelSize: Theme.fontLg
                    font.bold: true
                }

                Text {
                    width: parent.width
                    text: root.model ? root.model.axes.description : ""
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontSm
                    wrapMode: Text.Wrap
                }

                Repeater {
                    model: root.model ? root.model.axes.cards : []

                    // Each axis renders as a CARD (frame + padding) and the
                    // hovered card highlights, so what belongs to which axis
                    // reads at a glance.
                    delegate: Rectangle {
                        id: axisCard

                        required property var modelData

                        width: content.width
                        height: axisCardBody.implicitHeight + 2 * Theme.spaceMd
                        radius: Theme.radiusSm
                        // The hover fill is its own palette tint (cardHover),
                        // deliberately distinct from `surface` so the slider
                        // tracks inside keep their contrast on a hovered card.
                        color: axisCardHover.hovered ? Theme.cardHover : "transparent"
                        border.color: axisCardHover.hovered ? Theme.borderFocus : Theme.surface
                        border.width: Theme.borderWidth

                        HoverHandler {
                            id: axisCardHover
                        }

                        Column {
                            id: axisCardBody

                            anchors.top: parent.top
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.margins: Theme.spaceMd
                            spacing: Theme.spaceSm

                            // Card head: the plain-language axis name + dimmed code,
                            // with the function dropdown beside it.
                            Row {
                                width: axisCardBody.width
                                spacing: Theme.spaceSm

                                Text {
                                    id: axisName

                                    anchors.verticalCenter: parent.verticalCenter
                                    text: axisCard.modelData.name
                                    color: Theme.text
                                    font.pixelSize: Theme.fontMd
                                }

                                Text {
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "(" + axisCard.modelData.code + ")"
                                    color: Theme.textFaint
                                    font.pixelSize: Theme.fontSm
                                }

                            }

                            Select {
                                width: axisCardBody.width
                                model: axisCard.modelData.kindOptions
                                value: axisCard.modelData.kind
                                onActivated: function(v) {
                                    root.apply({
                                        "kind": "setAxisKind",
                                        "axis": axisCard.modelData.axis,
                                        "fn": v
                                    });
                                }
                            }

                            // The chosen function's own controls, indented under it.
                            Column {
                                id: axisFieldsColumn

                                width: axisCardBody.width - Theme.spaceXl
                                anchors.right: axisCardBody.right
                                spacing: Theme.spaceSm

                                Repeater {
                                    model: axisCard.modelData.fields

                                    // Sized off the named containers, never `parent`:
                                    // a Repeater rebuild detaches the delegate before
                                    // destroying it, and a parent.width binding then
                                    // dereferences null.
                                    delegate: Column {
                                        id: fieldBlock

                                        required property var modelData

                                        width: axisFieldsColumn.width
                                        spacing: Theme.spaceXs

                                        SliderRow {
                                            visible: fieldBlock.modelData.control === "slider"
                                            width: fieldBlock.width
                                            label: fieldBlock.modelData.label
                                            range: fieldBlock.modelData.control === "slider" ? {
                                                "min": fieldBlock.modelData.min,
                                                "max": fieldBlock.modelData.max,
                                                "step": fieldBlock.modelData.step
                                            } : null
                                            value: fieldBlock.modelData.control === "slider" ? fieldBlock.modelData.value : 0
                                            decimals: fieldBlock.modelData.control === "slider" ? fieldBlock.modelData.decimals : -1
                                            suffix: fieldBlock.modelData.control === "slider" ? fieldBlock.modelData.suffix : ""
                                            onMoved: function(v) {
                                                root.apply({
                                                    "kind": "setAxisField",
                                                    "axis": axisCard.modelData.axis,
                                                    "key": fieldBlock.modelData.key,
                                                    "value": v
                                                });
                                            }
                                        }

                                        Column {
                                            visible: fieldBlock.modelData.control === "select"
                                            width: fieldBlock.width
                                            spacing: Theme.spaceXs

                                            Text {
                                                text: fieldBlock.modelData.label
                                                color: Theme.textMuted
                                                font.pixelSize: Theme.fontXs
                                            }

                                            Select {
                                                width: fieldBlock.width
                                                model: fieldBlock.modelData.control === "select" ? fieldBlock.modelData.options : []
                                                value: fieldBlock.modelData.control === "select" ? fieldBlock.modelData.value : ""
                                                onActivated: function(v) {
                                                    root.apply({
                                                        "kind": "setAxisField",
                                                        "axis": axisCard.modelData.axis,
                                                        "key": fieldBlock.modelData.key,
                                                        "value": v
                                                    });
                                                }
                                            }

                                        }

                                        Toggle {
                                            visible: fieldBlock.modelData.control === "toggle"
                                            checked: fieldBlock.modelData.control === "toggle" ? fieldBlock.modelData.value : false
                                            label: fieldBlock.modelData.label
                                            onToggled: function(c) {
                                                root.apply({
                                                    "kind": "setAxisField",
                                                    "axis": axisCard.modelData.axis,
                                                    "key": fieldBlock.modelData.key,
                                                    "value": c
                                                });
                                            }
                                        }

                                    }

                                }

                            }

                        }

                    }

                }

                Text {
                    visible: root.deviceResolved
                    topPadding: Theme.spaceMd
                    text: root.model ? root.model.buttons.heading : ""
                    color: Theme.text
                    font.pixelSize: Theme.fontLg
                    font.bold: true
                }

                Text {
                    visible: root.deviceResolved
                    width: parent.width
                    text: root.model ? root.model.buttons.description : ""
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontSm
                    wrapMode: Text.Wrap
                }

                Repeater {
                    model: (root.model && root.deviceResolved) ? root.model.buttons.rows : []

                    delegate: Column {
                        id: buttonRow

                        required property var modelData

                        width: content.width
                        spacing: Theme.spaceSm

                        Column {
                            id: buttonRowInner

                            width: buttonRow.width
                            spacing: Theme.spaceXs

                            Text {
                                text: buttonRow.modelData.label
                                color: Theme.textMuted
                                font.pixelSize: Theme.fontXs
                            }

                            Row {
                                id: buttonPickerRow

                                width: buttonRowInner.width
                                spacing: Theme.spaceSm

                                Select {
                                    width: buttonPickerRow.width - Theme.conflictSlot - Theme.spaceSm
                                    anchors.verticalCenter: parent.verticalCenter
                                    model: buttonRow.modelData.options
                                    value: buttonRow.modelData.choice
                                    onActivated: function(v) {
                                        root.apply({
                                            "kind": "setButtonChoice",
                                            "index": buttonRow.modelData.index,
                                            "choice": v
                                        });
                                    }
                                }

                                ConflictMark {
                                    anchors.verticalCenter: parent.verticalCenter
                                    conflict: buttonRow.modelData.conflict
                                }

                            }

                            Text {
                                visible: buttonRow.modelData.blockedNote !== null
                                width: buttonRowInner.width
                                text: buttonRow.modelData.blockedNote || ""
                                color: Theme.textFaint
                                font.pixelSize: Theme.fontXs
                                wrapMode: Text.Wrap
                            }

                        }

                        // The action picker + config that unfold under a row set
                        // to "Action", indented so the expansion reads as
                        // belonging to the row above it.
                        Column {
                            id: buttonActionColumn

                            visible: buttonRow.modelData.choice === "action"
                            width: buttonRow.width - Theme.spaceXl
                            anchors.right: buttonRow.right
                            spacing: Theme.spaceSm

                            ActionField {
                                width: buttonActionColumn.width
                                action: buttonRow.modelData.action
                                actions: root.actions
                                onPicked: function(id) {
                                    root.apply({
                                        "kind": "setButtonActionId",
                                        "index": buttonRow.modelData.index,
                                        "id": id
                                    });
                                }
                                onCustomChanged: function(text) {
                                    root.apply({
                                        "kind": "setButtonActionId",
                                        "index": buttonRow.modelData.index,
                                        "id": text
                                    });
                                }
                                // "No action" unbinds the button (back to none).
                                onCleared: root.apply({
                                    "kind": "clearButton",
                                    "index": buttonRow.modelData.index
                                })
                            }

                            ConfigEditor {
                                visible: buttonRow.modelData.action !== null && buttonRow.modelData.action.id !== ""
                                width: buttonActionColumn.width
                                value: buttonRow.modelData.action ? buttonRow.modelData.action.config : undefined
                                resetKey: "desktop-btn-" + buttonRow.modelData.index + "|" + (buttonRow.modelData.action ? buttonRow.modelData.action.id : "")
                                editConfig: function(cfg) {
                                    root.apply({
                                        "kind": "setButtonActionConfig",
                                        "index": buttonRow.modelData.index,
                                        "config": cfg
                                    });
                                }
                            }

                        }

                    }

                }

                Button {
                    text: root.model ? root.model.resetLabel : ""
                    onClicked: root.apply({
                        "kind": "reset"
                    })
                }

            }

        }

    }

    ScrollBar {
        flickable: scroll
        orientation: Qt.Vertical
        anchors.right: parent.right
        anchors.top: scroll.top
        anchors.bottom: scroll.bottom
    }

}

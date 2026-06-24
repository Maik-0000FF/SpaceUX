// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The global navigation editor (#457 C3), the Qt port of the editor's
// NavigationSettings with the style quick-pick on top: the navigation style
// (#160, one-shot apply -> Custom), the aim source + its two-threshold
// deadzone, then the ring gestures (open submenu / activate / go back / step)
// each with its input list, warnings and (for the step) the twist priority.
// Everything renders off the core's nav model; edits go out as EditNavInput
// ops via `editNav`.
Column {
    id: root

    // The whole NavUiModel from the core (or null until the first inspect).
    property var model: null
    // editNav(op): Main-provided applier running EditNavInput + the write-back.
    property var editNav: null
    // Sticky-custom (Main.styleCustomized): while set, the style shows the
    // core-built Custom entry even if the bindings happen to match a preset,
    // so a slider drag passing through preset values can't flap the display.
    property bool styleCustomized: false
    readonly property bool showCustom: styleCustomized && model !== null && model.style.value !== "custom"

    spacing: Theme.spaceMd

    function apply(op) {
        if (root.editNav)
            root.editNav(op);

    }

    // Navigation style quick-pick, on top: picking one applies the whole
    // coherent gesture bundle; refining any field below flips it to Custom.
    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: qsTr("Navigation style")
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }

        Select {
            width: parent.width
            model: root.model ? (root.showCustom ? [root.model.style.customOption].concat(root.model.style.options) : root.model.style.options) : []
            value: root.showCustom ? "custom" : (root.model ? root.model.style.value : "custom")
            onActivated: function(v) {
                root.apply({
                    "kind": "applyPreset",
                    "presetId": v
                });
            }
        }

        Text {
            width: parent.width
            text: root.showCustom ? root.model.style.customOption.description : (root.model ? root.model.style.description : "")
            color: Theme.textFaint
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: qsTr("Aim with")
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }

        Select {
            width: parent.width
            model: root.model ? root.model.aim.options : []
            value: root.model ? root.model.aim.value : "both"
            onActivated: function(v) {
                root.apply({
                    "kind": "setAim",
                    "aim": v
                });
            }
        }

    }

    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            text: qsTr("Aim deadzone")
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }

        Row {
            width: parent.width
            spacing: Theme.spaceSm

            DualRange {
                id: deadzoneRange

                width: parent.width - deadzoneValue.width - Theme.spaceSm
                anchors.verticalCenter: parent.verticalCenter
                from: root.model ? root.model.deadzone.min : 0
                to: root.model ? root.model.deadzone.max : 100
                step: root.model ? root.model.deadzone.step : 5
                low: root.model ? root.model.deadzone.hover : 0
                high: root.model ? root.model.deadzone.open : 0
                disabled: root.model !== null && root.model.deadzone.disabled
                onMoved: function(lo, hi) {
                    root.apply({
                        "kind": "setDeadzone",
                        "hover": lo,
                        "open": hi
                    });
                }
            }

            // Fixed-width monospace read-out: a
            // value dropping a digit must not resize the slider mid-drag,
            // which would shift the handles under the cursor.
            Text {
                id: deadzoneValue

                width: Theme.sliderValueWidth
                anchors.verticalCenter: parent.verticalCenter
                horizontalAlignment: Text.AlignRight
                text: root.model ? (root.model.deadzone.hover + " - " + root.model.deadzone.open) : ""
                color: Theme.textMuted
                font.family: Theme.fontMono
                font.pixelSize: Theme.fontXs
            }

        }

        Text {
            visible: root.model !== null && root.model.deadzone.note !== null
            width: parent.width
            text: root.model && root.model.deadzone.note ? root.model.deadzone.note : ""
            color: Theme.textFaint
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

        Text {
            visible: root.model !== null && root.model.twistWarning !== null
            width: parent.width
            text: root.model && root.model.twistWarning ? ("⚠ " + root.model.twistWarning) : ""
            color: Theme.warn
            font.pixelSize: Theme.fontXs
            wrapMode: Text.Wrap
        }

    }

    // The ring gestures, each a sub-heading + its input list (+ the cycle
    // priority dropdown).
    Repeater {
        model: root.model ? root.model.gestures : []

        delegate: Column {
            id: gestureBlock

            required property var modelData

            width: root.width
            spacing: Theme.spaceSm

            Text {
                topPadding: Theme.spaceSm
                text: gestureBlock.modelData.label
                color: Theme.text
                font.pixelSize: Theme.fontSm
                font.bold: true
            }

            Text {
                visible: gestureBlock.modelData.note !== null
                width: parent.width
                text: gestureBlock.modelData.note || ""
                color: Theme.textFaint
                font.pixelSize: Theme.fontXs
                wrapMode: Text.Wrap
            }

            GestureInputList {
                width: parent.width
                model: gestureBlock.modelData.list
                onSetInput: function(index, value) {
                    root.apply({
                        "kind": "setInput",
                        "target": {
                            "scope": "nav",
                            "gesture": gestureBlock.modelData.key
                        },
                        "index": index,
                        "value": value
                    });
                }
                onSetThreshold: function(index, threshold) {
                    root.apply({
                        "kind": "setThreshold",
                        "target": {
                            "scope": "nav",
                            "gesture": gestureBlock.modelData.key
                        },
                        "index": index,
                        "threshold": threshold
                    });
                }
                onRemoveInput: function(index) {
                    root.apply({
                        "kind": "removeInput",
                        "target": {
                            "scope": "nav",
                            "gesture": gestureBlock.modelData.key
                        },
                        "index": index
                    });
                }
                onAddInput: root.apply({
                    "kind": "addInput",
                    "target": {
                        "scope": "nav",
                        "gesture": gestureBlock.modelData.key
                    }
                })
            }

            Column {
                visible: gestureBlock.modelData.priority !== null
                width: parent.width
                spacing: Theme.spaceXs

                Text {
                    text: qsTr("When also aiming")
                    color: Theme.textMuted
                    font.pixelSize: Theme.fontXs
                }

                Select {
                    width: parent.width
                    model: gestureBlock.modelData.priority ? gestureBlock.modelData.priority.options : []
                    value: gestureBlock.modelData.priority ? gestureBlock.modelData.priority.value : ""
                    onActivated: function(v) {
                        root.apply({
                            "kind": "setCyclePriority",
                            "priority": v
                        });
                    }
                }

            }

        }

    }

}

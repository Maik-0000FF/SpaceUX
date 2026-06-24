// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// Font preset picker (#237 PR2) for the appearance font settings: the pie
// label font (Bundled / System / Custom) and the editor monospace font
// (Default / Custom; the default IS the system monospace, so no separate
// System preset). The stored value is a plain family string: '' = the first
// preset, the system stack = System, anything else = Custom.
// `onChange(next)` persists it (via SetPieAppearance fontUi). `value` is fed back
// asynchronously, so an explicit choice is guarded against our own round-trip,
// so picking Custom sticks even when the text is
// empty or equals a preset stack. `commit(next)` persists the picked family.
Column {
    id: root

    property string label: ""
    property string bundledLabel: ""
    property string systemStack: ""
    property string value: ""
    property var commit: null
    // The '' preset's display label and whether a separate System preset
    // exists (the label font has one; the mono font's default is the system
    // monospace already).
    property string firstPresetLabel: qsTr("Bundled (%1)").arg(root.bundledLabel)
    property bool offerSystem: true

    property string mode: "bundled"
    property string customText: ""
    // The value we last emitted, to tell our own round-trip apart from an
    // external change (e.g. a profile switch) which must re-derive the mode.
    property string lastEmitted: ""
    property bool hasEmitted: false

    spacing: Theme.spaceXs

    function presetOf(v, sys) {
        if (v === "")
            return "bundled";
        if (v === sys)
            return "system";
        return "custom";
    }
    // Re-derive the mode from the persisted value, unless it's our own emit
    // echoing back (then the chosen mode must stand).
    function syncMode() {
        if (root.hasEmitted && root.value === root.lastEmitted)
            return;
        root.mode = root.presetOf(root.value, root.systemStack);
        root.customText = root.mode === "custom" ? root.value : "";
    }
    function emitValue(next) {
        root.lastEmitted = next;
        root.hasEmitted = true;
        if (root.commit)
            root.commit(next);
    }
    function selectPreset(p) {
        root.mode = p;
        if (p === "bundled")
            root.emitValue("");
        else if (p === "system")
            root.emitValue(root.systemStack);
        else
            root.emitValue(root.customText);
    }

    onValueChanged: root.syncMode()
    onSystemStackChanged: root.syncMode()
    Component.onCompleted: root.syncMode()

    Text {
        color: Theme.textMuted
        font.pixelSize: Theme.fontXs
        text: root.label
    }
    Select {
        width: parent.width
        model: {
            const opts = [{ "value": "bundled", "label": root.firstPresetLabel }];
            if (root.offerSystem)
                opts.push({ "value": "system", "label": qsTr("System default") });
            opts.push({ "value": "custom", "label": qsTr("Custom…") });
            return opts;
        }
        value: root.mode
        onActivated: function (v) {
            root.selectPreset(v);
        }
    }
    Rectangle {
        visible: root.mode === "custom"
        width: parent.width
        height: Theme.controlHeight
        radius: Theme.radiusSm
        color: Theme.base

        TextInput {
            id: customInput
            anchors.fill: parent
            anchors.margins: Theme.spaceSm
            color: Theme.text
            font.pixelSize: Theme.fontMd
            clip: true

            TextContextMenu {
                id: ctxMenu
            }

            // Mirror external changes into the field without fighting typing.
            property string tracked: root.customText
            onTrackedChanged: if (text !== tracked)
                text = tracked
            // Track each keystroke locally, but commit (which round-trips through
            // the core + an atomic write) only on finish, like the Label / Config
            // fields, so typing a family doesn't fire a write per keystroke.
            onTextEdited: root.customText = text
            onEditingFinished: {
                if (ctxMenu.active)
                    return;
                root.emitValue(root.customText);
            }
        }
    }
}

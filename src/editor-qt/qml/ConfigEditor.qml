// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// JSON editor for an action's per-instance config (#457). Deliberately raw
// JSON (the schema-driven form is the separate #419); a
// plain QtQuick TextEdit. Local text so a half-typed (invalid) value stays in the
// field; it commits on focus-loss (a parse to a plain object, or undefined to
// drop the config when cleared), which also avoids a write-back/reset loop. The
// parent bumps `resetKey` on a selection change / external adoption to reload it.
Column {
    id: root

    // The action.config object (or undefined), and editConfig(cfgOrUndefined) the
    // parent supplies to commit. `resetKey` reloads the text when it changes.
    property var value: undefined
    property var editConfig: null
    property var resetKey: null

    property string error: ""
    spacing: Theme.spaceXs

    function format(v) {
        return (v !== undefined && v !== null) ? JSON.stringify(v, null, 2) : "";
    }
    function commit(next) {
        if (next.trim() === "") {
            root.error = "";
            if (root.editConfig)
                root.editConfig(undefined);
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(next);
        } catch (e) {
            root.error = qsTr("invalid JSON");
            return;
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            root.error = qsTr("config must be a JSON object");
            return;
        }
        root.error = "";
        if (root.editConfig)
            root.editConfig(parsed);
    }

    // Reload the field (and clear the error) when the parent bumps resetKey.
    property var trackedKey: root.resetKey
    onTrackedKeyChanged: {
        input.text = root.format(root.value);
        root.error = "";
    }

    Text {
        color: Theme.textMuted
        font.pixelSize: Theme.fontXs
        text: qsTr("Config")
    }
    Rectangle {
        width: parent.width
        height: Math.max(Theme.configMinHeight, input.implicitHeight + Theme.spaceLg)
        radius: Theme.radiusSm
        color: Theme.base

        TextEdit {
            id: input
            anchors.fill: parent
            anchors.margins: Theme.spaceSm
            color: Theme.text
            font.pixelSize: Theme.fontSm
            font.family: Theme.fontMono
            wrapMode: TextEdit.Wrap
            selectByMouse: true
            Component.onCompleted: text = root.format(root.value)
            // Commit on focus-loss (Enter inserts a newline in JSON), not per
            // keystroke, so a half-typed value isn't pushed and there's no loop.
            onActiveFocusChanged: {
                if (ctxMenu.active)
                    return;
                if (!activeFocus)
                    root.commit(text);
            }

            TextContextMenu {
                id: ctxMenu
            }
        }
    }
    Text {
        visible: root.error.length > 0
        width: parent.width
        color: Theme.danger
        font.pixelSize: Theme.fontXs
        wrapMode: Text.Wrap
        text: root.error
    }
}

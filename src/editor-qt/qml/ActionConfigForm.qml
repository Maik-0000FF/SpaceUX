// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// Schema-driven editor for an action's per-instance config (#419): one labelled
// input per field declared in the action's ActionConfigSchema, instead of the
// raw-JSON ConfigEditor. So "Launch program" shows a Command field where you
// type `kitty` and it is stored as { "command": "kitty" } under the hood. The
// parent shows this for any action that declares a schema, and falls back to the
// raw-JSON editor only when an action declares none (the form can't show fields
// it doesn't know).
//
// Fields commit on focus-loss / change (not per keystroke) so the write-back +
// rebuild can't reset a field mid-typing. Each field displays straight from the
// committed config (fieldInitial); each commit rebuilds the config from `value`,
// preserving keys beyond the schema (so a form edit never drops a plugin's extra
// options) and overlaying the schema fields, dropping ones with no meaningful
// value (an empty string, a false boolean), so clearing every field drops the
// config (undefined) like the JSON editor.
Column {
    id: root

    // The action's ActionConfigSchema (Record<key, {kind,label,placeholder,...}>),
    // the current action.config object (or undefined), and editConfig(cfgOrUndefined)
    // the parent supplies to commit. `resetKey` reloads the fields when it changes.
    property var schema: null
    property var value: undefined
    property var editConfig: null
    property var resetKey: null

    spacing: Theme.spaceMd

    function fieldKeys() {
        return root.schema ? Object.keys(root.schema) : [];
    }
    function fieldModel() {
        return root.fieldKeys().map(function (k) {
            return {
                "key": k,
                "field": root.schema[k]
            };
        });
    }

    // A field's initial display value, computed directly from the committed
    // config (else the schema default, else empty). Reading straight from `value`
    // (not a separately-seeded accumulator) means the displayed value never
    // depends on the order a seed step runs relative to the delegates building.
    function fieldInitial(field, key) {
        if (root.value && root.value[key] !== undefined)
            return root.value[key];
        if (field && field.default !== undefined)
            return field.default;
        return (field && field.kind === "boolean") ? false : "";
    }

    // Whether a field's value is worth storing (an empty string / false boolean
    // is the no-op default and is dropped, mirroring the JSON editor's "cleared").
    function meaningful(field, v) {
        if (field.kind === "string" || field.kind === "enum")
            return typeof v === "string" && v.trim() !== "";
        if (field.kind === "integer")
            return typeof v === "number" && isFinite(v);
        if (field.kind === "boolean")
            return v === true;
        return v !== undefined && v !== null && v !== "";
    }

    // Clamp an integer to the field's declared min/max (when given).
    function clampInt(field, n) {
        var v = n;
        if (field.min !== undefined && v < field.min)
            v = field.min;
        if (field.max !== undefined && v > field.max)
            v = field.max;
        return v;
    }

    // Rebuild the whole config from the committed config (the source of truth)
    // overlaid with the just-edited field, then commit it (or undefined when
    // nothing meaningful remains). Basing it on `value` rather than a pre-seeded
    // accumulator means a single edit can never drop another field's stored value
    // through a seeding race.
    function commit(key, val) {
        var base = root.value || {};
        var schema = root.schema || {};
        var out = {};
        // Preserve keys beyond the schema (an action may read extra options the
        // form doesn't show) so a form edit never drops them; then overlay the
        // schema fields, taking the edited one's new value and the rest from base.
        for (var bk in base)
            if (!(bk in schema))
                out[bk] = base[bk];
        var keys = root.fieldKeys();
        for (var i = 0; i < keys.length; ++i) {
            var k = keys[i];
            var v = (k === key) ? val : base[k];
            if (root.meaningful(schema[k], v))
                out[k] = v;
        }
        if (root.editConfig)
            root.editConfig(Object.keys(out).length > 0 ? out : undefined);
    }

    Repeater {
        model: root.fieldModel()

        delegate: Column {
            id: fieldBlock
            required property var modelData
            width: root.width
            spacing: Theme.spaceXs

            readonly property var field: fieldBlock.modelData.field
            readonly property string fieldKey: fieldBlock.modelData.key
            readonly property var current: root.fieldInitial(fieldBlock.field, fieldBlock.fieldKey)

            Text {
                color: Theme.textMuted
                font.pixelSize: Theme.fontXs
                text: fieldBlock.field.label
            }

            // string / integer: a text field that commits on focus-loss.
            Rectangle {
                visible: fieldBlock.field.kind === "string" || fieldBlock.field.kind === "integer"
                width: parent.width
                height: Theme.controlHeight
                radius: Theme.radiusSm
                color: Theme.base

                TextInput {
                    id: textField
                    anchors.fill: parent
                    anchors.margins: Theme.spaceSm
                    color: Theme.text
                    font.pixelSize: Theme.fontMd
                    clip: true
                    verticalAlignment: TextInput.AlignVCenter
                    inputMethodHints: fieldBlock.field.kind === "integer" ? Qt.ImhDigitsOnly : Qt.ImhNone

                    // Follow the committed value whenever not actively editing: a
                    // selection change re-derives `current` from the new node's
                    // config and reloads here, without resetting mid-typing. Keyed
                    // on `current` (not resetKey) so a stale value can't linger
                    // when switching to an item with no/empty config.
                    function reload() {
                        if (!textField.activeFocus)
                            textField.text = fieldBlock.current === undefined ? "" : String(fieldBlock.current);
                    }
                    property var tracked: fieldBlock.current
                    onTrackedChanged: textField.reload()
                    Component.onCompleted: textField.reload()

                    onEditingFinished: {
                        if (ctxMenu.active)
                            return;
                        if (fieldBlock.field.kind === "integer") {
                            var n = parseInt(text, 10);
                            root.commit(fieldBlock.fieldKey, isFinite(n) ? root.clampInt(fieldBlock.field, n) : "");
                        } else {
                            root.commit(fieldBlock.fieldKey, text);
                        }
                    }

                    TextContextMenu {
                        id: ctxMenu
                    }

                    // Placeholder when empty (the schema's example).
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        visible: textField.text.length === 0 && !textField.activeFocus
                        color: Theme.textMuted
                        font.pixelSize: Theme.fontMd
                        text: fieldBlock.field.placeholder || ""
                    }
                }
            }

            // boolean: a toggle.
            Toggle {
                visible: fieldBlock.field.kind === "boolean"
                checked: fieldBlock.current === true
                onToggled: root.commit(fieldBlock.fieldKey, checked)
            }

            // enum: a dropdown of the declared choices.
            Select {
                visible: fieldBlock.field.kind === "enum"
                width: parent.width
                model: (fieldBlock.field.choices || []).map(function (c) {
                    return {
                        "value": c,
                        "label": c
                    };
                })
                value: fieldBlock.current === undefined ? "" : String(fieldBlock.current)
                onActivated: function (v) {
                    root.commit(fieldBlock.fieldKey, v);
                }
            }
        }
    }
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// Right-click → native cut/copy/paste/select-all menu for an editable text
// field. Drop one inside a TextInput/TextEdit with no arguments:
//
//     TextInput { id: foo; ...; TextContextMenu {} }
//
// A right-button-only MouseArea fills the field and CONSUMES the right press,
// so the field keeps its current selection while the menu is shown (a passive
// handler would let the field clear the selection on press, greying out
// Cut/Copy). Left clicks are not accepted and fall through to the field, so
// cursor placement and drag-selection stay untouched; the I-beam cursor is
// kept. The menu itself is the system-native QMenu (NativeTextMenu); the edit
// runs through the field's built-in clipboard methods, which also back the
// Ctrl+C/V/X/A shortcuts.
MouseArea {
    id: root

    // The editable text item this menu acts on: a TextInput or a TextEdit, both
    // of which expose the same selectedText/text/readOnly + cut/copy/paste/
    // selectAll API. `var` (not a concrete type) because those two share no
    // common QML base. Defaults to the item this is declared in.
    property var field: parent

    // True while the native menu is open. The QMenu grabs the keyboard while
    // shown, so the field loses active focus; a field that commits or hides on
    // focus loss (the tree's inline rename) checks this to ignore that, so
    // opening the menu doesn't end the edit.
    property bool active: false

    anchors.fill: parent
    acceptedButtons: Qt.RightButton
    cursorShape: Qt.IBeamCursor
    onClicked: function (mouse) {
        const at = root.field.mapToGlobal(mouse.x, mouse.y);
        root.active = true;
        const action = NativeTextMenu.popup(
            at.x,
            at.y,
            root.field.selectedText.length > 0,
            root.field.readOnly === true,
            root.field.text.length > 0,
            root.field.canUndo === true,
            root.field.canRedo === true,
        );
        root.active = false;
        if (action === "undo")
            root.field.undo();
        else if (action === "redo")
            root.field.redo();
        else if (action === "cut")
            root.field.cut();
        else if (action === "copy")
            root.field.copy();
        else if (action === "paste")
            root.field.paste();
        else if (action === "delete")
            root.field.remove(root.field.selectionStart, root.field.selectionEnd);
        else if (action === "selectAll")
            root.field.selectAll();
    }
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// The command palette (#76 D2b / #457 C5 part 2), the Qt port of
// CommandPalette: the active catalog plugin's commands, grouped by context,
// searchable; clicking one adds it to the current ring as a normal menu item
// carrying the plugin's run-action + baked icon. Renders the core's palette
// model (already expanded + sanitised; scoped to the active curated context);
// the search query filters locally per keystroke.
Column {
    id: root

    // PaletteModel from the core (null hides the palette).
    property var model: null
    property bool enabledOnly: false
    // The command list's height cap; the host's splitter drags it (#457).
    property real listCap: Theme.paletteMaxHeight
    // Null-safe view of model.addDisabled: when the catalog plugin is removed
    // the model nulls while the command delegates are still being torn down,
    // and their bindings must not dereference it.
    readonly property bool addsDisabled: model !== null && model.addDisabled === true
    // Null-safe busy (a catalog pull in flight): Load all + Usable now lock,
    // the list itself stays put (loading feedback is a toast, not a note).
    readonly property bool busy: model !== null && model.busy === true
    // The list's current height, so the host can separate chrome from list
    // when translating a splitter position into a new cap.
    readonly property real listHeightNow: listBox.height

    signal enabledOnlyToggled(bool on)
    signal loadAllRequested()
    signal commandAdded(string command, string label, string icon)

    property string query: ""

    // Local query filter (presentation-level; the heavy expansion/sanitising
    // happened core-side): case-insensitive label match, empty groups drop.
    readonly property var shownGroups: {
        if (!model)
            return [];

        const q = query.trim().toLowerCase();
        if (q === "")
            return model.groups;

        const out = [];
        for (let i = 0; i < model.groups.length; i++) {
            const g = model.groups[i];
            const commands = g.commands.filter(function(c) {
                return c.label.toLowerCase().includes(q);
            });
            if (commands.length > 0)
                out.push({
                "key": g.key,
                "name": g.name,
                "commands": commands
            });

        }
        return out;
    }

    visible: model !== null
    spacing: Theme.spaceSm

    Item {
        width: parent.width
        height: headerControls.implicitHeight

        Text {
            anchors.left: parent.left
            anchors.right: headerControls.left
            anchors.rightMargin: Theme.spaceSm
            anchors.verticalCenter: parent.verticalCenter
            text: root.model ? root.model.title : ""
            color: Theme.text
            font.pixelSize: Theme.fontSm
            font.bold: true
            elide: Text.ElideRight
        }

        // Pinned to the right edge so a narrow column elides the title
        // instead of pushing the controls out over the preview pane.
        Row {
            id: headerControls

            anchors.right: parent.right
            spacing: Theme.spaceSm

            Item {
                anchors.verticalCenter: parent.verticalCenter
                implicitWidth: usableToggle.implicitWidth
                implicitHeight: usableToggle.implicitHeight

                Toggle {
                    id: usableToggle

                    checked: root.enabledOnly
                    label: root.model ? root.model.enabledOnlyLabel : ""
                    enabled: !root.busy
                    opacity: enabled ? 1 : Theme.disabledOpacity
                    onToggled: function(on) {
                        root.enabledOnlyToggled(on);
                    }
                }

                HoverHint {
                    text: root.model ? root.model.enabledOnlyTooltip : ""
                }

            }

            Item {
                anchors.verticalCenter: parent.verticalCenter
                implicitWidth: loadAllBtn.implicitWidth
                implicitHeight: loadAllBtn.implicitHeight

                Button {
                    id: loadAllBtn

                    text: root.model ? root.model.loadAllLabel : ""
                    enabled: !root.busy
                    opacity: enabled ? 1 : Theme.disabledOpacity
                    onClicked: root.loadAllRequested()
                }

                HoverHint {
                    text: root.model ? root.model.loadAllTooltip : ""
                }

            }

        }

    }

    // The search field; filters the local list per keystroke.
    Rectangle {
        width: parent.width
        height: Theme.controlHeight
        radius: Theme.radiusSm
        color: Theme.base
        border.color: Theme.surface
        border.width: Theme.borderWidth

        TextInput {
            anchors.fill: parent
            anchors.margins: Theme.spaceSm
            color: Theme.text
            font.pixelSize: Theme.fontMd
            clip: true
            onTextChanged: root.query = text

            TextContextMenu {}

            Text {
                anchors.fill: parent
                visible: parent.text === ""
                text: root.model ? root.model.searchPlaceholder : ""
                color: Theme.textFaint
                font.pixelSize: Theme.fontMd
            }

        }

    }

    Text {
        visible: root.model !== null && root.model.note !== null
        width: parent.width
        text: root.model && root.model.note ? root.model.note : ""
        color: Theme.textFaint
        font.pixelSize: Theme.fontXs
        wrapMode: Text.Wrap
    }

    // Unfiltered-empty only (catalog loaded, nothing in it): during a search
    // the same note renders INSIDE the held list box instead, so its
    // appearance can't change the palette's outer geometry.
    Text {
        visible: root.model !== null && root.model.note === null && root.shownGroups.length === 0 && root.query.trim() === ""
        text: root.model ? root.model.emptyNote : ""
        color: Theme.textFaint
        font.pixelSize: Theme.fontXs
    }

    // The command list: sized to its content up to the cap, then it scrolls
    // (a silent clip would make
    // commands past the cap reachable only via the search).
    Item {
        id: listBox

        // While a search query is active the box holds the CONTENT height it
        // had unfiltered (frozen via the gated Binding below), so the palette
        // doesn't jump smaller with every keystroke as the filter narrows the
        // list, and it can't collapse at zero hits. Only the content term is
        // frozen; the cap applies live in both modes, so the splitter keeps
        // working mid-search.
        property real heldContentHeight: 0
        readonly property bool searching: root.query.trim() !== ""

        width: parent.width
        height: Math.min(searching ? heldContentHeight : groupsColumn.implicitHeight, root.listCap)
        visible: root.shownGroups.length > 0 || searching

        Binding {
            target: listBox
            property: "heldContentHeight"
            value: groupsColumn.implicitHeight
            when: !listBox.searching
            // Freeze the LAST value when the search begins; the default
            // restore mode would reset it to its initial 0 instead.
            restoreMode: Binding.RestoreNone
        }

        // Zero hits mid-search: the note shows inside the held box.
        Text {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.topMargin: Theme.spaceSm
            visible: listBox.searching && root.shownGroups.length === 0
            text: root.model ? root.model.emptyNote : ""
            color: Theme.textFaint
            font.pixelSize: Theme.fontXs
        }

        PanelFlickable {
            id: listFlick

            anchors.fill: parent
            contentHeight: groupsColumn.implicitHeight
            clip: true

            Column {
                id: groupsColumn

                width: listFlick.width

                Repeater {
                    model: root.shownGroups

                    delegate: Column {
                        id: paletteGroup

                        required property var modelData

                        width: groupsColumn.width
                        spacing: 0

            Text {
                text: paletteGroup.modelData.name
                color: Theme.textMuted
                font.pixelSize: Theme.fontXs
                font.bold: true
                topPadding: Theme.spaceSm
                bottomPadding: Theme.spaceXs
            }

            Repeater {
                model: paletteGroup.modelData.commands

                delegate: Rectangle {
                    id: commandRow

                    required property var modelData

                    width: paletteGroup.width
                    height: Theme.rowHeight
                    radius: Theme.radiusSm
                    color: cmdMouse.containsMouse && !root.addsDisabled ? Theme.surface : "transparent"
                    opacity: root.addsDisabled ? Theme.disabledOpacity : 1
                    // The option-role automation surface of the palette listbox.
                    Accessible.role: Accessible.ListItem
                    Accessible.name: commandRow.modelData.label || ""

                    Image {
                        id: cmdIcon

                        anchors.left: parent.left
                        anchors.leftMargin: Theme.spaceSm
                        anchors.verticalCenter: parent.verticalCenter
                        visible: (commandRow.modelData.icon || "") !== ""
                        source: commandRow.modelData.icon || ""
                        width: Theme.fontLg
                        height: Theme.fontLg
                        sourceSize.width: Theme.fontLg * 2
                        sourceSize.height: Theme.fontLg * 2
                        fillMode: Image.PreserveAspectFit
                    }

                    Text {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.leftMargin: Theme.spaceSm + Theme.fontLg + Theme.spaceSm
                        anchors.rightMargin: Theme.spaceSm
                        anchors.verticalCenter: parent.verticalCenter
                        text: commandRow.modelData.label
                        color: Theme.text
                        font.pixelSize: Theme.fontSm
                        elide: Text.ElideRight
                    }

                    MouseArea {
                        id: cmdMouse

                        anchors.fill: parent
                        hoverEnabled: true
                        enabled: !root.addsDisabled
                        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onClicked: root.commandAdded(commandRow.modelData.command, commandRow.modelData.label, commandRow.modelData.icon || "")
                    }

                    HoverHint {
                        text: root.model ? root.model.addTooltip : ""
                    }

                    }

                }

            }

        }

            }

        }

        ScrollBar {
            flickable: listFlick
            orientation: Qt.Vertical
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
        }

    }

}

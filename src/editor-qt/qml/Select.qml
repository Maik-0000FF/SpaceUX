// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// A dark-themed dropdown (#457), the Qt port of the editor's Select/ThemedSelect,
// built from plain QtQuick (no QtQuick.Controls) to match the editor's other
// custom controls. `model` is [{ value, label }, ...]; the current `value` shows
// closed, and picking an option emits `activated(value)`. The open list + a
// click-away backdrop are parented to the window's content item so the list
// draws OVER all following content (a dropdown can't escape its layout via z
// alone) and a click outside closes it. One component → every dropdown matches.
//
// Optional per-option fields (C3/C5): `group` renders a non-selectable header
// row above each run of grouped options; `disabled` shows the option (a stale
// saved value stays visible as selected) but refuses the pick; `conflict` puts
// the unified conflict marker on the option row (see ConflictMark); `icon`
// renders the option's own icon before the label and `marker` a trailing glyph
// (the context picker's curated ●).
Item {
    id: root

    property var model: []
    property string value: ""
    // Shown (faint) while `value` matches no option, e.g. a picker that has no
    // selection yet (the context picker's "Select a workbench…").
    property string placeholder: ""
    signal activated(string value)

    property bool open: false
    // Keyboard-highlighted option index while open (-1 = none); mouse hover
    // moves it too, so the row highlight is one concept.
    property int activeIndex: -1
    // Pending type-ahead prefix; a typing pause resets it (typeReset).
    property string typeBuffer: ""
    implicitHeight: Theme.controlHeight
    // Keyboard-operable like the native select it replaces: reachable by Tab,
    // opened/navigated/picked from the keys below.
    activeFocusOnTab: true
    Accessible.role: Accessible.ComboBox
    Accessible.name: root.labelFor(root.value)

    // Next selectable (non-disabled) index from `start` in direction `dir`,
    // or -1 if there is none, so arrows never land on a disabled row.
    function findSelectable(start, dir) {
        for (let i = start; i >= 0 && i < root.model.length; i += dir) {
            if (root.model[i].disabled !== true)
                return i;

        }
        return -1;
    }

    function openList() {
        let sel = -1;
        for (let i = 0; i < root.model.length; ++i) {
            if (root.model[i].value === root.value && root.model[i].disabled !== true) {
                sel = i;
                break;
            }
        }
        root.typeBuffer = "";
        root.open = true;
        // Assign the active row AFTER opening (via -1) so the change always
        // fires, and the delegate's scroll-into-view sees an open list.
        root.activeIndex = -1;
        root.activeIndex = sel >= 0 ? sel : root.findSelectable(0, 1);
    }

    function pick(index) {
        if (index < 0 || index >= root.model.length || root.model[index].disabled === true)
            return ;

        root.open = false;
        root.activated(root.model[index].value);
    }

    // A printable key jumps the active row to the first enabled label with
    // the typed prefix; the buffer dies after a pause (Theme.typeAheadResetMs).
    function typeAhead(ch) {
        typeReset.restart();
        root.typeBuffer += ch.toLowerCase();
        for (let i = 0; i < root.model.length; ++i) {
            const o = root.model[i];
            if (o.disabled !== true && (o.label || "").toLowerCase().startsWith(root.typeBuffer)) {
                root.activeIndex = i;
                return ;
            }
        }
    }

    Keys.onPressed: function(event) {
        if (!root.open) {
            // Closed: Enter/Space/Arrow opens, everything else passes on.
            if (event.key === Qt.Key_Down || event.key === Qt.Key_Up || event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
                root.openList();
                event.accepted = true;
            }
            return ;
        }
        // A printable key (no modifier) type-aheads. Space only mid-word: with
        // an empty buffer it falls through and picks the active option (the
        // listbox behaviour).
        const printable = event.text.length === 1 && event.text >= " " && !(event.modifiers & (Qt.ControlModifier | Qt.AltModifier | Qt.MetaModifier));
        if (printable && !(event.text === " " && root.typeBuffer === "")) {
            root.typeAhead(event.text);
            event.accepted = true;
            return ;
        }
        if (event.key === Qt.Key_Down) {
            const next = root.findSelectable(root.activeIndex + 1, 1);
            if (next >= 0)
                root.activeIndex = next;

            event.accepted = true;
        } else if (event.key === Qt.Key_Up) {
            const prev = root.findSelectable(root.activeIndex - 1, -1);
            if (prev >= 0)
                root.activeIndex = prev;

            event.accepted = true;
        } else if (event.key === Qt.Key_Home) {
            root.activeIndex = root.findSelectable(0, 1);
            event.accepted = true;
        } else if (event.key === Qt.Key_End) {
            root.activeIndex = root.findSelectable(root.model.length - 1, -1);
            event.accepted = true;
        } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter || event.key === Qt.Key_Space) {
            root.pick(root.activeIndex);
            event.accepted = true;
        } else if (event.key === Qt.Key_Escape) {
            root.open = false;
            event.accepted = true;
        } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
            // Close and let the Tab move focus on (not accepted).
            root.open = false;
        }
    }

    Timer {
        id: typeReset

        interval: Theme.typeAheadResetMs
        repeat: false
        onTriggered: root.typeBuffer = ""
    }

    // Place the popup at the field. Computed imperatively: a mapToItem
    // binding doesn't reliably track the field's ancestor transforms (it never
    // re-evaluates when an ancestor moves), which left the list pinned at the
    // window origin (top-left). Opens downward by default; a long list that
    // would be clipped at the bottom flips ABOVE the field when there's room,
    // else it clamps inside the window, so every option stays reachable.
    function reposition() {
        const top = field.mapToItem(Window.contentItem, 0, 0);
        const winH = Window.contentItem.height;
        const fitsBelow = top.y + field.height + list.height <= winH;
        const fitsAbove = top.y - list.height >= 0;
        list.x = Math.max(0, Math.min(top.x, Window.contentItem.width - list.width));
        if (fitsBelow)
            list.y = top.y + field.height;
        else if (fitsAbove)
            list.y = top.y - list.height;
        else
            list.y = Math.max(0, winH - list.height);
    }

    // The open list is window-anchored, so it must FOLLOW the field while the
    // panel scrolls or the layout shifts: while open, listen to x/y changes on
    // every ancestor between the field and the window (a Flickable scroll moves
    // its content item, which is in that chain) and reposition. Connections are
    // dropped on close/destruction so a torn-down delegate can't fire into a
    // dead popup.
    property var trackedAncestors: []

    function attachTracking() {
        const items = [];
        let it = field;
        while (it && it !== Window.contentItem) {
            it.xChanged.connect(root.reposition);
            it.yChanged.connect(root.reposition);
            items.push(it);
            it = it.parent;
        }
        root.trackedAncestors = items;
    }

    function detachTracking() {
        for (let i = 0; i < root.trackedAncestors.length; i++) {
            root.trackedAncestors[i].xChanged.disconnect(root.reposition);
            root.trackedAncestors[i].yChanged.disconnect(root.reposition);
        }
        root.trackedAncestors = [];
    }

    onOpenChanged: {
        if (root.open) {
            root.reposition();
            root.attachTracking();
        } else {
            root.detachTracking();
        }
    }
    Component.onDestruction: root.detachTracking()

    function labelFor(v) {
        for (let i = 0; i < model.length; ++i)
            if (model[i].value === v)
                return model[i].label;
        return root.placeholder !== "" ? root.placeholder : v;
    }

    readonly property bool showingPlaceholder: placeholder !== "" && !model.some(function(o) {
        return o.value === value;
    })

    Rectangle {
        id: field
        anchors.fill: parent
        radius: Theme.radiusSm
        color: Theme.base
        border.color: root.open || root.activeFocus ? Theme.borderFocus : Theme.surface
        border.width: Theme.borderWidth

        Text {
            anchors.left: parent.left
            anchors.right: chevron.left
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Theme.spaceMd
            text: root.labelFor(root.value)
            color: root.showingPlaceholder ? Theme.textFaint : Theme.text
            font.pixelSize: Theme.fontMd
            elide: Text.ElideRight
        }
        Text {
            id: chevron
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.rightMargin: Theme.spaceMd
            text: "▾"
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
        }
        MouseArea {
            anchors.fill: parent
            onClicked: {
                // Take focus so the keyboard drives the list a click opened.
                root.forceActiveFocus();
                if (root.open)
                    root.open = false;
                else
                    root.openList();
            }
        }
    }

    // Click-away backdrop at the window top level: covers everything while open
    // so a click outside the list closes it. Wheel events pass through it (no
    // handler), so the panel scrolls underneath and the ancestor tracking above
    // moves the open list along with its field.
    MouseArea {
        parent: Window.contentItem
        anchors.fill: parent
        visible: root.open
        z: Theme.zPopup
        onClicked: root.open = false
    }

    // The open option list, also at the window top level so it draws over the
    // following panel content. Positioned under the field; sized to its rows up
    // to a cap, then it scrolls.
    Rectangle {
        id: list
        parent: Window.contentItem
        visible: root.open
        // One above the backdrop: both sit in Window.contentItem at the popup
        // layer, and the full-window backdrop must not intercept option clicks
        // (which would close the list without emitting `activated`).
        z: Theme.zPopup + 1
        width: field.width
        height: Math.min(contentColumn.implicitHeight + Theme.borderWidth * 2, Theme.popupMaxHeight)
        radius: Theme.radiusSm
        color: Theme.panel
        border.color: Theme.surfaceStrong
        border.width: Theme.borderWidth
        clip: true

        // Wheel barrier: a wheel over the open list must never scroll the
        // panel underneath (the popup would drift over the moving content).
        // The option rows + the list's own scroll sit on top and take what
        // they use; this eats the rest (a short non-scrolling list, the ends).
        MouseArea {
            anchors.fill: parent
            onWheel: function(wheel) {
                wheel.accepted = true;
            }
        }

        Flickable {
            id: flick

            anchors.fill: parent
            anchors.margins: Theme.borderWidth
            contentHeight: contentColumn.implicitHeight
            interactive: contentHeight > height
            boundsBehavior: Flickable.StopAtBounds

            // Keep the keyboard-active row inside the viewport (arrows /
            // type-ahead can land on a scrolled-out option).
            function ensureVisible(item) {
                const y = item.mapToItem(contentColumn, 0, 0).y;
                if (y < contentY)
                    contentY = y;
                else if (y + item.height > contentY + height)
                    contentY = y + item.height - height;
            }

            Column {
                id: contentColumn
                width: parent.width

                Repeater {
                    model: root.model
                    delegate: Column {
                        id: optionBlock
                        required property var modelData
                        required property int index
                        // A group header opens above the FIRST option of each
                        // grouped run (the model is flat; group changes mark
                        // the boundaries).
                        readonly property string group: optionBlock.modelData.group || ""
                        readonly property string prevGroup: optionBlock.index > 0 ? (root.model[optionBlock.index - 1].group || "") : ""
                        readonly property bool isDisabled: optionBlock.modelData.disabled === true
                        width: contentColumn.width

                        Rectangle {
                            visible: optionBlock.group !== "" && optionBlock.group !== optionBlock.prevGroup
                            width: parent.width
                            height: Theme.rowHeight
                            color: "transparent"

                            Text {
                                anchors.left: parent.left
                                anchors.verticalCenter: parent.verticalCenter
                                anchors.leftMargin: Theme.spaceMd
                                text: optionBlock.group
                                color: Theme.textFaint
                                font.pixelSize: Theme.fontXs
                                font.bold: true
                            }
                        }

                        Rectangle {
                            id: optionRow
                            width: parent.width
                            height: Theme.rowHeight
                            // The option-role automation surface (+ selection).
                            Accessible.role: Accessible.ListItem
                            Accessible.name: optionBlock.modelData.label || ""
                            Accessible.selected: optionBlock.modelData.value === root.value
                            Accessible.onPressAction: root.pick(optionBlock.index)
                            // One highlight concept: the active row (keyboard
                            // or hover, see activeIndex) over the selected tint.
                            color: root.activeIndex === optionBlock.index && !optionBlock.isDisabled ? Theme.surface
                                 : (optionBlock.modelData.value === root.value ? Theme.selected : "transparent")

                            // Follow the keyboard: when this row becomes the
                            // active one, scroll it into the viewport.
                            Connections {
                                target: root
                                enabled: root.open

                                function onActiveIndexChanged() {
                                    if (root.activeIndex === optionBlock.index)
                                        flick.ensureVisible(optionRow);

                                }
                            }

                            Image {
                                id: optionIcon

                                anchors.left: parent.left
                                anchors.leftMargin: optionBlock.group !== "" ? Theme.spaceMd + Theme.spaceMd : Theme.spaceMd
                                anchors.verticalCenter: parent.verticalCenter
                                visible: (optionBlock.modelData.icon || "") !== ""
                                source: optionBlock.modelData.icon || ""
                                width: visible ? Theme.fontLg : 0
                                height: Theme.fontLg
                                sourceSize.width: Theme.fontLg * 2
                                sourceSize.height: Theme.fontLg * 2
                                fillMode: Image.PreserveAspectFit
                            }

                            Text {
                                anchors.left: optionIcon.visible ? optionIcon.right : parent.left
                                anchors.right: optionMark.visible ? optionMark.left : parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                // Grouped options indent under their header.
                                anchors.leftMargin: optionIcon.visible ? Theme.spaceSm : (optionBlock.group !== "" ? Theme.spaceMd + Theme.spaceMd : Theme.spaceMd)
                                anchors.rightMargin: Theme.spaceMd
                                text: (optionBlock.modelData.label || "") + ((optionBlock.modelData.marker || "") !== "" ? " " + optionBlock.modelData.marker : "")
                                color: optionBlock.isDisabled ? Theme.textFaint : Theme.text
                                font.pixelSize: Theme.fontMd
                                elide: Text.ElideRight
                            }
                            // The unified conflict marker on a flagged option
                            // (e.g. an already-bound trigger button).
                            ConflictMark {
                                id: optionMark
                                visible: conflict !== null
                                conflict: optionBlock.modelData.conflict || null
                                anchors.right: parent.right
                                anchors.rightMargin: Theme.spaceXs
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            MouseArea {
                                id: option
                                anchors.fill: parent
                                hoverEnabled: true
                                enabled: !optionBlock.isDisabled
                                // Hover moves the active row (one highlight
                                // shared with the keyboard).
                                onEntered: root.activeIndex = optionBlock.index
                                onClicked: root.pick(optionBlock.index)
                            }
                        }
                    }
                }
            }
        }
    }
}

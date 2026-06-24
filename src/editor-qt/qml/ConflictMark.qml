// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma ComponentBehavior: Bound

import QtQuick
import SpaceUX.Editor

// THE editor's conflict marker: every flagged binding, whatever detected it
// (gesture rivalry, button double-booking, the desktop tab later), renders
// through this one component off the core's unified `UiConflict` shape — a ⚠
// in a fixed-width slot (so a mark appearing never shifts the row), amber for
// soft (works, but worth knowing) and red for hard (breaks something), with
// the core-worded message in a hover bubble. Change the marking's look or
// behaviour HERE; change what it says / when it fires in core/nav-model.ts
// and the detectors it folds in.
Item {
    id: root

    // { severity: "soft"|"hard", message } or null (renders an empty slot).
    property var conflict: null

    implicitWidth: Theme.conflictSlot
    implicitHeight: Theme.controlHeight

    Text {
        id: mark

        anchors.centerIn: parent
        visible: root.conflict !== null
        text: "⚠"
        font.pixelSize: Theme.fontLg
        color: root.conflict && root.conflict.severity === "hard" ? Theme.danger : Theme.warn
    }

    HoverHint {
        text: root.conflict ? root.conflict.message : ""
    }

}

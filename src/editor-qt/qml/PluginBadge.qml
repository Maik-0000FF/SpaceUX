// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// A small labelled pill (#457 C5): the plugin manager's kind/origin/trust
// badges and the feature/permission chips, with the core-worded hover help.
// `style` picks the tint; one component so every badge matches.
Rectangle {
    id: root

    property string label: ""
    // 'kind' | 'imported' | 'builtin' | 'verified' | 'unverified' | 'community'
    // | 'chip' (the neutral feature chip) | 'warnChip' (the amber permission
    // chip, distinct from the community TRUST badge that shares the colour).
    property string badgeStyle: "chip"
    property string tooltip: ""

    readonly property color tint: root.badgeStyle === "verified" ? Theme.success : root.badgeStyle === "unverified" ? Theme.danger : (root.badgeStyle === "community" || root.badgeStyle === "warnChip") ? Theme.warn : root.badgeStyle === "imported" ? Theme.accent : Theme.textMuted

    implicitWidth: badgeText.implicitWidth + 2 * Theme.spaceMd
    implicitHeight: badgeText.implicitHeight + 2 * (Theme.spaceXs / 2)
    radius: height / 2
    color: "transparent"
    border.color: root.tint
    border.width: Theme.borderWidth

    Text {
        id: badgeText

        anchors.centerIn: parent
        text: root.label
        color: root.tint
        font.pixelSize: Theme.fontXs
    }

    HoverHint {
        text: root.tooltip
    }

}

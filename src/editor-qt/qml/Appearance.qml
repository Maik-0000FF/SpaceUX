// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// The global pie-appearance settings (#457 C2): theme, the six value sliders, and
// the marker/blur toggles. A collapsible Section bound to the core's pie
// appearance (`appearance`) + slider `ranges`; each change calls `setAppearance`
// with a patch, and the core's PieAppearanceChanged push rebuilds the preview.
// Centre/font/shape pickers land in the following C2 slices.
Section {
    id: root

    title: qsTr("Appearance")

    property var appearance: null   // PieAppearance from the core
    property var ranges: null       // { scale, opacity, labelScale, iconScale, balance }
    property var setAppearance: null // function(patch)
    // The app-level shape picker's model (InspectShapeSelects.appearance):
    // wedge + installed plugin shapes + a disabled orphan entry (C5).
    property var shapeSelect: null

    function apply(patch) {
        if (root.setAppearance)
            root.setAppearance(patch);
    }

    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
            text: qsTr("Theme")
        }
        Select {
            width: parent.width
            model: [
                { "value": "dark", "label": qsTr("Dark") },
                { "value": "light", "label": qsTr("Light") },
                { "value": "spaceux", "label": qsTr("SpaceUX") }
            ]
            value: root.appearance ? root.appearance.theme : "dark"
            onActivated: function (v) {
                root.apply({ "theme": v });
            }
        }
    }

    // The app-level shape model (#107, C5): the built-in wedge or an installed
    // shape plugin; the per-menu override in Menu settings layers over this.
    Column {
        width: parent.width
        spacing: Theme.spaceXs
        visible: root.shapeSelect !== null

        Text {
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
            text: qsTr("Shape")
        }
        Select {
            width: parent.width
            model: root.shapeSelect ? root.shapeSelect.options : []
            value: root.shapeSelect ? root.shapeSelect.value : ""
            onActivated: function (v) {
                root.apply({ "shapeModel": v === "" ? null : v });
            }
        }
    }

    // Built-in wedge render style (#47): classic edge-to-edge sectors, or the
    // modern parallel-gapped, rim-less wedges. Only affects the built-in wedge;
    // a shape plugin draws its own nodes regardless.
    Column {
        width: parent.width
        spacing: Theme.spaceXs

        Text {
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
            text: qsTr("Wedge style")
        }
        Select {
            width: parent.width
            model: [
                { "value": "classic", "label": qsTr("Classic") },
                { "value": "modern", "label": qsTr("Modern") }
            ]
            value: root.appearance ? root.appearance.wedgeStyle : "classic"
            onActivated: function (v) {
                root.apply({ "wedgeStyle": v });
            }
        }
    }

    // Modern-wedge gap controls (#47): the gap shape (constant-width parallel
    // channel vs a radial, widening one) and its size. Shown only for the modern
    // style, since they don't apply to classic wedges or shape-plugin nodes.
    Column {
        width: parent.width
        spacing: Theme.spaceXs
        visible: root.appearance && root.appearance.wedgeStyle === "modern"

        Text {
            color: Theme.textMuted
            font.pixelSize: Theme.fontXs
            text: qsTr("Gap shape")
        }
        Select {
            width: parent.width
            model: [
                { "value": "parallel", "label": qsTr("Parallel") },
                { "value": "wedge", "label": qsTr("Wedge") }
            ]
            value: root.appearance ? root.appearance.wedgeGapStyle : "parallel"
            onActivated: function (v) {
                root.apply({ "wedgeGapStyle": v });
            }
        }
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges && root.appearance.wedgeStyle === "modern"
        label: qsTr("Gap")
        range: root.ranges ? root.ranges.wedgeGap : null
        value: root.appearance ? root.appearance.wedgeGap : 0
        onMoved: function (v) {
            root.apply({ "wedgeGap": v });
        }
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges && root.appearance.wedgeStyle === "modern"
        label: qsTr("Hover")
        range: root.ranges ? root.ranges.wedgeHover : null
        value: root.appearance ? root.appearance.wedgeHoverOffset : 0
        onMoved: function (v) {
            root.apply({ "wedgeHoverOffset": v });
        }
    }

    // The six value sliders, shown once the appearance + ranges have loaded.
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges
        label: qsTr("Size")
        range: root.ranges ? root.ranges.scale : null
        value: root.appearance ? root.appearance.scale : 0
        onMoved: function (v) {
            root.apply({ "scale": v });
        }
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges
        label: qsTr("Opacity")
        range: root.ranges ? root.ranges.opacity : null
        value: root.appearance ? root.appearance.opacity : 0
        onMoved: function (v) {
            root.apply({ "opacity": v });
        }
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges
        label: qsTr("Label")
        range: root.ranges ? root.ranges.labelScale : null
        value: root.appearance ? root.appearance.labelScale : 0
        onMoved: function (v) {
            root.apply({ "labelScale": v });
        }
        // Eye in the caption hides every label menu-wide (#518), independent of
        // the size; per-item visibility (#515) still applies on top.
        showEye: true
        eyeHidden: !!(root.appearance && root.appearance.hideLabels)
        eyeTooltip: eyeHidden ? qsTr("Show all labels in the pie") : qsTr("Hide all labels in the pie")
        onEyeToggled: root.apply({
            "hideLabels": !(root.appearance && root.appearance.hideLabels)
        })
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges
        label: qsTr("Icon")
        range: root.ranges ? root.ranges.iconScale : null
        value: root.appearance ? root.appearance.iconScale : 0
        onMoved: function (v) {
            root.apply({ "iconScale": v });
        }
        showEye: true
        eyeHidden: !!(root.appearance && root.appearance.hideIcons)
        eyeTooltip: eyeHidden ? qsTr("Show all icons in the pie") : qsTr("Hide all icons in the pie")
        onEyeToggled: root.apply({
            "hideIcons": !(root.appearance && root.appearance.hideIcons)
        })
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges
        label: qsTr("Ring")
        range: root.ranges ? root.ranges.balance : null
        value: root.appearance ? root.appearance.ringBalance : 0
        onMoved: function (v) {
            root.apply({ "ringBalance": v });
        }
    }
    SliderRow {
        width: parent.width
        visible: root.appearance && root.ranges
        label: qsTr("Center")
        range: root.ranges ? root.ranges.balance : null
        value: root.appearance ? root.appearance.centerBalance : 0
        onMoved: function (v) {
            root.apply({ "centerBalance": v });
        }
    }

    // Marker / blur visibility.
    Row {
        width: parent.width
        spacing: Theme.spaceLg

        Toggle {
            checked: root.appearance ? root.appearance.showSubmenuMarkers : false
            label: qsTr("Submenus")
            onToggled: function (c) {
                root.apply({ "showSubmenuMarkers": c });
            }
        }
        Toggle {
            checked: root.appearance ? root.appearance.showDepthDots : false
            label: qsTr("Depth")
            onToggled: function (c) {
                root.apply({ "showDepthDots": c });
            }
        }
        Toggle {
            checked: root.appearance ? root.appearance.blur : false
            label: qsTr("Blur")
            onToggled: function (c) {
                root.apply({ "blur": c });
            }
        }
    }
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick

// Shared pie renderer (#344): the PieView SVG plus the menu labels as native Text
// on top, from one parsed OverlaySvgScene. The overlay and the editor preview both
// instantiate this, so the pie graphic AND the label model/baseline math have a
// single source instead of a copy in each. PieView lives in the same module
// (both are registered in SpaceUX.Shared), so it needs no import here. Sized to
// the scene's displaySize; the consumer positions it (the overlay centres it on
// the surface, the editor in the preview pane).
Item {
    id: root

    // Parsed OverlaySvgScene { svg, displaySize, labels, viewBoxSize, fontFamily,
    // baselineEm, ... }, or null before the first scene.
    property var scene: null

    // Modern wedge style (#47 PR2): faintly tint the wedge polygons as a glass
    // hint. Editor-preview only (the editor has no compositor blur to show the
    // real frost); the live overlay leaves this off and gets the real per-wedge
    // KWin blur instead. Off by default, so the overlay's instance is unaffected.
    property bool tintWedges: false
    readonly property color wedgeTintColor: "#ffffff"
    readonly property real wedgeTintAlpha: 0.08

    onSceneChanged: tintCanvas.requestPaint()
    onVbScaleChanged: tintCanvas.requestPaint()

    readonly property real displaySize: (scene && scene.displaySize > 0) ? scene.displaySize : 0
    width: displaySize
    height: displaySize

    // viewBox-to-display scale + half-extent: the native label positions (in
    // viewBox/reference coords) map onto the pie exactly where the SVG <text>
    // would have sat. Used by placedLabels() below.
    readonly property real vbScale: (scene && scene.viewBoxSize > 0) ? displaySize / scene.viewBoxSize : 0
    readonly property real vbHalf: scene ? scene.viewBoxSize / 2 : 0

    // Map the SVG's "rgb(r, g, b)" label colour (QML's color type can't parse it)
    // to a real colour; non-rgb() values fall through unchanged.
    function rgbColor(s) {
        const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(s);
        return m ? Qt.rgba(m[1] / 255, m[2] / 255, m[3] / 255, 1) : s;
    }

    // Pre-resolve each label to its rendered colour, font + display position so
    // the Repeater delegate below reads only its own modelData. That keeps the
    // delegate from reaching into the component scope (qmllint-clean) and gathers
    // the baseline math in one place. Re-runs when the scene or scale changes.
    function placedLabels() {
        const out = [];
        if (!scene || !scene.labels)
            return out;
        const em = scene.baselineEm || 0;
        const family = scene.fontFamily ? scene.fontFamily : "Inter SemiBold";
        for (let i = 0; i < scene.labels.length; ++i) {
            const l = scene.labels[i];
            out.push({
                "text": l.text,
                "color": rgbColor(l.color),
                "opacity": l.opacity,
                "anchor": l.anchor,
                "family": family,
                "px": Math.max(1, l.fontPx * vbScale),
                "ax": (l.x + vbHalf) * vbScale,
                "baseline": (l.y + l.fontPx * em + vbHalf) * vbScale
            });
        }
        return out;
    }

    PieView {
        id: pie
        anchors.fill: parent
        visible: root.scene !== null && root.scene.svg !== undefined
        svg: visible ? root.scene.svg : ""

        // Menu labels as native QML Text on top of the SVG (the SVG carries no
        // text, so it stays sharp at any DPR). Both the SVG and this model come
        // from the one scene, so they swap atomically.
        Repeater {
            model: root.placedLabels()
            delegate: Text {
                id: lbl
                required property var modelData
                text: modelData.text
                color: modelData.color
                opacity: modelData.opacity
                renderType: Text.NativeRendering
                font.family: modelData.family
                font.weight: Font.DemiBold
                font.pixelSize: modelData.px

                // Measure the chosen font so the glyph baseline lands where the SVG
                // <text> baseline would, not the line-box centre.
                FontMetrics {
                    id: fm
                    font: lbl.font
                }
                x: modelData.anchor === "middle" ? modelData.ax - width / 2
                 : modelData.anchor === "end" ? modelData.ax - width : modelData.ax
                y: modelData.baseline - fm.ascent
            }
        }
    }

    // Glass-hint tint for the modern wedge (editor preview only; see tintWedges).
    // Fills each wedge + centre polygon from scene.blurWedges, mapped with the
    // same viewBox-to-display transform the labels use, at a low alpha so it reads
    // as a faint glass sheen rather than a solid overlay.
    Canvas {
        id: tintCanvas
        anchors.fill: parent
        visible: root.tintWedges && root.scene !== null
                 && root.scene.blurWedges !== undefined && root.vbScale > 0
        onVisibleChanged: requestPaint()
        onPaint: {
            const ctx = getContext("2d");
            ctx.reset();
            if (!visible)
                return;
            const polys = root.scene.blurWedges;
            ctx.fillStyle = Qt.rgba(root.wedgeTintColor.r, root.wedgeTintColor.g,
                                    root.wedgeTintColor.b, root.wedgeTintAlpha);
            for (let i = 0; i < polys.length; ++i) {
                const p = polys[i];
                if (p.length < 6)
                    continue;
                ctx.beginPath();
                ctx.moveTo((p[0] + root.vbHalf) * root.vbScale, (p[1] + root.vbHalf) * root.vbScale);
                for (let j = 2; j + 1 < p.length; j += 2)
                    ctx.lineTo((p[j] + root.vbHalf) * root.vbScale, (p[j + 1] + root.vbHalf) * root.vbScale);
                ctx.closePath();
                ctx.fill();
            }
        }
    }
}

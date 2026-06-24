// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

// Renders the pie pushed from the SpaceUX side via OverlayController.SetScene.
// The scene is the whole pie as one SVG string (built by the shared
// src/core/pie-svg `buildPieSvg` — the SAME graphic the editor preview renders),
// plus the surface-space sizes around it. This QML is a dumb renderer: it shows
// the SVG in a centred Image and reports pointer events back. All geometry,
// colours, icons, hit-testing and the hovered-sector highlight are computed on
// the SpaceUX side and baked into the SVG, so the overlay and the preview can
// never visually diverge (#344).
//
// Scene schema (src/core/overlay-svg.ts OverlaySvgScene):
//   { "svg": "<svg…>",          // the pie geometry, colours/icons/markers baked in
//     "extent": <number>,       // frosted-blur + input-region radius (surface px)
//     "displaySize": <number>,  // square edge the SVG viewBox maps to (surface px)
//     "labels": [ … ],          // menu labels as native-text descriptors
//     "viewBoxSize": <number>,  // SVG viewBox edge (reference units, labels live here)
//     "fontFamily": "<string>"  // resolved label font face
//   }
// The SVG renders via Qt's SVG image format (a data URI), which draws paths,
// circles and embedded <image> icons crisply. The labels are NOT in the SVG;
// they render as native QML Text on top (NativeRendering) so they stay sharp at
// any DPR, swapping atomically with the SVG (one parsed scene drives both).

import QtQuick
import QtQuick.Window
import SpaceUX

Item {
    id: root
    // Surface size comes from the controller (single source of truth shared with
    // the input-region mask), so the drawing and the click-through circle match.
    width: OverlayController.surfaceSize
    height: OverlayController.surfaceSize

    // Parsed SetScene payload; null until the first valid push.
    property var scene: null

    function parseScene() {
        const json = OverlayController.sceneJson;
        if (json.length === 0) {
            scene = null;
            return;
        }
        try {
            scene = JSON.parse(json);
        } catch (e) {
            console.warn("Overlay: invalid scene JSON:", e);
            scene = null;
        }
    }

    Component.onCompleted: parseScene()

    // Re-read when the SpaceUX side pushes a new scene (drill, hover, or a live
    // appearance edit — colours and opacity now ride in the SVG, not a separate
    // theme push, so every visible change arrives as a new scene).
    Connections {
        target: OverlayController
        function onSceneChanged() { root.parseScene(); }
    }

    // The pie + labels, rendered by the shared ScenePie (the same component the
    // editor preview uses, so there is one scene renderer, #344). Centred on the
    // surface, so the pie centre (the viewBox centre) lands on the cursor.
    ScenePie {
        scene: root.scene
        anchors.centerIn: parent
    }

    // Pointer events only arrive inside the input-region mask (the pie circle);
    // everything outside falls through to the window below. Raw coordinates go
    // back so the SpaceUX side can hit-test them with the real layout.
    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        onPositionChanged: (mouse) => OverlayController.reportPointerMoved(mouse.x, mouse.y)
        onPressed: (mouse) => OverlayController.reportPointerPressed(mouse.x, mouse.y)
    }
}

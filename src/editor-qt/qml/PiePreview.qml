// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Shared

// The interactive pie preview (#457 Phase B2 drill): the shared ScenePie graphic
// plus a pointer hit-test that turns a click into a drill / select / breadcrumb
// action. The hit geometry is NOT recomputed here — the core's scene carries a
// `hit` model (each ring's rotation, sector count, radial band and per-sector
// branch flags, in the same reference/viewBox coords as the labels), so this
// only does generic angular + radius containment. The host (Main) maps the
// emitted signals onto its viewPath / selectedPath.
//
// Size (#473): the preview shows the pie at its REAL size — the same logical size
// the native overlay uses (the editor builds the scene with dpr 1) — so it
// faithfully depicts the actual pie and stays a FIXED size whatever the editor
// window does. Shrinking the window does not resize the pie. Full visibility is
// preferred: the pie is centred when it fits, and when the window / monitor is
// too small to show all of it the preview scrolls (scrollbars) instead of
// clipping. The size depends only on the size slider + the monitor scale.
Item {
    id: root

    // Parsed OverlaySvgScene (with .hit), or null before the first build.
    property var scene: null

    // A branch sector in the active ring was clicked: drill into it.
    signal drillRequested(int index)
    // A leaf sector in the active ring was clicked: select it for editing.
    signal selectRequested(int index)
    // A parent sector in the breadcrumb ring (only present when drilled) was
    // clicked: navigate up to it.
    signal breadcrumbRequested(int index)
    // The centre hole was clicked: select the root/centre node.
    signal centreRequested()
    // A wedge was dragged onto another slot of the active ring: reorder.
    signal reorderRequested(int from, int to)
    // Read-only source (#77): drags never start (no indicator, no steal), so
    // the affordance matches the tree; clicks (drill/select) stay live.
    property bool readOnly: false

    // The active drag: the grabbed sector, the current drop target (-1 =
    // outside the ring) and whether the press travelled far enough to count
    // as a drag rather than a click.
    property int dragFrom: -1
    property int dropTo: -1
    property bool dragActive: false

    Flickable {
        id: flick
        anchors.fill: parent
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        // The content is at least the viewport, so the pie centres when it fits,
        // and grows to the pie when it is larger, so it scrolls (not clips).
        contentWidth: Math.max(pie.width, width)
        contentHeight: Math.max(pie.height, height)
        // Centre the view on the pie's middle. Fires on EVERY geometry change
        // (the pie's size via the slider AND the viewport via a resize / the
        // start-up layout), so the pie is already centred on the first frame
        // (scrollbars in the middle) instead of landing top-left and jumping to
        // centre on the first edit. Scrolling only moves contentX/Y, not the
        // geometry, so the user can still scroll to the edges afterwards.
        function recenter() {
            flick.contentX = Math.max(0, (flick.contentWidth - flick.width) / 2);
            flick.contentY = Math.max(0, (flick.contentHeight - flick.height) / 2);
        }
        onContentWidthChanged: flick.recenter()
        onContentHeightChanged: flick.recenter()
        onWidthChanged: flick.recenter()
        onHeightChanged: flick.recenter()

        // The shared renderer at its real (displaySize) size, centred in the
        // content — the editor preview and the live overlay paint the identical
        // pie (#344).
        ScenePie {
            id: pie
            scene: root.scene
            // The editor has no compositor blur, so hint the modern wedge's glass
            // look with a faint tint on the wedge polygons (#47 PR2).
            tintWedges: true
            x: (flick.contentWidth - width) / 2
            y: (flick.contentHeight - height) / 2
        }

        MouseArea {
            id: pieMouse

            property real pressX: 0
            property real pressY: 0

            anchors.fill: parent
            enabled: root.scene !== null && root.scene.hit !== undefined
            // A drag that starts ON an active-ring wedge reorders;
            // the Flickable must not steal it for
            // panning. Presses elsewhere (centre, breadcrumb, outside) keep
            // the default behaviour.
            preventStealing: root.dragFrom >= 0
            onPressed: function (mouse) {
                pressX = mouse.x;
                pressY = mouse.y;
                root.dragFrom = root.readOnly ? -1 : root.activeSectorAt(mouse.x - pie.x, mouse.y - pie.y);
                root.dropTo = -1;
                root.dragActive = false;
            }
            onPositionChanged: function (mouse) {
                if (root.dragFrom < 0 || !pressed)
                    return;
                if (!root.dragActive && Math.abs(mouse.x - pressX) + Math.abs(mouse.y - pressY) > Theme.dragThreshold)
                    root.dragActive = true;
                if (root.dragActive)
                    root.dropTo = root.activeSectorAt(mouse.x - pie.x, mouse.y - pie.y);
            }
            onReleased: function (mouse) {
                const from = root.dragFrom;
                const to = root.dropTo;
                const dragged = root.dragActive;
                root.dragFrom = -1;
                root.dropTo = -1;
                root.dragActive = false;
                if (dragged) {
                    if (from >= 0 && to >= 0 && to !== from)
                        root.reorderRequested(from, to);
                    return;
                }
                // No drag: plain click semantics.
                root.handleClick(mouse.x - pie.x, mouse.y - pie.y);
            }
            onCanceled: {
                root.dragFrom = -1;
                root.dropTo = -1;
                root.dragActive = false;
            }
        }

        // Drop indicator: outlines the targeted wedge while a drag is over a
        // new slot. Painted from the same hit geometry the click test uses.
        Canvas {
            id: dropMarker

            x: pie.x
            y: pie.y
            width: pie.width
            height: pie.height
            visible: root.dragActive && root.dropTo >= 0 && root.dropTo !== root.dragFrom
            onVisibleChanged: requestPaint()

            Connections {
                target: root
                function onDropToChanged() {
                    dropMarker.requestPaint();
                }
            }

            onPaint: {
                const ctx = getContext("2d");
                ctx.clearRect(0, 0, width, height);
                if (!visible || !root.scene || !root.scene.hit)
                    return;
                const ring = root.scene.hit.active;
                const vb = root.scene.viewBoxSize;
                const k = width / vb; // viewBox -> px
                const tau = Math.PI * 2;
                const half = tau / ring.count / 2;
                const c = ring.rotation + root.dropTo * (tau / ring.count);
                // atan2(x,-y) space: angle 0 at 12 o'clock, clockwise. Canvas
                // arcs measure from 3 o'clock, so shift by -tau/4.
                const a0 = c - half - tau / 4;
                const a1 = c + half - tau / 4;
                const cx = width / 2;
                const cy = height / 2;
                ctx.beginPath();
                ctx.arc(cx, cy, ring.r1 * k, a0, a1);
                ctx.arc(cx, cy, ring.r0 * k, a1, a0, true);
                ctx.closePath();
                ctx.lineWidth = Theme.borderWidth * 2;
                ctx.strokeStyle = Theme.borderFocus;
                ctx.stroke();
            }
        }
    }

    ScrollBar {
        flickable: flick
        orientation: Qt.Vertical
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
    }
    ScrollBar {
        flickable: flick
        orientation: Qt.Horizontal
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
    }

    // The active-ring sector under a point in pie-local px, or -1 (used by the
    // drag; the centre and breadcrumb never start a reorder).
    function activeSectorAt(px, py) {
        const scene = root.scene;
        if (!scene || !scene.hit || pie.width <= 0)
            return -1;
        const vb = scene.viewBoxSize;
        return root.pickSector(scene.hit.active, px * vb / pie.width - vb / 2, py * vb / pie.height - vb / 2);
    }

    // Pick the sector of `ring` (a PieHitRing) under a point given in reference
    // coords, or -1 if the point is outside the ring's radial band / the ring is
    // empty. atan2(x, -y) puts 0 at 12 o'clock growing clockwise, matching the
    // SVG sector layout; subtracting the ring rotation undoes its drill offset.
    function pickSector(ring, refX, refY) {
        if (!ring || ring.count <= 0)
            return -1;
        const r = Math.hypot(refX, refY);
        if (r < ring.r0 || r > ring.r1)
            return -1;
        const tau = Math.PI * 2;
        let theta = Math.atan2(refX, -refY) - ring.rotation;
        theta = ((theta % tau) + tau) % tau;
        return Math.round(theta / (tau / ring.count)) % ring.count;
    }

    // Map a click (px within the pie square, 0..displaySize) to a ring action.
    function handleClick(px, py) {
        const scene = root.scene;
        if (!scene || !scene.hit || pie.width <= 0)
            return;
        // Invert ScenePie's label mapping: px = (ref + vb/2) * size / vb, so
        // ref = px * vb / size - vb/2. The hit bands live in this viewBox space.
        const vb = scene.viewBoxSize;
        const refX = px * vb / pie.width - vb / 2;
        const refY = py * vb / pie.height - vb / 2;

        const active = scene.hit.active;
        const bc = scene.hit.breadcrumb;
        // The centre hole (inside the innermost ring's inner radius) selects the
        // root, so the centre is reachable from the preview like any other node.
        const innerR0 = bc ? bc.r0 : active.r0;
        if (Math.hypot(refX, refY) < innerR0) {
            root.centreRequested();
            return;
        }
        const a = root.pickSector(active, refX, refY);
        if (a >= 0) {
            if (active.branch[a])
                root.drillRequested(a);
            else
                root.selectRequested(a);
            return;
        }
        const a2 = root.pickSector(bc, refX, refY);
        if (a2 >= 0)
            root.breadcrumbRequested(a2);
    }
}

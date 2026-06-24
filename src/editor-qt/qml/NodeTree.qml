// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor
import "paths.js" as Paths

// The menu structure as an indented, editable list (#457): the editor's MenuList.
// Flattens the config into rows (the centre/root first, then the branches
// depth-first) and adds per-row editing: rename (double-click / ✎), add a child
// (＋ — a leaf becomes a submenu, like the Type→Submenu switch), and delete (🗑,
// the root has none). The structural edits run through the host's core-backed
// callbacks; selection stays single-sourced in Main.
//
// MenuList part B: move a node by dragging it onto a drop-line in any ring
// (reorder within its ring, or into another submenu / the top level), or by
// keyboard: X cuts the focused node, V pastes it before the focused target
// row, Esc cancels (#368), Alt+↑/↓ reorders within the ring. Arrow-key
// tree navigation (↑/↓/←/→/Home/End) carries the roving focus. The host
// validates a cross-ring drop against the core's GetMoveTargets (no drop-line
// for a move the transform would reject) and runs the move; afterwards
// `remapAfterMove` keeps the expand state + the cut on the same nodes.
Item {
    id: root

    property var config: null
    property string selectedPath: ""
    // Path being renamed inline ("" = the centre/root), with `renaming` the gate.
    property string renamingPath: ""
    property bool renaming: false
    // Expanded branch paths ({ "/0": true, ... }). The centre's children (the top
    // level) are always shown; a branch shows its children only when expanded.
    property var expanded: ({
    })
    property var rows: flatten(config, expanded)
    // Keyboard focus: the row the arrow keys move through (the WAI-ARIA tree
    // pattern's roving focus). Selection stays a click/Enter: arrows move
    // focus, the row click selects.
    property int focusedRow: -1
    // The node lifted by X for a keyboard move ("" = none; the root row is
    // never cuttable). V pastes it before the focused row; Esc cancels.
    // Read-only source (#77): a plugin-provided pie is active. Every structure
    // edit (add/rename/delete/drag/cut-paste/reorder) is gated here; selection
    // and keyboard navigation stay live so the tree is still inspectable.
    property bool readOnly: false
    property string cutPath: ""
    // Drag-to-move state: the dragged row + its path, the resolved drop (target
    // ring + insertion gap), and the row the drop-line anchors on. The drop ring
    // can differ from the drag ring (a cross-ring move), not just a reorder.
    property int dragRow: -1
    property string dragPath: ""
    property int dropAnchorRow: -1
    property bool dropBelow: false
    property string dropRing: ""
    property int dropIndex: -1
    // Eligible target rings for the active drag (path strings), from the core's
    // GetMoveTargets (no cycle, fits the depth cap, not the node's own ring).
    // The host sets it async after `dragStarted`; until then cross-ring drops
    // gate closed (a within-ring reorder needs no targets).
    property var moveTargets: []
    // Auto-scroll while a drag hovers the viewport's edge band (-1 up / 1 down),
    // and the pointer's last viewport y: the scroll moves the content under a
    // RESTING pointer, so each tick re-resolves the drop from this instead of
    // waiting for the next pointer move.
    property int autoScrollDir: 0
    property real lastDragViewY: 0
    // Focus this path once the rows rebuild (the moved node after a move lands).
    property var pendingFocusPath: null
    // Row content can outgrow the panel (deep indent + long label), so the tree
    // scrolls both ways and rows grow to the widest one instead of squeezing the
    // label. Recomputed straight from the row data whenever the rows
    // change, so it both grows AND shrinks with no delegate-timing race. Assigned
    // imperatively (not a binding): computeMaxRowWidth reads + writes the shared
    // TextMetrics, which as a binding would self-trigger a loop.
    property real maxRowWidth: 0
    // Max nesting depth the validator allows (centre = depth 0); the host sets it
    // from the core (GetMenuLimits). A node at this depth can't gain a child.
    property int maxDepth: 16

    signal nodeSelected(string path)
    // ＋ on a node: add a child. `isBranch` true → add into its ring; false → the
    // leaf becomes a submenu (the host runs SetNodeKind).
    signal addChildRequested(string path, bool isBranch)
    // ＋ on the centre: add a top-level node.
    signal addTopLevelRequested()
    // 🗑 on a node (never the root).
    signal deleteRequested(string path)
    // Commit an inline rename ("" path = the centre).
    signal renameCommitted(string path, string label)
    // A row drag began: the host fetches the eligible rings (GetMoveTargets)
    // into `moveTargets` so the drop-line only shows where a move can land.
    signal dragStarted(string path)
    // Move `fromPath` into `toRing`, inserting before gap `insertAt`: a drag
    // drop or (paste = true) the keyboard V. The host maps a same-ring gap to a
    // reorder and runs the matching core transform.
    signal moveRequested(string fromPath, string toRing, int insertAt, bool paste)
    // Alt+↑/↓ on the focused row: reorder one slot within its ring.
    signal reorderRequested(string path, int delta)

    function rowIndexOf(path) {
        for (let i = 0; i < root.rows.length; i++) {
            if (root.rows[i].path === path)
                return i;

        }
        return -1;
    }

    // Label of the node at `path`, for the keyboard-move hint.
    function nodeLabelByPath(path) {
        if (!root.config || !root.config.root)
            return "";

        let node = root.config.root;
        const parts = Paths.toIndices(path);
        for (let i = 0; i < parts.length; i++) {
            if (!node.branches || parts[i] < 0 || parts[i] >= node.branches.length)
                return "";

            node = node.branches[parts[i]];
        }
        return node.label || "";
    }

    // ── Move bookkeeping (paths are positional, so view state keyed on them
    // must follow a structure change) ────────────────────────────────────────
    // One index path after the node at `fromArr` moved to `toArr` (its final
    // path): a key inside the moved subtree follows it; otherwise the source
    // splice shifts later siblings down and the insertion shifts target-ring
    // keys at/after the slot up.
    function remapIndicesAfterMove(key, fromArr, toArr) {
        if (Paths.isIndexPrefix(fromArr, key))
            return toArr.concat(key.slice(fromArr.length));

        const out = key.slice();
        const fromRing = fromArr.slice(0, -1);
        const fromIdx = fromArr[fromArr.length - 1];
        if (out.length > fromRing.length && Paths.isIndexPrefix(fromRing, out) && out[fromRing.length] > fromIdx)
            out[fromRing.length] -= 1;

        const toRing = toArr.slice(0, -1);
        const toIdx = toArr[toArr.length - 1];
        if (out.length > toRing.length && Paths.isIndexPrefix(toRing, out) && out[toRing.length] >= toIdx)
            out[toRing.length] += 1;

        return out;
    }

    // Re-key the expand state + the pending cut after a move the host applied,
    // and focus the moved node once the rows rebuild. `paste` = the move WAS the
    // pending cut's paste, so the cut is done; a drag of the cut node keeps it.
    function remapAfterMove(fromPath, toPath, paste) {
        const fromArr = Paths.toIndices(fromPath);
        const toArr = Paths.toIndices(toPath);
        // Before the `expanded` write: that write re-evaluates `rows`
        // synchronously, and onRowsChanged is what consumes the pending focus.
        root.pendingFocusPath = toPath;
        const next = {};
        for (const k in root.expanded) {
            if (root.expanded[k] === true)
                next[Paths.toPath(root.remapIndicesAfterMove(Paths.toIndices(k), fromArr, toArr))] = true;

        }
        root.expanded = next;
        if (root.cutPath !== "") {
            if (paste && root.cutPath === fromPath)
                root.cutPath = "";
            else
                root.cutPath = Paths.toPath(root.remapIndicesAfterMove(Paths.toIndices(root.cutPath), fromArr, toArr));
        }
    }

    // Re-key the expand state + the pending cut after a delete the host applied:
    // keys inside the deleted subtree drop, later siblings shift down. (A parent
    // collapsed by deleting its last child just leaves a stale leaf key, which
    // flatten ignores.)
    function remapAfterDelete(ringPath, index) {
        const ringArr = Paths.toIndices(ringPath);
        const delArr = ringArr.concat([index]);
        const next = {};
        for (const k in root.expanded) {
            if (root.expanded[k] !== true)
                continue;

            const arr = Paths.toIndices(k);
            if (Paths.isIndexPrefix(delArr, arr))
                continue;

            if (arr.length > ringArr.length && Paths.isIndexPrefix(ringArr, arr) && arr[ringArr.length] > index)
                arr[ringArr.length] -= 1;

            next[Paths.toPath(arr)] = true;
        }
        root.expanded = next;
        if (root.cutPath !== "") {
            const cut = Paths.toIndices(root.cutPath);
            if (Paths.isIndexPrefix(delArr, cut)) {
                root.cutPath = "";
            } else if (cut.length > ringArr.length && Paths.isIndexPrefix(ringArr, cut) && cut[ringArr.length] > index) {
                cut[ringArr.length] -= 1;
                root.cutPath = Paths.toPath(cut);
            }
        }
    }

    function clearCut() {
        root.cutPath = "";
    }

    // ── Drag-to-move ─────────────────────────────────────────────────────────
    function beginDrag(rowIdx, path) {
        root.dragRow = rowIdx;
        root.dragPath = path;
        root.moveTargets = [];
        root.clearDrop();
        root.dragStarted(path);
    }

    function clearDrop() {
        root.dropAnchorRow = -1;
        root.dropBelow = false;
        root.dropRing = "";
        root.dropIndex = -1;
    }

    function endDrag() {
        root.dragRow = -1;
        root.dragPath = "";
        root.autoScrollDir = 0;
        root.clearDrop();
    }

    function commitDrop() {
        const fromPath = root.dragPath;
        const toRing = root.dropRing;
        const insertAt = root.dropIndex;
        const valid = root.dropAnchorRow >= 0;
        root.endDrag();
        if (valid)
            root.moveRequested(fromPath, toRing, insertAt, false);

    }

    // Resolve the drop for a pointer at `yInCol` (content coordinates): insert
    // before/after the hovered row in ITS OWN ring (top/bottom half), validated
    // before the drop-line shows: a within-ring drop must be a real reorder, a
    // cross-ring drop must be an eligible ring (GetMoveTargets already excludes
    // the dragged subtree, over-deep rings and the node's own ring).
    function updateDrop(yInCol) {
        const i = Math.floor(yInCol / Theme.rowHeight);
        if (i < 0 || i >= root.rows.length) {
            root.clearDrop();
            return ;
        }
        const row = root.rows[i];
        if (row.isRoot) {
            root.clearDrop();
            return ;
        }
        const ring = Paths.parentPath(row.path);
        const idx = Paths.lastIndex(row.path);
        let below = (yInCol - i * Theme.rowHeight) > Theme.rowHeight / 2;
        // Dragging UP out of this very branch: its bottom half would mean
        // "after the branch", whose line renders below the whole subtree the
        // pointer just left (#81), a downward jump mid-upward-drag. Read it
        // as "before the branch" instead; the after-gap stays reachable from
        // the next sibling row below the subtree.
        if (below && row.isBranch && row.isOpen && root.dragPath.indexOf(row.path + "/") === 0)
            below = false;

        const gap = below ? idx + 1 : idx;
        if (ring === Paths.parentPath(root.dragPath)) {
            // The reorder no-op gaps: the node's own slot and the one after it.
            const from = Paths.lastIndex(root.dragPath);
            const to = gap > from ? gap - 1 : gap;
            if (to === from) {
                root.clearDrop();
                return ;
            }
        } else if (root.moveTargets.indexOf(ring) < 0) {
            root.clearDrop();
            return ;
        }
        // Anchor the drop-line: "after" an EXPANDED branch renders below its
        // whole subtree (its last visible descendant) instead of between the
        // branch row and its first child, so a sibling-after drop doesn't read
        // as "make it the first child" (#81). The target gap is unchanged.
        let anchor = i;
        if (below && row.isBranch && row.isOpen) {
            const prefix = row.path + "/";
            for (let j = i + 1; j < root.rows.length && root.rows[j].path.indexOf(prefix) === 0; j++) anchor = j
        }
        root.dropAnchorRow = anchor;
        root.dropBelow = below;
        root.dropRing = ring;
        root.dropIndex = gap;
    }

    // Auto-scroll direction while the drag pointer sits in the viewport's edge
    // band, so a long tree can be traversed mid-drag.
    function updateEdgeScroll(yInView) {
        root.lastDragViewY = yInView;
        if (yInView < Theme.dragEdgeZone)
            root.autoScrollDir = -1;
        else if (yInView > flick.height - Theme.dragEdgeZone)
            root.autoScrollDir = 1;
        else
            root.autoScrollDir = 0;
    }

    // ── Keyboard: roving tree focus + move shortcuts ─────────────────────────
    function focusRow(i) {
        root.focusedRow = i;
        root.ensureRowVisible(i);
    }

    function ensureRowVisible(i) {
        if (i < 0)
            return ;

        const top = i * Theme.rowHeight;
        const bottom = top + Theme.rowHeight;
        if (flick.contentY > top)
            flick.contentY = top;
        else if (flick.contentY + flick.height < bottom)
            flick.contentY = Math.max(0, bottom - flick.height);
    }

    // The tree's key handling (the WAI-ARIA tree pattern + the move shortcuts):
    // arrows move the roving focus, ←/→ collapse/expand, Enter/Space selects,
    // Alt+↑/↓ reorders, X cuts / V pastes / Esc cancels (#368). Returns true
    // when the key was handled (the caller accepts the event).
    function handleKey(event) {
        if (root.rows.length === 0)
            return false;

        if (root.focusedRow < 0 || root.focusedRow >= root.rows.length)
            root.focusedRow = Math.max(0, root.rowIndexOf(root.selectedPath));

        const r = root.rows[root.focusedRow];
        if (event.modifiers & Qt.AltModifier) {
            if ((event.key === Qt.Key_Up || event.key === Qt.Key_Down) && !r.isRoot && !root.readOnly) {
                root.reorderRequested(r.path, event.key === Qt.Key_Up ? -1 : 1);
                return true;
            }
            return false;
        }
        if (event.modifiers & (Qt.ControlModifier | Qt.MetaModifier))
            return false;

        switch (event.key) {
        case Qt.Key_Down:
            root.focusRow(Math.min(root.focusedRow + 1, root.rows.length - 1));
            return true;
        case Qt.Key_Up:
            root.focusRow(Math.max(root.focusedRow - 1, 0));
            return true;
        case Qt.Key_Home:
            root.focusRow(0);
            return true;
        case Qt.Key_End:
            root.focusRow(root.rows.length - 1);
            return true;
        case Qt.Key_Right:
            // Collapsed branch → expand; open branch (incl. root) → first child.
            if (r.isBranch && !r.isOpen && !r.isRoot) {
                root.toggleExpand(r.path);
            } else if (r.isBranch) {
                const child = root.rows[root.focusedRow + 1];
                if (child !== undefined && Paths.parentPath(child.path) === r.path)
                    root.focusRow(root.focusedRow + 1);

            }
            return true;
        case Qt.Key_Left:
            // Open branch → collapse; otherwise → focus the parent row.
            if (r.isBranch && r.isOpen && !r.isRoot) {
                root.toggleExpand(r.path);
            } else if (!r.isRoot) {
                const parent = root.rowIndexOf(Paths.parentPath(r.path));
                if (parent >= 0)
                    root.focusRow(parent);

            }
            return true;
        case Qt.Key_Return:
        case Qt.Key_Enter:
        case Qt.Key_Space:
            root.nodeSelected(r.path);
            return true;
        case Qt.Key_X:
            // Cut the focused node for a keyboard move (#368); V on a target
            // row pastes it there. The root can't be cut or pasted before, so
            // those presses stay unhandled instead of being swallowed.
            if (r.isRoot || root.readOnly)
                return false;

            root.cutPath = r.path;
            return true;
        case Qt.Key_V:
            if (root.cutPath === "" || r.isRoot || root.readOnly)
                return false;

            root.moveRequested(root.cutPath, Paths.parentPath(r.path), Paths.lastIndex(r.path), true);
            return true;
        case Qt.Key_Escape:
            if (root.cutPath !== "") {
                root.cutPath = "";
                return true;
            }
            return false;
        }
        return false;
    }

    function startRename(path) {
        root.renamingPath = path;
        root.renaming = true;
    }

    function endRename() {
        root.renaming = false;
        root.renamingPath = "";
    }

    function hasIcon(node) {
        return node && typeof node.icon === "string" && node.icon.length > 0;
    }

    function isExpanded(path) {
        return root.expanded[path] === true;
    }

    function toggleExpand(path) {
        const e = root.expanded;
        e[path] = !(e[path] === true);
        root.expanded = Object.assign({
        }, e); // reassign so `rows` re-evaluates
    }

    // Reveal a node by expanding every ancestor along its path (not the node
    // itself), so a selection made elsewhere (a preview wedge, an add) shows up.
    function revealPath(path) {
        if (!path)
            return ;

        const parts = path.split("/").filter(function(p) {
            return p.length > 0;
        });
        const e = root.expanded;
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
            acc += "/" + parts[i];
            e[acc] = true;
        }
        root.expanded = Object.assign({
        }, e);
    }

    // Flatten root + the EXPANDED branches depth-first into editable rows. The
    // centre row mirrors an item row (its icon + label), with the "Center"
    // placeholder when it has neither so it stays identifiable.
    function flatten(menuConfig, exp) {
        const rows = [];
        if (!menuConfig || !menuConfig.root)
            return rows;

        const r = menuConfig.root;
        rows.push({
            "isRoot": true,
            "label": (r.label && r.label.length > 0) ? r.label : (root.hasIcon(r) ? "" : qsTr("Center")),
            "rawLabel": r.label || "",
            "icon": root.hasIcon(r) ? r.icon : "",
            "depth": 0,
            "path": "",
            "isBranch": true,
            "isOpen": true
        });
        const walk = function walk(nodes, ringPath, depth) {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const path = ringPath + "/" + i;
                const branches = node.branches || [];
                const isBranch = branches.length > 0;
                const isOpen = exp[path] === true;
                rows.push({
                    "isRoot": false,
                    "label": (node.label && node.label.length > 0) ? node.label : qsTr("(unnamed)"),
                    "rawLabel": node.label || "",
                    "icon": root.hasIcon(node) ? node.icon : "",
                    "depth": depth,
                    "path": path,
                    "isBranch": isBranch,
                    "isOpen": isOpen
                });
                if (isBranch && isOpen)
                    walk(branches, path, depth + 1);

            }
        };
        walk(r.branches || [], "", 1);
        return rows;
    }

    // Widest row's content width, matching the delegate's layout: indent + caret
    // + (icon) + the label (capped) + the action column (＋ ✎ 🗑, the centre has
    // no 🗑) + the gaps. Measures the label with TextMetrics rather than the
    // rendered Text, so it's a pure function of the data.
    function computeMaxRowWidth(rs) {
        if (!rs)
            return 0;

        let m = 0;
        for (let i = 0; i < rs.length; i++) {
            const r = rs[i];
            labelMetric.text = r.label;
            const labelW = Math.min(labelMetric.advanceWidth, Theme.treeLabelMax);
            const caretRight = Theme.spaceMd + r.depth * Theme.spaceLg + Theme.fontMd;
            const labelX = (r.icon !== "" ? caretRight + Theme.spaceXs + Theme.fontLg : caretRight) + Theme.spaceXs;
            const actionsW = (r.isRoot ? 2 : 3) * Theme.rowHeight;
            const w = labelX + labelW + Theme.spaceXs + actionsW + Theme.spaceXs;
            if (w > m)
                m = w;

        }
        return m;
    }

    // The tree is one keyboard stop (the roving focus walks the rows).
    activeFocusOnTab: true
    Keys.onPressed: function(event) {
        if (root.handleKey(event))
            event.accepted = true;

    }
    onActiveFocusChanged: {
        if (activeFocus && root.focusedRow < 0)
            root.focusedRow = Math.max(0, root.rowIndexOf(root.selectedPath));

    }
    onSelectedPathChanged: root.revealPath(root.selectedPath)
    onRowsChanged: {
        root.maxRowWidth = root.computeMaxRowWidth(root.rows);
        // Land the keyboard focus on the node a move re-homed (its path changed,
        // so the index can only be resolved against the rebuilt rows), and keep
        // the focus inside the list when it shrank.
        if (root.pendingFocusPath !== null) {
            const i = root.rowIndexOf(root.pendingFocusPath);
            if (i >= 0)
                root.focusRow(i);

            root.pendingFocusPath = null;
        } else if (root.focusedRow >= root.rows.length) {
            root.focusedRow = root.rows.length - 1;
        }
    }
    Component.onCompleted: root.maxRowWidth = root.computeMaxRowWidth(root.rows)

    TextMetrics {
        id: labelMetric

        font.pixelSize: Theme.fontMd
    }

    // Live hint while a keyboard move is pending (a status-role live
    // line): names the lifted node and how to place / cancel.
    Rectangle {
        id: moveHint

        visible: root.cutPath !== ""
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: Theme.spaceXs
        anchors.rightMargin: Theme.spaceXs
        anchors.topMargin: visible ? Theme.spaceXs : 0
        height: visible ? hintText.implicitHeight + 2 * Theme.spaceXs : 0
        radius: Theme.radiusSm
        color: Theme.base

        Text {
            id: hintText

            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Theme.spaceMd
            anchors.rightMargin: Theme.spaceMd
            wrapMode: Text.Wrap
            font.pixelSize: Theme.fontXs
            color: Theme.textMuted
            text: root.cutPath === "" ? "" : qsTr("Moving “%1”: focus a target row and press V to place it before it (Esc to cancel).").arg(root.nodeLabelByPath(root.cutPath))
        }

    }

    // Auto-scroll the list while a drag hovers the viewport's edge band. Each
    // tick re-resolves the drop from the resting pointer position, so the
    // drop-line tracks the content scrolling underneath it.
    Timer {
        interval: Theme.dragScrollInterval
        running: root.dragRow >= 0 && root.autoScrollDir !== 0
        repeat: true
        onTriggered: {
            const max = Math.max(0, flick.contentHeight - flick.height);
            flick.contentY = Math.max(0, Math.min(max, flick.contentY + root.autoScrollDir * Theme.dragEdgeStep));
            root.updateDrop(root.lastDragViewY + flick.contentY);
        }
    }

    PanelFlickable {
        id: flick

        // The tree-role automation surface over the treeitem rows.
        Accessible.role: Accessible.Tree
        Accessible.name: qsTr("Menu tree")
        anchors.top: moveHint.bottom
        anchors.topMargin: moveHint.visible ? Theme.spaceXs : 0
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        clip: true
        contentWidth: Math.max(width, root.maxRowWidth)
        contentHeight: col.height
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: col

            width: flick.contentWidth

            Repeater {
                model: root.rows

                delegate: Rectangle {
                    id: rowItem

                    required property var modelData
                    required property int index
                    readonly property bool isRenaming: root.renaming && root.renamingPath === rowItem.modelData.path
                    readonly property bool selected: rowItem.modelData.path === root.selectedPath
                    readonly property bool isCut: root.cutPath !== "" && rowItem.modelData.path === root.cutPath
                    readonly property bool actionsShown: !rowItem.isRenaming && (rowHover.hovered || rowItem.selected)
                    // The accessible name for this row and its action buttons;
                    // an unlabelled node still gets a findable name (the
                    // "Unnamed item" fallback).
                    readonly property string accessibleLabel: (rowItem.modelData.label || "") !== "" ? rowItem.modelData.label : qsTr("Unnamed item")

                    width: col.width
                    height: Theme.rowHeight
                    color: rowItem.selected ? Theme.surfaceStrong : (rowHover.hovered ? Theme.surface : "transparent")
                    // The treeitem-role automation surface (name + selection; the
                    // expand state rides the chevron's name below, since the
                    // QML Accessible attached set has no expanded property).
                    Accessible.role: Accessible.TreeItem
                    Accessible.name: rowItem.accessibleLabel
                    Accessible.selected: rowItem.selected
                    // The dragged row dims; the cut row dims less + gets the dashed
                    // outline below ("lifted, waiting to be pasted").
                    opacity: rowItem.index === root.dragRow ? Theme.dragOpacity : (rowItem.isCut ? Theme.cutOpacity : 1)
                    // The roving keyboard focus ring.
                    border.width: root.activeFocus && rowItem.index === root.focusedRow ? Theme.borderWidth : 0
                    border.color: Theme.borderFocus

                    // Whole-row hover. A HoverHandler is passive, so the per-button
                    // MouseAreas don't steal it (a MouseArea-based hover flickered the
                    // row highlight as the cursor crossed the ＋/✎/🗑 buttons).
                    HoverHandler {
                        id: rowHover
                    }

                    // Row click/double-click + drag-to-move. Declared first so the label
                    // Text (no mouse handler) passes clicks through to it, while the
                    // action buttons + the rename input (declared after) sit on top and
                    // take their own. A press that moves past the threshold becomes a
                    // node drag (the root row stays put); preventStealing keeps the
                    // Flickable from turning the drag into a scroll.
                    MouseArea {
                        id: rowMouse

                        property real pressX: 0
                        property real pressY: 0
                        property bool suppressClick: false

                        anchors.fill: parent
                        enabled: !rowItem.isRenaming
                        preventStealing: true
                        onPressed: function(mouse) {
                            pressX = mouse.x;
                            pressY = mouse.y;
                            // A drag that ends over ANOTHER row never emits this
                            // area's `clicked`, so the release alone can't clear
                            // the flag; without this reset the next real click
                            // on this row would be swallowed once.
                            suppressClick = false;
                        }
                        onPositionChanged: function(mouse) {
                            if (!pressed)
                                return ;

                            if (root.dragRow < 0 && !rowItem.modelData.isRoot && !root.renaming && !root.readOnly && Math.abs(mouse.x - pressX) + Math.abs(mouse.y - pressY) > Theme.dragThreshold)
                                root.beginDrag(rowItem.index, rowItem.modelData.path);

                            if (root.dragRow >= 0) {
                                root.updateDrop(rowMouse.mapToItem(col, mouse.x, mouse.y).y);
                                root.updateEdgeScroll(rowMouse.mapToItem(flick, mouse.x, mouse.y).y);
                            }
                        }
                        onReleased: {
                            if (root.dragRow >= 0) {
                                suppressClick = true;
                                root.commitDrop();
                            }
                        }
                        onCanceled: root.endDrag()
                        onClicked: {
                            if (suppressClick) {
                                suppressClick = false;
                                return ;
                            }
                            root.forceActiveFocus();
                            root.focusRow(rowItem.index);
                            root.nodeSelected(rowItem.modelData.path);
                        }
                        onDoubleClicked: {
                            if (!root.readOnly)
                                root.startRename(rowItem.modelData.path);

                        }
                    }

                    // Dashed outline on the node lifted by X (#368). QML rectangles
                    // have no dashed border, so the dashes are painted.
                    Canvas {
                        anchors.fill: parent
                        visible: rowItem.isCut
                        onVisibleChanged: requestPaint()
                        onWidthChanged: requestPaint()
                        onPaint: {
                            const ctx = getContext("2d");
                            ctx.clearRect(0, 0, width, height);
                            if (!rowItem.isCut)
                                return ;

                            ctx.strokeStyle = Theme.accent;
                            ctx.lineWidth = Theme.borderWidth;
                            const dash = Theme.cutDash;
                            const inset = Theme.borderWidth / 2;
                            ctx.beginPath();
                            for (let x = 0; x < width; x += 2 * dash) {
                                ctx.moveTo(x, inset);
                                ctx.lineTo(Math.min(x + dash, width), inset);
                                ctx.moveTo(x, height - inset);
                                ctx.lineTo(Math.min(x + dash, width), height - inset);
                            }
                            for (let y = 0; y < height; y += 2 * dash) {
                                ctx.moveTo(inset, y);
                                ctx.lineTo(inset, Math.min(y + dash, height));
                                ctx.moveTo(width - inset, y);
                                ctx.lineTo(width - inset, Math.min(y + dash, height));
                            }
                            ctx.stroke();
                        }
                    }

                    // The drop-position indicator: a line straddling the insertion gap
                    // above (before) or below (after) the anchor row.
                    Rectangle {
                        visible: rowItem.index === root.dropAnchorRow
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: Theme.dropLineHeight
                        radius: Theme.dropLineHeight / 2
                        color: Theme.accent
                        y: root.dropBelow ? rowItem.height - Theme.dropLineHeight / 2 : -Theme.dropLineHeight / 2
                        z: 2
                    }

                    Text {
                        id: caret

                        anchors.left: parent.left
                        anchors.leftMargin: Theme.spaceMd + rowItem.modelData.depth * Theme.spaceLg
                        anchors.verticalCenter: parent.verticalCenter
                        width: Theme.fontMd
                        // Branch → open/closed caret toggle; the centre is always open
                        // (the top level can't collapse); a leaf has none.
                        text: rowItem.modelData.isBranch ? (rowItem.modelData.isOpen ? "▾" : "▸") : ""
                        color: Theme.textFaint
                        font.pixelSize: Theme.fontSm
                        // The chevron's accessible name ("Expand/Collapse X"),
                        // carrying the open state the row role can't.
                        Accessible.role: Accessible.Button
                        Accessible.name: (rowItem.modelData.isOpen ? qsTr("Collapse %1") : qsTr("Expand %1")).arg(rowItem.accessibleLabel)
                        Accessible.ignored: !rowItem.modelData.isBranch || rowItem.modelData.isRoot === true

                        MouseArea {
                            anchors.fill: parent
                            anchors.margins: -Theme.spaceXs
                            enabled: rowItem.modelData.isBranch && !rowItem.modelData.isRoot
                            cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                            onClicked: root.toggleExpand(rowItem.modelData.path)
                        }

                    }

                    Image {
                        id: rowIcon

                        anchors.left: caret.right
                        anchors.leftMargin: Theme.spaceXs
                        anchors.verticalCenter: parent.verticalCenter
                        visible: rowItem.modelData.icon !== ""
                        source: rowItem.modelData.icon
                        width: Theme.fontLg
                        height: Theme.fontLg
                        sourceSize.width: Theme.fontLg * 2
                        sourceSize.height: Theme.fontLg * 2
                        fillMode: Image.PreserveAspectFit
                    }

                    // Action buttons (right). Shown on hover / when selected; hidden while
                    // renaming. The centre has no delete.
                    Row {
                        id: actions

                        // Follow the label (not the row's right edge): the row stretches
                        // to the widest row, but the buttons stay next to each name.
                        anchors.left: labelText.right
                        anchors.leftMargin: Theme.spaceXs
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 0
                        // Always laid out so the row's content width reserves them
                        // (the tree then scrolls to keep them reachable); revealed
                        // by opacity, and the buttons are disabled while hidden so
                        // their transparent area doesn't swallow a row click.
                        opacity: rowItem.actionsShown ? 1 : 0

                        RowButton {
                            glyph: "＋"
                            // Per-node accessible names for the row actions.
                            accessibleName: rowItem.modelData.isRoot ? qsTr("Add top-level node") : qsTr("Add child to %1").arg(rowItem.accessibleLabel)
                            // No child past the max nesting depth (a leaf there would
                            // also exceed it when it turned into a submenu). The
                            // centre's ＋ adds a top-level node, always allowed.
                            enabled: rowItem.actionsShown && !root.readOnly && (rowItem.modelData.isRoot || rowItem.modelData.depth <= root.maxDepth)
                            onClicked: rowItem.modelData.isRoot ? root.addTopLevelRequested() : root.addChildRequested(rowItem.modelData.path, rowItem.modelData.isBranch)
                        }

                        RowButton {
                            glyph: "✎"
                            accessibleName: qsTr("Rename %1").arg(rowItem.accessibleLabel)
                            enabled: rowItem.actionsShown && !root.readOnly
                            onClicked: root.startRename(rowItem.modelData.path)
                        }

                        RowButton {
                            glyph: "🗑"
                            accessibleName: qsTr("Delete %1").arg(rowItem.accessibleLabel)
                            visible: !rowItem.modelData.isRoot
                            enabled: rowItem.actionsShown && !root.readOnly
                            onClicked: root.deleteRequested(rowItem.modelData.path)
                        }

                    }

                    Text {
                        id: labelText

                        anchors.left: rowIcon.visible ? rowIcon.right : caret.right
                        anchors.leftMargin: Theme.spaceXs
                        anchors.verticalCenter: parent.verticalCenter
                        visible: !rowItem.isRenaming
                        text: rowItem.modelData.label
                        color: Theme.text
                        font.pixelSize: Theme.fontMd
                        // Don't squeeze to the panel: show the full name, only eliding
                        // past a generous cap (~40ch). The row + scroll area grow instead.
                        width: Math.min(implicitWidth, Theme.treeLabelMax)
                        elide: implicitWidth > Theme.treeLabelMax ? Text.ElideRight : Text.ElideNone
                    }

                    Rectangle {
                        anchors.left: rowIcon.visible ? rowIcon.right : caret.right
                        anchors.leftMargin: Theme.spaceXs
                        anchors.verticalCenter: parent.verticalCenter
                        width: Theme.treeLabelMax
                        height: Theme.controlHeight
                        visible: rowItem.isRenaming
                        radius: Theme.radiusSm
                        color: Theme.base

                        TextInput {
                            id: renameInput

                            // Set on Escape so the focus-loss commit that fires when the
                            // input hides can't re-commit the cancelled edit.
                            property bool cancelled: false

                            anchors.fill: parent
                            anchors.margins: Theme.spaceSm
                            color: Theme.text
                            font.pixelSize: Theme.fontMd
                            clip: true

                            TextContextMenu {
                                id: renameMenu
                            }

                            onVisibleChanged: {
                                if (visible) {
                                    cancelled = false;
                                    text = rowItem.modelData.rawLabel;
                                    forceActiveFocus();
                                    selectAll();
                                }
                            }
                            onEditingFinished: {
                                // The native context menu grabs focus while open;
                                // don't treat that as the user finishing the
                                // rename, or it would close before they can use it.
                                if (renameMenu.active)
                                    return;
                                if (!cancelled)
                                    root.renameCommitted(rowItem.modelData.path, text);

                                root.endRename();
                            }
                            Keys.onEscapePressed: {
                                cancelled = true;
                                root.endRename();
                            }
                        }

                    }

                }

            }

        }

    }

    ScrollBar {
        flickable: flick
        orientation: Qt.Vertical
        anchors.right: parent.right
        anchors.top: flick.top
        anchors.bottom: parent.bottom
    }

    ScrollBar {
        flickable: flick
        orientation: Qt.Horizontal
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
    }

}

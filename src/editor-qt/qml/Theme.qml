// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

pragma Singleton

import QtQuick

// The single source of the editor's design tokens (#457).
// EVERY editor component reads its colours, fonts,
// spacings, sizes and radii from here, so the whole editor re-themes by editing
// this ONE file and no change is missed. No component hardcodes a value.
//
// Runtime theme switch (Interface-theme setting): `theme` is the persisted choice
// (system / light / dark / spaceux); the colours below resolve from the matching
// palette, so changing `theme` re-skins the whole editor live. `dark` is the
// Catppuccin Mocha palette; `light` is Catppuccin Latte;
// `spaceux` is the deep-blue / cyan flavour. `system` follows the OS colour
// scheme (dark/light).
//
// The editor UI + the native dialogs use the desktop's system font (no app-wide
// override, so the file picker follows system settings); only the JSON config
// field is monospace, and the pie labels use the bundled Inter (referenced by
// name in ScenePie).
QtObject {
    // ── Theme switch ─────────────────────────────────────────────────────────
    // The persisted choice (Main loads it from GetTheme, the Interface-theme
    // setting writes it). `system` resolves to dark/light from the OS scheme.
    property string theme: "dark"
    readonly property bool osDark: Application.styleHints.colorScheme === Qt.Dark
    readonly property string effective: theme === "system" ? (osDark ? "dark" : "light") : theme
    readonly property var palette: palettes[effective] !== undefined ? palettes[effective] : palettes.dark

    // Each palette carries the same colour roles; only the values differ. Strings
    // here, coerced to `color` by the readonly tokens below.
    readonly property var palettes: ({
            "dark": {
                "base": "#1e1e2e",
                "panel": "#181825",
                "surface": "#313244",
                "surfaceStrong": "#45475a",
                "selected": "#262638",
                "cardHover": "#242435",
                "buttonHover": "#383a4a",
                "borderFocus": "#585b70",
                "text": "#cdd6f4",
                "textMuted": "#9399b2",
                "textFaint": "#6c7086",
                "warn": "#e6af46",
                "success": "#a6e3a1",
                "danger": "#f38ba8",
                "accent": "#89b4fa"
            },
            "light": {
                "base": "#eff1f5",
                "panel": "#e6e9ef",
                "surface": "#ccd0da",
                "surfaceStrong": "#bcc0cc",
                "selected": "#dce0e8",
                "cardHover": "#e4e7ee",
                "buttonHover": "#d9dce3",
                "borderFocus": "#7c7f93",
                "text": "#4c4f69",
                "textMuted": "#6c6f85",
                "textFaint": "#9ca0b0",
                "warn": "#b07800",
                "success": "#40a02b",
                "danger": "#d20f39",
                "accent": "#1e66f5"
            },
            "spaceux": {
                "base": "#070b16",
                "panel": "#0d1424",
                "surface": "#16203a",
                "surfaceStrong": "#1f2d4d",
                "selected": "#102038",
                "cardHover": "#0d1830",
                "buttonHover": "#1a2742",
                "borderFocus": "#2a4a6a",
                "text": "#e2f0ff",
                "textMuted": "#a0bedc",
                "textFaint": "#6c8aa8",
                "warn": "#ffb347",
                "success": "#7dff9a",
                "danger": "#ff6b6b",
                "accent": "#00d4ff"
            }
        })

    // ── Colours (resolved from the active palette) ───────────────────────────
    // Surfaces (back to front).
    readonly property color base: palette.base            // window + input backgrounds
    readonly property color panel: palette.panel          // side panels + dropdown popups
    readonly property color surface: palette.surface      // borders, button idle, option hover
    readonly property color surfaceStrong: palette.surfaceStrong // selection, pressed, strong border
    readonly property color selected: palette.selected // selected option in a dropdown
    readonly property color cardHover: palette.cardHover // hovered grouping cards (distinct from surface, the slider track)
    // Accents on top of surfaces.
    readonly property color buttonHover: palette.buttonHover
    readonly property color borderFocus: palette.borderFocus
    // Text.
    readonly property color text: palette.text
    readonly property color textMuted: palette.textMuted
    readonly property color textFaint: palette.textFaint
    // Status.
    readonly property color warn: palette.warn      // soft conflict marking + warnings
    readonly property color success: palette.success // success toasts + the verified badge
    readonly property color danger: palette.danger  // hard conflict marking + errors
    // Active slider fill / switch on.
    readonly property color accent: palette.accent

    // ── Typography ───────────────────────────────────────────────────────────
    // Monospace family for the editor's monospace surfaces (the JSON config
    // fields, the fixed-width read-outs). User-overridable via the appearance's
    // fontMono setting ('' = the default below); Main binds the override. The
    // rest of the UI uses the system font, so it isn't set here.
    readonly property string fontMonoDefault: "monospace"
    property string fontMono: fontMonoDefault
    readonly property int fontXs: 11   // field labels
    readonly property int fontSm: 12   // captions / code / hints
    readonly property int fontMd: 13   // inputs, options, tree rows
    readonly property int fontLg: 14   // panel heading
    readonly property int fontXl: 16   // status overlay

    // ── Spacing scale ────────────────────────────────────────────────────────
    readonly property int spaceXs: 4
    readonly property int spaceSm: 6
    readonly property int spaceMd: 8
    readonly property int spaceLg: 12
    readonly property int spaceXl: 16

    // ── Sizes ────────────────────────────────────────────────────────────────
    readonly property int controlHeight: 28      // inputs + dropdowns
    readonly property int rowHeight: 26          // dropdown options, buttons, tree rows
    readonly property int radiusSm: 3            // inputs / panels
    readonly property int radius: 4              // buttons
    readonly property int borderWidth: 1
    readonly property int iconSize: 24           // the properties icon preview
    readonly property int panelLeftWidth: 240    // the menu-tree panel (its minimum + initial width)
    readonly property int panelRightWidth: 320   // the properties panel (its minimum + initial width)
    readonly property int splitHandleWidth: 5    // the draggable divider between the panes
    readonly property int popupMaxHeight: 220    // a dropdown's open list before it scrolls
    readonly property int zPopup: 100            // a dropdown's open list, over following content
    readonly property int configMinHeight: 72    // the JSON config field's floor (~3 rows)
    readonly property int windowWidth: 1000      // initial size; >= the 50%-pie minimum so the window opens without a snap-to-minimum
    readonly property int windowHeight: 640
    readonly property int windowSizeSaveDebounceMs: 400 // resize settle before the size persists
    readonly property int undoHistoryLimit: 100          // document undo depth
    readonly property int typeAheadResetMs: 600          // pause that ends a dropdown type-ahead word
    readonly property int sliderTrackHeight: 4   // a slider's groove
    readonly property int sliderHandle: 14       // a slider's draggable knob
    readonly property int toggleWidth: 36        // a toggle switch track
    readonly property int toggleHeight: 20
    readonly property int toggleKnob: 16
    readonly property int scrollBarWidth: 8       // a scrollbar's thickness
    readonly property int scrollBarMinThumb: 24   // a scrollbar thumb's floor
    readonly property int tabBarHeight: 36        // the top tab strip
    readonly property int settingsMaxWidth: 560   // readable column cap on the settings page
    readonly property int dialogWidth: 360        // a modal confirm dialog
    readonly property int treeLabelMax: 320       // a tree label's cap before it elides (~40ch); deep rows scroll, they don't squeeze the name

    // ── Tree drag-reorder + keyboard move (MenuList part B) ──────────────────
    readonly property real dragOpacity: 0.4       // the row being dragged
    readonly property real cutOpacity: 0.6        // the row lifted by X ("waiting to be pasted")
    readonly property int dropLineHeight: 2       // the drop-position indicator line
    readonly property int cutDash: 3              // dash length of the cut row's outline
    readonly property int dragThreshold: 4        // px of motion before a press becomes a drag
    readonly property int dragEdgeZone: 24        // viewport edge band that auto-scrolls during a drag
    readonly property int dragEdgeStep: 6         // px scrolled per tick while in the edge band
    readonly property int dragScrollInterval: 16  // ms between auto-scroll ticks (~60 Hz)

    // ── Unified conflict marking + hover bubbles (C3) ────────────────────────
    readonly property int conflictSlot: 16        // fixed marker slot beside a picker (no row shift)
    readonly property int tooltipMaxWidth: 280    // a hover bubble's width cap before it wraps
    readonly property int navThresholdWidth: 64   // the inline threshold field beside an input picker
    readonly property int sliderValueWidth: 64    // fixed numeric read-out beside a slider (monospace), so a digit-count change can't resize the slider mid-drag
    readonly property real disabledOpacity: 0.4   // a disabled control's dim

    // ── Toasts (C5) ──────────────────────────────────────────────────────────
    readonly property int toastTtlMs: 4000        // success / info auto-dismiss
    readonly property int toastErrorTtlMs: 8000   // errors linger so they're not missed
    readonly property int toastWidth: 360         // a toast's fixed width in the stack
    readonly property int paletteMaxHeight: 260   // the command palette's default list cap (splitter-adjustable)
    readonly property int paletteMinListHeight: 60 // the palette list can't be dragged smaller than this
    readonly property int statusDotSize: 8        // the connected-device status dot
    readonly property int wheelScrollStep: 48     // px per wheel notch in the panel scroll containers
    readonly property int treeMinHeight: 160      // dragging the palette up always leaves the tree this much
    readonly property int themeBootstrapTimeoutMs: 600 // max first-paint wait for the persisted theme (core unreachable -> show anyway)

    // ── Tooltips (C6) ────────────────────────────────────────────────────────
    readonly property int tooltipOpenDelayMs: 150 // settled-hover delay before a bubble opens
    readonly property int tooltipCloseDelayMs: 120 // grace before an open bubble closes (no flicker on brief excursions)
    readonly property int tooltipGap: 8           // gap between the trigger and the bubble
    readonly property int tooltipEdge: 8          // minimum distance to the window edge
}

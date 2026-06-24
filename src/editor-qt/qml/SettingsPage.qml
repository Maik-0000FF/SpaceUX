// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import SpaceUX.Editor

// The Settings tab (#457): app-level
// preferences that aren't part of a single menu. Interface
// theme (this editor window's look), Startup (autostart), Pie fonts (the label
// font), SpaceMouse (grab-while-open). Plugins (PluginManager) is the C5 slice;
// the Desktop tab is C4. A scrollable, width-capped column. The host (Main)
// supplies the values + setters, which talk to the core.
Rectangle {
    id: root

    color: Theme.base

    // Interface theme: the editor window's own theme choice (drives Theme.theme).
    property string themeChoice: "dark"
    property var setTheme: null
    // Startup: launch-on-login.
    property bool autostart: false
    property var setAutostart: null
    // Fonts: the pie label-font override + the editor monospace override,
    // plus the core's font presets.
    property string fontUi: ""
    property string fontMono: ""
    property var fontPresets: null // { systemStack, bundledLabel }
    property var setFontMono: null
    property var setFontUi: null
    // SpaceMouse: grab the device while the pie is open.
    property bool grabWhilePieOpen: false
    property var setGrab: null
    // The plugin manager (C5): the core's list model + the busy flag, with the
    // import/remove flows living in Main.
    property var pluginsModel: null
    property bool pluginBusy: false
    property var importPlugin: null
    property var removePlugin: null

    PanelFlickable {
        id: scroll
        anchors.fill: parent
        anchors.margins: Theme.spaceXl
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: content
            width: Math.min(parent.width, Theme.settingsMaxWidth)
            spacing: Theme.spaceXl

            SettingsSection {
                width: parent.width
                title: qsTr("Interface theme")
                description: qsTr("The look of this editor window.")

                Select {
                    width: parent.width
                    model: [
                        { "value": "system", "label": qsTr("System") },
                        { "value": "light", "label": qsTr("Light") },
                        { "value": "dark", "label": qsTr("Dark") },
                        { "value": "spaceux", "label": qsTr("SpaceUX") }
                    ]
                    value: root.themeChoice
                    onActivated: function (v) {
                        if (root.setTheme)
                            root.setTheme(v);
                    }
                }
            }

            SettingsSection {
                width: parent.width
                title: qsTr("Startup")
                description: qsTr("Launch SpaceUX automatically when you log in, so the pie is ready after a reboot.")

                Toggle {
                    checked: root.autostart
                    label: qsTr("Launch on login")
                    onToggled: function (c) {
                        if (root.setAutostart)
                            root.setAutostart(c);
                    }
                }
            }

            SettingsSection {
                width: parent.width
                title: qsTr("Fonts")
                description: qsTr("The font for the pie labels (live overlay and preview; Bundled ships with the app for an identical look on every system), and the monospace font for the action-config fields.")

                FontControl {
                    width: parent.width
                    label: qsTr("Label font")
                    bundledLabel: root.fontPresets ? root.fontPresets.bundledLabel : ""
                    systemStack: root.fontPresets ? root.fontPresets.systemStack : ""
                    value: root.fontUi
                    commit: function (next) {
                        if (root.setFontUi)
                            root.setFontUi(next);
                    }
                }

                FontControl {
                    width: parent.width
                    label: qsTr("Monospace font")
                    firstPresetLabel: qsTr("Default (%1)").arg(Theme.fontMonoDefault)
                    offerSystem: false
                    value: root.fontMono
                    commit: function (next) {
                        if (root.setFontMono)
                            root.setFontMono(next);
                    }
                }
            }

            SettingsSection {
                width: parent.width
                title: qsTr("SpaceMouse")
                description: qsTr("While the pie is open, grab the SpaceMouse so its movement drives only the pie and not the app underneath (FreeCAD, Blender). Released when the pie closes; committed actions still reach the app.")

                Toggle {
                    checked: root.grabWhilePieOpen
                    label: qsTr("Grab while open")
                    onToggled: function (c) {
                        if (root.setGrab)
                            root.setGrab(c);
                    }
                }
            }

            SettingsSection {
                width: parent.width
                title: qsTr("Plugins")
                description: qsTr("Import downloaded plugin folders and manage what's installed. Imported plugins run with your privileges; review what you enable.")

                PluginsSection {
                    width: parent.width
                    model: root.pluginsModel
                    busy: root.pluginBusy
                    onImportRequested: {
                        if (root.importPlugin)
                            root.importPlugin();
                    }
                    onRemoveRequested: function (kind, id, name) {
                        if (root.removePlugin)
                            root.removePlugin(kind, id, name);
                    }
                }
            }
        }
    }

    ScrollBar {
        flickable: scroll
        orientation: Qt.Vertical
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
    }
}

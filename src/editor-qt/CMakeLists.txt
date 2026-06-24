# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Native Qt6/QML editor (#457): a client of the headless org.spaceux.Core1
# core. Mirrors the overlay's build (src/overlay) but is a plain top-level
# window, not a layer-shell surface, and a D-Bus client rather than a service.
#
# Built only when the parent enables SPACEUX_BUILD_UI. Binary lands next to
# the C daemon + overlay in the top-level build directory.

# Widgets: NativeDialogs uses QFileDialog (a QWidget) for the desktop-native file
# pickers, so the editor links the widgets module + runs a QApplication.
find_package(Qt6 REQUIRED COMPONENTS Quick Qml DBus Gui Svg Widgets)

# Q_OBJECT / QML resources need the Qt code generators.
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

qt_add_executable(spaceux-editor
    main.cpp
    EditorClient.cpp
    EditorClient.h
    NativeDialogs.cpp
    NativeDialogs.h
    NativeTextMenu.cpp
    NativeTextMenu.h
    SingleInstance.cpp
    SingleInstance.h
)

# The process icon (X11 / dev runs). On Wayland the taskbar icon comes from
# the spaceux.desktop entry by app_id instead (#50); same source file as the
# repo-wide app icon, embedded at build time.
qt_add_resources(spaceux-editor "editor-icon"
    PREFIX "/"
    BASE ${CMAKE_SOURCE_DIR}/assets
    FILES ${CMAKE_SOURCE_DIR}/assets/icon.png
)

# QML module: registers the EditorClient C++ type (QML_SINGLETON, as
# `SpaceUX.Editor.EditorClient`) and bundles the QML so the engine resolves
# `import SpaceUX.Editor`. Fixed RESOURCE_PREFIX keeps the qrc path stable
# across Qt versions; registering the type also gives qmllint the type info.
# Link the shared pie-renderer module BEFORE qt_add_qml_module so its qmllint
# setup sees the dependency and resolves `import SpaceUX.Shared` / ScenePie
# (linking it only afterwards leaves qmllint unable to find the type). The
# plugin target also registers the module with the QML engine at runtime.
target_link_libraries(spaceux-editor PRIVATE
    spaceux-shared
    spaceux-sharedplugin
)

# Theme.qml is a QML singleton (the one source of the editor's design tokens);
# pragma Singleton alone isn't enough — the build must tag it so the generated
# qmldir marks it singleton and qmllint resolves Theme.* members.
set_source_files_properties(qml/Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(spaceux-editor
    URI SpaceUX.Editor
    VERSION 1.0
    RESOURCE_PREFIX "/"
    # Declares the dependency on the shared pie renderer so qmllint resolves
    # ScenePie (and the import lands in the generated qmldir).
    IMPORTS SpaceUX.Shared
    QML_FILES
        qml/Theme.qml
        qml/Main.qml
        qml/TextContextMenu.qml
        qml/NodeTree.qml
        qml/paths.js
        qml/PiePreview.qml
        qml/Properties.qml
        qml/Button.qml
        qml/Select.qml
        qml/ActionField.qml
        qml/ConfigEditor.qml
        qml/ActionConfigForm.qml
        qml/Slider.qml
        qml/Toggle.qml
        qml/EyeToggle.qml
        qml/Section.qml
        qml/SliderRow.qml
        qml/Appearance.qml
        qml/ScrollBar.qml
        qml/TabBar.qml
        qml/FontControl.qml
        qml/SettingsSection.qml
        qml/SettingsPage.qml
        qml/RowButton.qml
        qml/ConfirmDialog.qml
        qml/SplitHandle.qml
        qml/ConflictMark.qml
        qml/DualRange.qml
        qml/NavInputRow.qml
        qml/GestureInputList.qml
        qml/MenuSettingsSection.qml
        qml/NavigationSection.qml
        qml/DesktopPage.qml
        qml/HoverHint.qml
        qml/PluginBadge.qml
        qml/ToastStack.qml
        qml/PluginsSection.qml
        qml/SegmentedControl.qml
        qml/PluginSourcePanel.qml
        qml/CommandPalette.qml
        qml/DeviceBar.qml
        qml/PanelFlickable.qml
)

target_link_libraries(spaceux-editor PRIVATE
    Qt6::Quick
    Qt6::Qml
    Qt6::DBus
    Qt6::Gui
    Qt6::Widgets
)

# Reference the static SpaceUX.Shared plugin's initializer so the linker keeps it
# and the QML engine sees the module at runtime (without this the import silently
# resolves to nothing and ScenePie is "not a type").
qt_import_qml_plugins(spaceux-editor)

set_target_properties(spaceux-editor PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
)

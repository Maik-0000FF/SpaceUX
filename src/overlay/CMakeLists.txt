# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Native overlay daemon (#296). A Qt6/QML window is promoted to a
# Wayland layer-shell surface via LayerShellQt so it can be persistent +
# always-on-top, selectively click-through (input region = pie circle),
# focus-free (keyboard-interactivity none), and placed at the cursor.
# These are the four properties a browser-engine window cannot deliver on
# native Wayland (no wl_surface input region, no layer-shell), which is
# why the overlay is a native surface.
#
# Built only when the parent enables SPACEUX_BUILD_UI. Binary lands
# next to the C daemon in the top-level build directory.

find_package(Qt6 REQUIRED COMPONENTS Quick Qml DBus Gui Svg)
find_package(LayerShellQt REQUIRED)
# KWindowEffects::enableBlurBehind drives the frosted-background blur via the
# compositor (org_kde_kwin_blur on KWin). Optional: where the framework is
# present (Arch, modern Ubuntu, KDE) the blur is compiled in; where it isn't
# (e.g. Ubuntu 24.04, which doesn't package KF6 KWindowSystem) the daemon still
# builds and just omits the blur. At runtime the effect is also feature-detected
# (isEffectAvailable), so non-KDE compositors fall back to plain translucency.
find_package(KF6WindowSystem QUIET)

# Q_OBJECT / resources need the Qt code generators. Scope them to this
# subdirectory so the C daemon target above is unaffected.
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

qt_add_executable(spaceux-overlay
    main.cpp
    OverlayController.cpp
    OverlayController.h
)

# QML module: registers the OverlayController C++ type (QML_SINGLETON, as
# `SpaceUX.OverlayController`) and bundles the QML so the engine resolves
# `import SpaceUX`. A fixed RESOURCE_PREFIX keeps the qrc path stable instead
# of the QTP0001 NEW default (qrc:/qt/qml). Registering the type gives qmllint
# the type info it needs to check the QML. The pie
# renderer (PieView + ScenePie) + the Inter font now come from the shared
# SpaceUX.Shared module linked below.
qt_add_qml_module(spaceux-overlay
    URI SpaceUX
    VERSION 1.0
    RESOURCE_PREFIX "/"
    # Declares the dependency on the shared pie renderer so qmllint resolves
    # ScenePie (and the import lands in the generated qmldir).
    IMPORTS SpaceUX.Shared
    QML_FILES qml/Overlay.qml
)

target_link_libraries(spaceux-overlay PRIVATE
    Qt6::Quick
    Qt6::DBus
    Qt6::Gui
    # The shared pie renderer (the SpaceUX.Shared module: PieView + ScenePie + the
    # Inter font). The plugin target registers the module with the QML engine so
    # `import SpaceUX.Shared` resolves; Qt6::Svg comes transitively for PieView.
    spaceux-shared
    spaceux-sharedplugin
    LayerShellQt::Interface
)

# Reference the static SpaceUX.Shared plugin's initializer so the linker keeps it
# and the QML engine sees the module at runtime.
qt_import_qml_plugins(spaceux-overlay)

# Compile the blur path only when KWindowSystem is available; otherwise the
# daemon builds without it and applyBlur() is a no-op (see OverlayController).
if(KF6WindowSystem_FOUND)
    target_link_libraries(spaceux-overlay PRIVATE KF6::WindowSystem)
    target_compile_definitions(spaceux-overlay PRIVATE SPACEUX_HAVE_KWINDOWSYSTEM)
    message(STATUS "spaceux-overlay: KWindowSystem found, frosted-background blur enabled")
else()
    message(STATUS "spaceux-overlay: KWindowSystem not found, frosted-background blur disabled")
endif()

set_target_properties(spaceux-overlay PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}
)

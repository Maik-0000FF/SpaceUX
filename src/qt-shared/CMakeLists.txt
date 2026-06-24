# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Shared Qt code for the overlay + editor as one QML module, SpaceUX.Shared, that
# both link and `import`. It carries the pie renderer so there is a SINGLE source
# for it instead of a copy in each binary (#344): the PieView paint item
# (QSvgRenderer) and ScenePie.qml (the SVG + the menu labels on top), plus the
# Inter face the labels use. Built (from the top CMakeLists) whenever the overlay
# or the editor is enabled.

find_package(Qt6 REQUIRED COMPONENTS Quick Qml Svg)

# Q_OBJECT / QML resources need the Qt code generators.
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

qt_add_library(spaceux-shared STATIC)

# Registers PieView (QML_ELEMENT) + ScenePie.qml under `import SpaceUX.Shared`.
# A fixed RESOURCE_PREFIX keeps the qrc path stable instead of the QTP0001 NEW
# default (qrc:/qt/qml). The module's qmldir lands at qrc:/SpaceUX/Shared, off the
# engine's default import root, so each consumer adds qrc:/ to its import path
# (see the editor + overlay main.cpp).
qt_add_qml_module(spaceux-shared
    URI SpaceUX.Shared
    VERSION 1.0
    RESOURCE_PREFIX "/"
    SOURCES
        PieView.cpp
        PieView.h
    QML_FILES
        ScenePie.qml
)

# The Inter SemiBold face the pie labels use: the upstream rsms/inter static
# Inter-SemiBold.ttf (OFL-1.1, weight 600, full coverage). A static face is
# deliberate (Qt renders the variable face at weight 400 regardless). Bundled
# here so both consumers get it; each main.cpp registers ":/fonts/..." with
# QFontDatabase::addApplicationFont. Licence: LICENSES/OFL-1.1.txt + REUSE.toml.
qt_add_resources(spaceux-shared "shared-fonts"
    PREFIX "/"
    FILES fonts/Inter-SemiBold.ttf
)

# Qt6::Svg supplies QSvgRenderer (PieView); Quick for the QML item types.
target_link_libraries(spaceux-shared PUBLIC
    Qt6::Quick
    Qt6::Svg
)

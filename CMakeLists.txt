# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Top-level CMake build for the SpaceUX daemon.
#
# Why CMake rather than the smaller Makefile: the daemon is intended
# to grow Windows and macOS backends, and CMake handles cross-platform
# source selection plus toolchain detection without per-OS hacks. The
# TypeScript half of the project (the core) builds with tsc — this
# file does not touch it.
#
# Build:
#   cmake -S . -B build/daemon
#   cmake --build build/daemon
# Result: build/daemon/spaceux-daemon

cmake_minimum_required(VERSION 3.16)
project(spaceux-daemon
    VERSION 0.0.1
    DESCRIPTION "SpaceUX input daemon"
    LANGUAGES C
)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON) # Needed for _GNU_SOURCE features (accept4 etc.)

# Shared compiler hygiene. -Werror is enabled in CI via EXTRA_CFLAGS
# so a local dev build still completes when a new compiler version
# introduces a warning we haven't fixed yet.
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang|AppleClang")
    add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Default build type — Release for distribution, Debug for development.
# Honours an externally set CMAKE_BUILD_TYPE.
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# Platform-neutral sources: every backend reuses these.
set(DAEMON_SOURCES
    src/daemon/daemon.c
    src/daemon/protocol.c
    src/daemon/socket.c
)

# IPC transport. UNIX sockets cover Linux and macOS — both reuse
# ipc_unix.c with internal #ifdef splits for accept4 vs accept+fcntl.
# Windows will get its own ipc_namedpipe.c when the port lands.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux" OR CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    list(APPEND DAEMON_SOURCES src/daemon/ipc_unix.c)
endif()

# Per-host backend sources. Each list intentionally fails the
# configure step if the host has no implementation yet — better than
# silently producing a daemon that builds but does nothing.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    list(APPEND DAEMON_SOURCES
        src/daemon/input_linux.c
        src/daemon/inject_linux.c
        src/daemon/led_linux.c
        src/daemon/platform_linux.c
    )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    message(FATAL_ERROR
        "macOS backend not yet implemented. "
        "Expected: src/daemon/input_macos.c + src/daemon/platform_macos.c. "
        "The IPC layer (ipc_unix.c) is already wired up for Darwin."
    )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows")
    message(FATAL_ERROR
        "Windows backend not yet implemented. "
        "Expected: src/daemon/input_windows.c + src/daemon/platform_windows.c "
        "+ src/daemon/ipc_namedpipe.c."
    )
else()
    message(FATAL_ERROR
        "Unsupported host '${CMAKE_SYSTEM_NAME}'. "
        "Add a src/daemon/input_<os>.c + src/daemon/platform_<os>.c pair "
        "(and an ipc_<transport>.c if UNIX sockets are not a fit) "
        "and extend the dispatch in CMakeLists.txt."
    )
endif()

add_executable(spaceux-daemon ${DAEMON_SOURCES})
target_include_directories(spaceux-daemon PRIVATE src/daemon)

# Install into the repo's build tree only — Phase 4 of the roadmap
# adds a proper system-level install target (XDG paths + systemd unit).
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

# The native Qt6/QML UI: the Wayland layer-shell pie overlay (#296), the
# editor client (#457) and their shared pie renderer (the SpaceUX.Shared
# module: PieView + ScenePie). One switch because they ship together as the
# product's UI; off by default so the C-only daemon build and CI stay
# untouched. Opt in with -DSPACEUX_BUILD_UI=ON on a host that has Qt6 +
# LayerShellQt.
option(SPACEUX_BUILD_UI "Build the Qt6/QML UI (overlay daemon + editor)" OFF)

if(SPACEUX_BUILD_UI)
    enable_language(CXX)
    set(CMAKE_CXX_STANDARD 17)
    set(CMAKE_CXX_STANDARD_REQUIRED ON)
    # Resolve Qt up front so the QML-module policy below is in scope for every
    # subdirectory module; each module still finds the components it needs. Qml
    # is what registers the QTP0004 policy (QT_KNOWN_POLICY_QTP0004).
    find_package(Qt6 REQUIRED COMPONENTS Qml)
    # NEW makes Qt generate a qmldir per subdirectory for modules whose QML
    # lives in a qml/ subfolder (here the overlay and editor); it is Qt's
    # recommended behaviour and silences the Qt 6.8 dev-warning that otherwise
    # asks us to choose. Set at top scope so it reaches every UI module; guarded
    # so a Qt that predates the policy is simply skipped (baseline is Qt 6.8+).
    if(QT_KNOWN_POLICY_QTP0004)
        qt_policy(SET QTP0004 NEW)
    endif()
    # One QML output root for every module (SpaceUX, SpaceUX.Editor,
    # SpaceUX.Shared) so they share a single import path; that is how a consumer's
    # qmllint resolves a sibling module (the editor importing SpaceUX.Shared).
    set(QT_QML_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/qml)
    add_subdirectory(src/qt-shared)
    add_subdirectory(src/overlay)
    add_subdirectory(src/editor-qt)
endif()

# C unit tests for the daemon, run via ctest. Off by default so the regular
# daemon build, the installer and the daemon CI lane stay untouched (same
# opt-in idiom as SPACEUX_BUILD_UI above). Enable with -DSPACEUX_BUILD_TESTS=ON
# and run `ctest --test-dir <build>`. Each test executable links only the
# translation unit under test (protocol.c is self-contained: it pulls in no
# backend code, just libc and the struct definition in input.h), so the tests
# never drag in the Linux input/inject backends.
option(SPACEUX_BUILD_TESTS "Build the C unit tests (ctest)" OFF)

if(SPACEUX_BUILD_TESTS)
    enable_testing()
    add_executable(spaceux-daemon-tests
        tests/daemon/parse_command.c
        src/daemon/protocol.c
    )
    target_include_directories(spaceux-daemon-tests PRIVATE src/daemon tests/daemon)
    add_test(NAME daemon-parser COMMAND spaceux-daemon-tests)
endif()

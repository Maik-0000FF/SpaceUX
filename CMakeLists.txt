# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Top-level CMake build for the SpaceUX daemon.
#
# Why CMake rather than the smaller Makefile: the daemon is intended
# to grow Windows and macOS backends, and CMake handles cross-platform
# source selection plus toolchain detection without per-OS hacks. The
# TypeScript / Electron half of the project stays on Vite + tsc — this
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

# Per-host backend sources. Each list intentionally fails the
# configure step if the host has no implementation yet — better than
# silently producing a daemon that builds but does nothing.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    list(APPEND DAEMON_SOURCES
        src/daemon/input_linux.c
        src/daemon/platform_linux.c
    )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    message(FATAL_ERROR
        "macOS backend not yet implemented. "
        "Expected: src/daemon/input_macos.c + src/daemon/platform_macos.c"
    )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows")
    message(FATAL_ERROR
        "Windows backend not yet implemented. "
        "Expected: src/daemon/input_windows.c + src/daemon/platform_windows.c"
    )
else()
    message(FATAL_ERROR
        "Unsupported host '${CMAKE_SYSTEM_NAME}'. "
        "Add a src/daemon/input_<os>.c + src/daemon/platform_<os>.c pair "
        "and extend the dispatch in CMakeLists.txt."
    )
endif()

add_executable(spaceux-daemon ${DAEMON_SOURCES})
target_include_directories(spaceux-daemon PRIVATE src/daemon)

# Install into the repo's build tree only — Phase 4 of the roadmap
# adds a proper system-level install target (XDG paths + systemd unit).
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

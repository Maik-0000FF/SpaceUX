/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * platform - host-specific helpers the daemon needs but doesn't want
 * to write inline.
 *
 * Today the only callable is platform_socket_path() — every host has
 * a different idea of where an IPC endpoint should live:
 *
 *   Linux   → /run/user/<uid>/spaceux.sock          (systemd convention)
 *   macOS   → $TMPDIR/spaceux-<uid>.sock            (per-user tmp)
 *   Windows → \\.\pipe\spaceux-<username>           (named pipe, planned)
 *
 * Backends live in platform_<os>.c. Picking which file the build
 * compiles is the CMake's job; the daemon source never #ifdef's on
 * the host.
 */
#ifndef SPACEUX_PLATFORM_H
#define SPACEUX_PLATFORM_H

#include <stddef.h>

/* Write the canonical IPC endpoint path for the calling user into
 * *buf*. Returns the number of bytes written (excluding the NUL), or
 * -1 if the buffer is too small. Implementations must:
 *   - choose a path under a per-user directory (so a second user on
 *     the same machine gets their own socket)
 *   - prefer a runtime directory that goes away on logout where the
 *     platform has one ($XDG_RUNTIME_DIR / $TMPDIR / etc.)
 * The path is the same one the SpaceUX core client will look
 * for, so its mirror in src/main/daemon-client.ts must stay in sync. */
int platform_socket_path(char *buf, size_t buf_size);

#endif /* SPACEUX_PLATFORM_H */

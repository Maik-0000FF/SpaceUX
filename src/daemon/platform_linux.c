/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * platform_linux - Linux backend for platform.h.
 *
 * Picks the IPC endpoint under /run/user/<uid>/ which systemd creates
 * per session and tears down on logout — exactly the semantics we
 * want for a UI daemon. $XDG_RUNTIME_DIR is the same path expressed
 * portably; we honour it when set so containerised or unusual
 * sessions don't break.
 */
#define _GNU_SOURCE
#include "platform.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "config.h"

int platform_socket_path(char *buf, size_t buf_size)
{
	if (!buf || buf_size == 0)
		return -1;

	const char *runtime_dir = getenv("XDG_RUNTIME_DIR");
	if (runtime_dir && runtime_dir[0] == '/') {
		int n = snprintf(buf, buf_size, "%s/%s", runtime_dir, SPACEUX_SOCK_BASENAME);
		if (n < 0 || (size_t)n >= buf_size)
			return -1;
		return n;
	}

	/* Fallback: build the path manually from getuid(). On systemd
	 * machines this matches what $XDG_RUNTIME_DIR would have been. */
	uid_t uid = getuid();
	int n = snprintf(buf, buf_size, "/run/user/%u/%s", (unsigned)uid, SPACEUX_SOCK_BASENAME);
	if (n < 0 || (size_t)n >= buf_size)
		return -1;
	return n;
}

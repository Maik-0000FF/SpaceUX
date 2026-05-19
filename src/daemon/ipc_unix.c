/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ipc_unix - UNIX-socket implementation of ipc.h.
 *
 * Covers Linux and macOS. The Linux path uses accept4() with
 * SOCK_NONBLOCK | SOCK_CLOEXEC as a single syscall; macOS doesn't
 * ship accept4(), so we fall back to plain accept() + two fcntl()s.
 * The choice is local to this file — daemon.c and socket.c never
 * #ifdef on the host.
 */
#define _GNU_SOURCE
#include "ipc.h"
#include "platform.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>

/* Linux exposes SOCK_NONBLOCK / SOCK_CLOEXEC as socket() type flags
 * and ships accept4(); macOS does not. Pick the cheap one-syscall
 * path when available, fall back to fcntl() otherwise. */
#if defined(__linux__)
#define HAVE_SOCK_NONBLOCK_CLOEXEC 1
#define HAVE_ACCEPT4 1
#else
#define HAVE_SOCK_NONBLOCK_CLOEXEC 0
#define HAVE_ACCEPT4 0
#endif

/* Set O_NONBLOCK and FD_CLOEXEC on a freshly-created socket fd.
 * Used on platforms that can't ask socket()/accept() to do it
 * atomically. Only compiled when at least one caller actually
 * reaches it — on Linux both ipc_listener_open and ipc_accept take
 * the SOCK_NONBLOCK / accept4 fast paths, so the function would be
 * dead code and -Werror would fire on the unused-function warning. */
#if !defined(__linux__)
static int make_nonblock_cloexec(int fd)
{
	int flags = fcntl(fd, F_GETFL, 0);
	if (flags < 0)
		return -1;
	if (fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0)
		return -1;
	int fdflags = fcntl(fd, F_GETFD, 0);
	if (fdflags < 0)
		return -1;
	if (fcntl(fd, F_SETFD, fdflags | FD_CLOEXEC) < 0)
		return -1;
	return 0;
}
#endif

int ipc_listener_open(struct ipc_listener *l)
{
	memset(l, 0, sizeof(*l));
	l->fd = -1;

	if (platform_socket_path(l->path, sizeof(l->path)) < 0)
		return -1;
	unlink(l->path); /* stale endpoint from a previous run */

#if HAVE_SOCK_NONBLOCK_CLOEXEC
	int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
#else
	int fd = socket(AF_UNIX, SOCK_STREAM, 0);
	if (fd >= 0 && make_nonblock_cloexec(fd) < 0) {
		close(fd);
		fd = -1;
	}
#endif
	if (fd < 0)
		return -1;

	struct sockaddr_un addr;
	memset(&addr, 0, sizeof(addr));
	addr.sun_family = AF_UNIX;
	snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", l->path);

	if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
		close(fd);
		return -1;
	}
	/* Backlog matches the daemon's MAX_CLIENTS so a slot-storm at
	 * startup doesn't drop connections inside the kernel before we
	 * see them. */
	if (listen(fd, 8) < 0) {
		close(fd);
		unlink(l->path);
		return -1;
	}
	l->fd = fd;
	return 0;
}

void ipc_listener_close(struct ipc_listener *l)
{
	if (!l)
		return;
	if (l->fd >= 0) {
		close(l->fd);
		l->fd = -1;
	}
	if (l->path[0])
		unlink(l->path);
}

int ipc_accept(struct ipc_listener *l)
{
#if HAVE_ACCEPT4
	return accept4(l->fd, NULL, NULL, SOCK_NONBLOCK | SOCK_CLOEXEC);
#else
	int fd = accept(l->fd, NULL, NULL);
	if (fd < 0)
		return -1;
	if (make_nonblock_cloexec(fd) < 0) {
		close(fd);
		return -1;
	}
	return fd;
#endif
}

ssize_t ipc_read(int fd, char *buf, size_t max)
{
	return read(fd, buf, max);
}

/* Same contract as the old socket.c write_full(): len = full,
 * 0 = first-byte EAGAIN (caller may drop one event and keep the
 * slot), -1 = fatal. See ipc.h for the full rationale. */
int ipc_write(int fd, const char *buf, int len)
{
	int off = 0;
	while (off < len) {
		ssize_t n = write(fd, buf + off, len - off);
		if (n < 0) {
			if (errno == EINTR)
				continue;
			if (errno == EAGAIN || errno == EWOULDBLOCK) {
				if (off == 0)
					return 0;
				return -1;
			}
			return -1;
		}
		if (n == 0)
			return -1;
		off += n;
	}
	return len;
}

void ipc_close(int fd)
{
	if (fd >= 0)
		close(fd);
}

/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * socket - implementation. See socket.h.
 */
#define _GNU_SOURCE
#include "socket.h"
#include "platform.h"
#include "protocol.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>

static void slot_clear(struct sock_client *c)
{
	if (c->fd >= 0)
		close(c->fd);
	c->fd = -1;
	c->subscriptions = 0;
	c->grabbed = 0;
	c->cmd_len = 0;
}

static int slot_alloc(struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		if (s->clients[i].fd < 0)
			return i;
	return -1;
}

/* Write the full payload to a non-blocking socket.
 *
 * Return contract:
 *   len  — every byte landed in the kernel buffer
 *    0   — nothing was written because the socket would block on
 *          the first byte; the caller may safely drop this single
 *          event and keep the client connected
 *   -1   — fatal: a partial write hit EAGAIN (the client would now
 *          see a half-line followed by the next event, which the
 *          JSON-Lines parser cannot recover from), or any other
 *          write error / EOF. The caller must close the slot.
 *
 * Treating "first-byte EAGAIN" as recoverable lets a briefly stalled
 * renderer (post-suspend, garbage-collection pause, ...) survive a
 * single skipped axes frame instead of being disconnected and
 * reconnected — full backpressure would need a per-client outbound
 * queue, which is a Phase 3 follow-up. */
static int write_full(int fd, const char *buf, int len)
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

int sock_init(struct sock_state *s)
{
	memset(s, 0, sizeof(*s));
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		s->clients[i].fd = -1;

	if (platform_socket_path(s->path, sizeof(s->path)) < 0)
		return -1;
	unlink(s->path); /* stale socket from a previous run */

	s->listen_fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
	if (s->listen_fd < 0)
		return -1;

	struct sockaddr_un addr;
	memset(&addr, 0, sizeof(addr));
	addr.sun_family = AF_UNIX;
	snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", s->path);

	if (bind(s->listen_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
		close(s->listen_fd);
		s->listen_fd = -1;
		return -1;
	}
	if (listen(s->listen_fd, SPACEUX_MAX_CLIENTS) < 0) {
		close(s->listen_fd);
		unlink(s->path);
		s->listen_fd = -1;
		return -1;
	}
	return 0;
}

void sock_close(struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		slot_clear(&s->clients[i]);
	if (s->listen_fd >= 0) {
		close(s->listen_fd);
		s->listen_fd = -1;
	}
	if (s->path[0])
		unlink(s->path);
}

int sock_accept(struct sock_state *s)
{
	int fd = accept4(s->listen_fd, NULL, NULL, SOCK_NONBLOCK | SOCK_CLOEXEC);
	if (fd < 0)
		return -1;
	int slot = slot_alloc(s);
	if (slot < 0) {
		close(fd);
		return -1;
	}
	struct sock_client *c = &s->clients[slot];
	c->fd = fd;
	c->subscriptions = 0;
	c->grabbed = 0;
	c->cmd_len = 0;
	char hello[SPACEUX_EVENT_BUF_SIZE];
	int hlen = protocol_format_hello(hello, sizeof(hello), SPACEUX_AXIS_COUNT,
					 SPACEUX_MAX_BUTTONS);
	if (hlen > 0)
		(void)write_full(fd, hello, hlen);
	return slot;
}

/* Apply a parsed command to one client's state. Some commands
 * have side effects (PING replies with PONG); the side effect
 * is co-located with the state change for readability. */
static int apply_cmd(struct sock_client *c, enum protocol_cmd cmd)
{
	switch (cmd) {
	case PROTO_CMD_SUBSCRIBE_AXES:
		c->subscriptions |= PROTO_SUB_AXES;
		return 0;
	case PROTO_CMD_SUBSCRIBE_BUTTONS:
		c->subscriptions |= PROTO_SUB_BUTTONS;
		return 0;
	case PROTO_CMD_SUBSCRIBE_BOTH:
		c->subscriptions |= PROTO_SUB_AXES | PROTO_SUB_BUTTONS;
		return 0;
	case PROTO_CMD_UNSUBSCRIBE:
		c->subscriptions = 0;
		return 0;
	case PROTO_CMD_GRAB:
		c->grabbed = 1;
		return 0;
	case PROTO_CMD_RELEASE:
		c->grabbed = 0;
		return 0;
	case PROTO_CMD_PING:
		return write_full(c->fd, "PONG\n", 5);
	case PROTO_CMD_UNKNOWN:
	default:
		return 0;
	}
}

int sock_handle_client(struct sock_state *s, int slot)
{
	struct sock_client *c = &s->clients[slot];
	if (c->fd < 0)
		return -1;
	for (;;) {
		ssize_t n = read(c->fd, c->cmd_buf + c->cmd_len,
				 (int)sizeof(c->cmd_buf) - c->cmd_len - 1);
		if (n == 0) {
			slot_clear(c);
			return -1;
		}
		if (n < 0) {
			if (errno == EAGAIN || errno == EWOULDBLOCK)
				return 0;
			slot_clear(c);
			return -1;
		}
		c->cmd_len += (int)n;
		c->cmd_buf[c->cmd_len] = '\0';
		/* Process every complete line we have. Anything after the
		 * last newline stays buffered for the next read. */
		for (;;) {
			char *nl = memchr(c->cmd_buf, '\n', c->cmd_len);
			if (!nl)
				break;
			*nl = '\0';
			enum protocol_cmd parsed = protocol_parse_command(c->cmd_buf);
			if (apply_cmd(c, parsed) < 0) {
				slot_clear(c);
				return -1;
			}
			int consumed = (int)(nl - c->cmd_buf) + 1;
			int remaining = c->cmd_len - consumed;
			memmove(c->cmd_buf, c->cmd_buf + consumed, remaining);
			c->cmd_len = remaining;
			c->cmd_buf[c->cmd_len] = '\0';
		}
	}
}

void sock_broadcast_axes(struct sock_state *s, const int *values, int n_values)
{
	char buf[SPACEUX_EVENT_BUF_SIZE];
	int len = protocol_format_axes(buf, sizeof(buf), values, n_values);
	if (len <= 0)
		return;
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++) {
		struct sock_client *c = &s->clients[i];
		if (c->fd < 0 || !(c->subscriptions & PROTO_SUB_AXES))
			continue;
		if (write_full(c->fd, buf, len) < 0)
			slot_clear(c);
	}
}

void sock_broadcast_button(struct sock_state *s, int bnum, int pressed)
{
	char buf[SPACEUX_EVENT_BUF_SIZE];
	int len = protocol_format_button(buf, sizeof(buf), bnum, pressed);
	if (len <= 0)
		return;
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++) {
		struct sock_client *c = &s->clients[i];
		if (c->fd < 0 || !(c->subscriptions & PROTO_SUB_BUTTONS))
			continue;
		if (write_full(c->fd, buf, len) < 0)
			slot_clear(c);
	}
}

int sock_any_grabbed(const struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		if (s->clients[i].fd >= 0 && s->clients[i].grabbed)
			return 1;
	return 0;
}

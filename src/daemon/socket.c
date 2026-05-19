/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * socket - implementation. See socket.h.
 *
 * Every wire-side primitive is routed through ipc.h so the transport
 * (UNIX socket today) can be swapped without touching this file.
 */
#include "socket.h"
#include "inject.h"
#include "ipc.h"
#include "protocol.h"

#include <errno.h>
#include <string.h>

static void slot_clear(struct sock_client *c)
{
	if (c->fd >= 0)
		ipc_close(c->fd);
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

int sock_init(struct sock_state *s)
{
	memset(s, 0, sizeof(*s));
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		s->clients[i].fd = -1;
	s->inject_fd = -1;
	return ipc_listener_open(&s->listener);
}

void sock_set_inject_fd(struct sock_state *s, int fd)
{
	s->inject_fd = fd;
}

void sock_close(struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		slot_clear(&s->clients[i]);
	ipc_listener_close(&s->listener);
}

int sock_accept(struct sock_state *s)
{
	int fd = ipc_accept(&s->listener);
	if (fd < 0)
		return -1;
	int slot = slot_alloc(s);
	if (slot < 0) {
		ipc_close(fd);
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
		(void)ipc_write(fd, hello, hlen);
	return slot;
}

/* Apply a parsed command to one client's state. Some commands
 * have side effects (PING replies with PONG, INJECT_CHORD emits
 * keys via the daemon-owned inject fd); the side effect is
 * co-located with the state change for readability. */
static int apply_cmd(struct sock_state *s, struct sock_client *c, enum protocol_cmd cmd,
		     const struct protocol_chord *chord)
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
		return ipc_write(c->fd, "PONG\n", 5) < 0 ? -1 : 0;
	case PROTO_CMD_INJECT_CHORD:
		/* inject_chord is a no-op when inject_fd is -1, so the
		 * command parses + dispatches successfully even on hosts
		 * where /dev/uinput was unavailable at startup. The
		 * client side learns about the capability from the hello
		 * event's "inject" flag. */
		inject_chord(s->inject_fd, chord->mods, chord->n_mods, chord->key);
		return 0;
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
		ssize_t n = ipc_read(c->fd, c->cmd_buf + c->cmd_len,
				     (size_t)((int)sizeof(c->cmd_buf) - c->cmd_len - 1));
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
			struct protocol_chord chord;
			enum protocol_cmd parsed = protocol_parse_command(c->cmd_buf, &chord);
			if (apply_cmd(s, c, parsed, &chord) < 0) {
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
		if (ipc_write(c->fd, buf, len) < 0)
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
		if (ipc_write(c->fd, buf, len) < 0)
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

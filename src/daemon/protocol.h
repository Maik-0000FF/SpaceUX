/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * protocol - line-based command parser + JSON-Lines event emitter.
 *
 * Inbound (client → daemon) commands are ASCII tokens, one per line.
 * The daemon side never accepts JSON: commands are short and the
 * parser stays trivial. Recognised commands:
 *
 *   SUBSCRIBE axes        — start streaming axes events
 *   SUBSCRIBE buttons     — start streaming button events
 *   SUBSCRIBE axes,buttons — both at once
 *   UNSUBSCRIBE           — stop streaming, keep the connection
 *   GRAB                  — exclusive: while held, the daemon's
 *                            normal action dispatch is suspended
 *   RELEASE               — drop the grab
 *   PING                  — heartbeat, replies with "PONG\n"
 *
 * Outbound (daemon → client) events are one JSON object per line:
 *
 *   {"event":"axes","values":[tx,ty,tz,rx,ry,rz]}
 *   {"event":"button","bnum":N,"pressed":true|false}
 *   {"event":"hello","axes":N,"buttons":N}   — sent on connect
 *
 * No JSON parsing on the daemon side; the emitter writes bytes
 * directly so we don't depend on json-c.
 */
#ifndef SPACEUX_PROTOCOL_H
#define SPACEUX_PROTOCOL_H

#include "config.h"

/* Per-client subscription state. The daemon multiplexes input over
 * every connected client; each client decides which event types it
 * wants. Bit-flag style keeps the test cheap on the hot emit path. */
enum protocol_subscribe_flags {
	PROTO_SUB_AXES = 1 << 0,
	PROTO_SUB_BUTTONS = 1 << 1,
};

/* Parse one command line (without trailing newline). Returns the
 * action taken; the caller is responsible for state updates and
 * for emitting any reply. Unknown commands return PROTO_CMD_UNKNOWN
 * so the caller can log + ignore rather than crash. */
enum protocol_cmd {
	PROTO_CMD_UNKNOWN = 0,
	PROTO_CMD_SUBSCRIBE_AXES,
	PROTO_CMD_SUBSCRIBE_BUTTONS,
	PROTO_CMD_SUBSCRIBE_BOTH,
	PROTO_CMD_UNSUBSCRIBE,
	PROTO_CMD_GRAB,
	PROTO_CMD_RELEASE,
	PROTO_CMD_PING,
};

enum protocol_cmd protocol_parse_command(const char *line);

/* Format an axes snapshot into *buf. Returns bytes written
 * (excluding the trailing NUL), or -1 if the buffer is too small.
 * The buffer must be at least SPACEUX_EVENT_BUF_SIZE. */
int protocol_format_axes(char *buf, int buf_size, const int *values, int n_values);

/* Format a single button transition into *buf. Same return contract. */
int protocol_format_button(char *buf, int buf_size, int bnum, int pressed);

/* Format the welcome hello message sent on connect. */
int protocol_format_hello(char *buf, int buf_size, int axes_count, int max_buttons);

#endif /* SPACEUX_PROTOCOL_H */

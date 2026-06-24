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
 *   GRAB                  — exclusive: while any client holds it, the
 *                            daemon EVIOCGRABs the puck so no other
 *                            reader (spacenavd, FreeCAD) sees its
 *                            events (#327)
 *   RELEASE               — drop the grab
 *   PING                  — heartbeat, replies with "PONG\n"
 *
 * Outbound (daemon → client) events are one JSON object per line:
 *
 *   {"event":"axes","values":[tx,ty,tz,rx,ry,rz]}
 *   {"event":"button","bnum":N,"pressed":true|false}
 *   {"event":"hello","axes":N,"buttons":N,"vendor":V,"product":P,"name":"..."}
 *                                            — sent on connect
 *   {"event":"device","buttons":N,"vendor":V,"product":P,"name":"..."}
 *                                            — sent when the device changes
 *
 * No JSON parsing on the daemon side; the emitter writes bytes
 * directly so we don't depend on json-c.
 */
#ifndef SPACEUX_PROTOCOL_H
#define SPACEUX_PROTOCOL_H

#include "config.h"

/* Device identity carried in the hello + device events. Defined in
 * input.h; only used here through a pointer, so a forward declaration
 * keeps the wire-format layer from depending on the input backend. */
struct input_device_info;

/* Per-client subscription state. The daemon multiplexes input over
 * every connected client; each client decides which event types it
 * wants. Bit-flag style keeps the test cheap on the hot emit path. */
enum protocol_subscribe_flags {
	PROTO_SUB_AXES = 1 << 0,
	PROTO_SUB_BUTTONS = 1 << 1,
};

/* Upper bound on modifiers per chord. Four real modifier keys exist
 * on a typical keyboard (Ctrl, Alt, Shift, Super); 8 leaves room for
 * exotic combos (e.g. AltGr, Hyper) without forcing the daemon to
 * heap-allocate. */
#define SPACEUX_MAX_CHORD_MODS 8

/* Upper sanity bound on any numeric value parsed off the wire: chord key
 * codes (1..MAX) and scroll deltas (-MAX..MAX). 0x7fff is the signed
 * 16-bit ceiling, deliberately wider than KEY_MAX and any plausible
 * single-frame scroll delta, so a malformed or hostile line is rejected
 * before the value could overflow downstream int math. Both parsers and
 * their tests consume this one definition. */
#define SPACEUX_WIRE_VALUE_MAX 0x7fff

/* Parsed payload for PROTO_CMD_INJECT_CHORD. The wire form is
 * "INJECT_CHORD <c1> <c2> ... <cN>": codes 1..N-1 are modifiers held
 * during the chord, code N is the key tapped. With N=1 the chord is
 * a bare key tap with no modifiers. The numeric codes are Linux
 * keycodes from <linux/input-event-codes.h>; the renderer's
 * parseChord() already produces them, so no translation in flight. */
struct protocol_chord {
	int mods[SPACEUX_MAX_CHORD_MODS];
	int n_mods;
	int key;
	/* Capability token echoed by the client. The wire form is
	 * "INJECT_CHORD <token> <c1> ... <cN>"; the parser writes the
	 * first whitespace-delimited word here for the caller to
	 * compare against `sock_client.auth_token`. Empty string when
	 * the wire line didn't include a token at all (older client).
	 * Length cap matches SPACEUX_TOKEN_HEX_LEN. */
	char auth_token[SPACEUX_TOKEN_HEX_LEN];
};

/* Parsed payload for PROTO_CMD_INJECT_SCROLL. The wire form is
 * "INJECT_SCROLL <token> <dx> <dy>": a capability token (same scheme as
 * the chord) followed by two signed high-resolution wheel deltas (120
 * units per traditional notch). `dx` is horizontal, `dy` vertical. Used
 * by desktop mode for analog scrolling (#199). */
struct protocol_scroll {
	int dx;
	int dy;
	char auth_token[SPACEUX_TOKEN_HEX_LEN];
};

/* Parse one command line (without trailing newline). Returns the
 * action taken; the caller is responsible for state updates and
 * for emitting any reply. Unknown commands return PROTO_CMD_UNKNOWN
 * so the caller can log + ignore rather than crash.
 *
 * The `chord` out-param is filled in only when the returned command
 * is PROTO_CMD_INJECT_CHORD; for every other command its contents
 * are unspecified and the caller must not read them. */
enum protocol_cmd {
	PROTO_CMD_UNKNOWN = 0,
	PROTO_CMD_SUBSCRIBE_AXES,
	PROTO_CMD_SUBSCRIBE_BUTTONS,
	PROTO_CMD_SUBSCRIBE_BOTH,
	PROTO_CMD_UNSUBSCRIBE,
	PROTO_CMD_GRAB,
	PROTO_CMD_RELEASE,
	PROTO_CMD_PING,
	PROTO_CMD_INJECT_CHORD,
	PROTO_CMD_INJECT_SCROLL,
	PROTO_CMD_SET_LED,
};

/* Parses a single inbound command line. Returns the command kind;
 * fills `*chord` only when the result is PROTO_CMD_INJECT_CHORD,
 * `*scroll` only when the result is PROTO_CMD_INJECT_SCROLL, and
 * `*led_on` (0 or 1) only when the result is PROTO_CMD_SET_LED. For
 * every other command the out-params are unspecified — callers must
 * check the returned `cmd` before reading them. */
enum protocol_cmd protocol_parse_command(const char *line, struct protocol_chord *chord,
					 struct protocol_scroll *scroll, int *led_on);

/* Format an axes snapshot into *buf. Returns bytes written
 * (excluding the trailing NUL), or -1 if the buffer is too small.
 * The buffer must be at least SPACEUX_EVENT_BUF_SIZE. */
int protocol_format_axes(char *buf, int buf_size, const int *values, int n_values);

/* Format a single button transition into *buf. Same return contract. */
int protocol_format_button(char *buf, int buf_size, int bnum, int pressed);

/* Format a device-changed event into *buf from the device's identity
 * (button count + VID/PID/name). Emitted when the connected puck
 * changes (hotplug swap / (un)plug), so an already-connected client can
 * re-clamp and re-pick its profile without reconnecting. `dev->name`
 * must be pre-sanitized (see input_linux.c) — it is embedded unescaped.
 * Same return contract as the others. */
int protocol_format_device(char *buf, int buf_size, const struct input_device_info *dev);

/* Format the welcome hello message sent on connect.
 *
 * `inject_available` is a 0/1 flag that surfaces whether the daemon
 * successfully opened /dev/uinput at startup — clients use it to log
 * "key injection unavailable" instead of silently no-op'ing on later
 * INJECT_CHORD.
 *
 * `led_available` is the same idea for LED control: 0/1 depending on
 * whether the daemon found a SpaceMouse hidraw node it can write to.
 * Clients use it to gate the pie-open/close LED toggle so they don't
 * waste round-trips sending SET_LED to a daemon that can't honour it.
 *
 * `scroll_available` is the same idea for the pointer device: 0/1
 * depending on whether the daemon opened a second uinput device for
 * relative scroll. Clients (desktop mode) use it to know whether
 * INJECT_SCROLL will do anything.
 *
 * `dev` carries the connected device's button count + VID/PID/name
 * (all-zero/empty when none). `dev->name` must be pre-sanitized — it is
 * embedded unescaped, as is `token` (CSPRNG hex). Never widen either to
 * an unsanitized string without first adding JSON-string escaping. */
int protocol_format_hello(char *buf, int buf_size, int axes_count,
			  const struct input_device_info *dev, int inject_available,
			  int led_available, int scroll_available, const char *token);

#endif /* SPACEUX_PROTOCOL_H */

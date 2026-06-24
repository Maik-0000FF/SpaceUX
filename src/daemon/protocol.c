/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * protocol - implementation. See protocol.h.
 */
#define _GNU_SOURCE
#include "protocol.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "input.h" /* struct input_device_info — embedded in hello/device */

/* Consume the leading capability token from *pp, advancing *pp past it,
 * and copy it (NUL-terminated) into `out` (must hold SPACEUX_TOKEN_HEX_LEN
 * bytes). The token must be exactly SPACEUX_TOKEN_HEX_LEN - 1 hex chars to
 * match what the daemon emitted; any deviation (missing, shorter, longer,
 * non-hex) returns 0 and the caller treats the line as malformed. The
 * token is copied verbatim — semantic validation against the slot's stored
 * token is the caller's job (the parser doesn't know which slot the line
 * came from). Shared by the INJECT_CHORD and INJECT_SCROLL parsers. */
static int parse_auth_token(const char **pp, char *out)
{
	const char *p = *pp;
	while (*p == ' ' || *p == '\t')
		p++;
	if (!*p)
		return 0;
	const char *tok_start = p;
	while (*p && *p != ' ' && *p != '\t')
		p++;
	size_t tok_len = (size_t)(p - tok_start);
	if (tok_len != (size_t)(SPACEUX_TOKEN_HEX_LEN - 1))
		return 0;
	for (size_t i = 0; i < tok_len; i++) {
		char ch = tok_start[i];
		int is_hex = (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') ||
			     (ch >= 'A' && ch <= 'F');
		if (!is_hex)
			return 0;
	}
	memcpy(out, tok_start, tok_len);
	out[tok_len] = '\0';
	*pp = p;
	return 1;
}

/* Parse "INJECT_CHORD <token> <c1> <c2> ... <cN>" into the caller's
 * chord struct. The first whitespace-delimited word after the
 * command verb is the capability token; the remainder is the key-code
 * list. Returns PROTO_CMD_INJECT_CHORD on success or PROTO_CMD_UNKNOWN if
 * the line is malformed (bad token, no codes, a non-numeric code, a code
 * <= 0, too many modifiers). A missing or malformed token is rejected at
 * the parser level — the caller never sees a PROTO_CMD_INJECT_CHORD with
 * an empty `chord->auth_token`. */
static enum protocol_cmd parse_inject_chord(const char *args, struct protocol_chord *chord)
{
	if (!chord)
		return PROTO_CMD_UNKNOWN;

	chord->auth_token[0] = '\0';

	const char *p = args;
	if (!parse_auth_token(&p, chord->auth_token))
		return PROTO_CMD_UNKNOWN;

	int codes[SPACEUX_MAX_CHORD_MODS + 1];
	int n = 0;
	while (*p && n < (int)(sizeof(codes) / sizeof(codes[0]))) {
		while (*p == ' ' || *p == '\t')
			p++;
		if (!*p)
			break;
		char *end;
		long v = strtol(p, &end, 10);
		if (end == p)
			return PROTO_CMD_UNKNOWN; /* not a number */
		if (v <= 0 || v > SPACEUX_WIRE_VALUE_MAX)
			return PROTO_CMD_UNKNOWN; /* sanity bounds, wider than KEY_MAX */
		codes[n++] = (int)v;
		p = end;
	}
	/* Whatever's left after the loop must be whitespace; a trailing
	 * non-number token means the line was malformed. */
	while (*p == ' ' || *p == '\t')
		p++;
	if (*p)
		return PROTO_CMD_UNKNOWN;
	if (n == 0)
		return PROTO_CMD_UNKNOWN;

	/* Last code is the key; everything before is modifiers held
	 * during the tap. n == 1 means "bare key, no mods". */
	chord->key = codes[n - 1];
	chord->n_mods = n - 1;
	for (int i = 0; i < chord->n_mods; i++)
		chord->mods[i] = codes[i];
	return PROTO_CMD_INJECT_CHORD;
}

/* Parse "INJECT_SCROLL <token> <dx> <dy>" into the caller's scroll
 * struct: a capability token (same scheme as the chord) followed by
 * exactly two signed deltas. Returns PROTO_CMD_INJECT_SCROLL on success
 * or PROTO_CMD_UNKNOWN if the line is malformed (bad token, missing or
 * extra numbers, a non-numeric value, a value out of the
 * +-SPACEUX_WIRE_VALUE_MAX sanity range). Like the chord, the token is
 * copied verbatim for the caller to validate against the slot. */
static enum protocol_cmd parse_inject_scroll(const char *args, struct protocol_scroll *scroll)
{
	if (!scroll)
		return PROTO_CMD_UNKNOWN;

	scroll->auth_token[0] = '\0';
	scroll->dx = 0;
	scroll->dy = 0;

	const char *p = args;
	if (!parse_auth_token(&p, scroll->auth_token))
		return PROTO_CMD_UNKNOWN;

	long vals[2];
	int n = 0;
	while (*p && n < 2) {
		while (*p == ' ' || *p == '\t')
			p++;
		if (!*p)
			break;
		char *end;
		long v = strtol(p, &end, 10);
		if (end == p)
			return PROTO_CMD_UNKNOWN; /* not a number */
		if (v < -SPACEUX_WIRE_VALUE_MAX || v > SPACEUX_WIRE_VALUE_MAX)
			return PROTO_CMD_UNKNOWN; /* sanity bounds on one frame's delta */
		vals[n++] = v;
		p = end;
	}
	/* Whatever's left must be whitespace; a trailing token means the
	 * line was malformed. Exactly two deltas are required. */
	while (*p == ' ' || *p == '\t')
		p++;
	if (*p)
		return PROTO_CMD_UNKNOWN;
	if (n != 2)
		return PROTO_CMD_UNKNOWN;

	scroll->dx = (int)vals[0];
	scroll->dy = (int)vals[1];
	return PROTO_CMD_INJECT_SCROLL;
}

/* Parse "SET_LED 0" or "SET_LED 1". Anything else (extra tokens,
 * non-numeric, value other than 0/1) returns PROTO_CMD_UNKNOWN so
 * the daemon ignores it rather than guessing. */
static enum protocol_cmd parse_set_led(const char *args, int *led_on)
{
	if (!led_on)
		return PROTO_CMD_UNKNOWN;
	while (*args == ' ' || *args == '\t')
		args++;
	if (!*args)
		return PROTO_CMD_UNKNOWN;
	char *end;
	long v = strtol(args, &end, 10);
	if (end == args)
		return PROTO_CMD_UNKNOWN;
	if (v != 0 && v != 1)
		return PROTO_CMD_UNKNOWN;
	while (*end == ' ' || *end == '\t')
		end++;
	if (*end)
		return PROTO_CMD_UNKNOWN; /* trailing junk */
	*led_on = (int)v;
	return PROTO_CMD_SET_LED;
}

enum protocol_cmd protocol_parse_command(const char *line, struct protocol_chord *chord,
					 struct protocol_scroll *scroll, int *led_on)
{
	if (!line)
		return PROTO_CMD_UNKNOWN;
	/* Allow trailing whitespace by comparing the token, not strcmp on
	 * the entire line. The caller trims the newline before passing in;
	 * extra whitespace inside the line is treated as a separator. */
	if (strncmp(line, "SUBSCRIBE ", 10) == 0) {
		const char *args = line + 10;
		int has_axes = strstr(args, "axes") != NULL;
		int has_buttons = strstr(args, "buttons") != NULL;
		if (has_axes && has_buttons)
			return PROTO_CMD_SUBSCRIBE_BOTH;
		if (has_axes)
			return PROTO_CMD_SUBSCRIBE_AXES;
		if (has_buttons)
			return PROTO_CMD_SUBSCRIBE_BUTTONS;
		return PROTO_CMD_UNKNOWN;
	}
	if (strncmp(line, "INJECT_CHORD ", 13) == 0)
		return parse_inject_chord(line + 13, chord);
	if (strncmp(line, "INJECT_SCROLL ", 14) == 0)
		return parse_inject_scroll(line + 14, scroll);
	if (strncmp(line, "SET_LED ", 8) == 0)
		return parse_set_led(line + 8, led_on);
	if (strcmp(line, "UNSUBSCRIBE") == 0)
		return PROTO_CMD_UNSUBSCRIBE;
	if (strcmp(line, "GRAB") == 0)
		return PROTO_CMD_GRAB;
	if (strcmp(line, "RELEASE") == 0)
		return PROTO_CMD_RELEASE;
	if (strcmp(line, "PING") == 0)
		return PROTO_CMD_PING;
	return PROTO_CMD_UNKNOWN;
}

int protocol_format_axes(char *buf, int buf_size, const int *values, int n_values)
{
	if (!buf || buf_size <= 0 || !values || n_values <= 0)
		return -1;
	/* Build "[v0,v1,...,vN]" piece by piece so we never depend on a
	 * JSON library. snprintf returns the would-have-written count,
	 * which we accumulate and check against buf_size to refuse
	 * truncation rather than emitting a malformed object. */
	int off = snprintf(buf, buf_size, "{\"event\":\"axes\",\"values\":[");
	if (off < 0 || off >= buf_size)
		return -1;
	for (int i = 0; i < n_values; i++) {
		int w = snprintf(buf + off, buf_size - off, "%s%d", i == 0 ? "" : ",", values[i]);
		if (w < 0 || off + w >= buf_size)
			return -1;
		off += w;
	}
	int w = snprintf(buf + off, buf_size - off, "]}\n");
	if (w < 0 || off + w >= buf_size)
		return -1;
	return off + w;
}

int protocol_format_button(char *buf, int buf_size, int bnum, int pressed)
{
	if (!buf || buf_size <= 0)
		return -1;
	int n = snprintf(buf, buf_size, "{\"event\":\"button\",\"bnum\":%d,\"pressed\":%s}\n", bnum,
			 pressed ? "true" : "false");
	if (n < 0 || n >= buf_size)
		return -1;
	return n;
}

int protocol_format_device(char *buf, int buf_size, const struct input_device_info *dev)
{
	if (!buf || buf_size <= 0 || !dev)
		return -1;
	int n = snprintf(buf, buf_size,
			 "{\"event\":\"device\",\"buttons\":%d,\"vendor\":%u,\"product\":%u,"
			 "\"name\":\"%s\"}\n",
			 dev->buttons, dev->vendor, dev->product, dev->name);
	if (n < 0 || n >= buf_size)
		return -1;
	return n;
}

/* Precondition: both `token` (hex-only, from `generate_token` in
 * socket.c via the OS CSPRNG) and `dev->name` (sanitized to printable
 * ASCII in input_linux.c) are JSON-safe. The serialisation embeds both
 * unescaped on that basis — never widen either to an unsanitized string
 * without first re-introducing proper JSON-string escaping for
 * backslash, quote, and control bytes. */
int protocol_format_hello(char *buf, int buf_size, int axes_count,
			  const struct input_device_info *dev, int inject_available,
			  int led_available, int scroll_available, const char *token)
{
	if (!buf || buf_size <= 0 || !dev)
		return -1;
	int n = snprintf(
		buf, buf_size,
		"{\"event\":\"hello\",\"axes\":%d,\"buttons\":%d,\"inject\":%s,\"led\":%s,"
		"\"scroll\":%s,\"vendor\":%u,\"product\":%u,\"name\":\"%s\",\"token\":\"%s\"}\n",
		axes_count, dev->buttons, inject_available ? "true" : "false",
		led_available ? "true" : "false", scroll_available ? "true" : "false", dev->vendor,
		dev->product, dev->name, token ? token : "");
	if (n < 0 || n >= buf_size)
		return -1;
	return n;
}

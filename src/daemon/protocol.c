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

/* Parse "INJECT_CHORD <c1> <c2> ... <cN>" into the caller's chord
 * struct. Returns PROTO_CMD_INJECT_CHORD on success or
 * PROTO_CMD_UNKNOWN if the line is malformed (no codes, a token
 * that isn't a number, a code <= 0, too many modifiers). */
static enum protocol_cmd parse_inject_chord(const char *args, struct protocol_chord *chord)
{
	if (!chord)
		return PROTO_CMD_UNKNOWN;

	int codes[SPACEUX_MAX_CHORD_MODS + 1];
	int n = 0;
	const char *p = args;
	while (*p && n < (int)(sizeof(codes) / sizeof(codes[0]))) {
		while (*p == ' ' || *p == '\t')
			p++;
		if (!*p)
			break;
		char *end;
		long v = strtol(p, &end, 10);
		if (end == p)
			return PROTO_CMD_UNKNOWN; /* not a number */
		if (v <= 0 || v > 0x7fff)
			return PROTO_CMD_UNKNOWN; /* sanity bounds — wider than KEY_MAX */
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

enum protocol_cmd protocol_parse_command(const char *line, struct protocol_chord *chord)
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

int protocol_format_hello(char *buf, int buf_size, int axes_count, int max_buttons,
			  int inject_available)
{
	if (!buf || buf_size <= 0)
		return -1;
	int n = snprintf(buf, buf_size,
			 "{\"event\":\"hello\",\"axes\":%d,\"buttons\":%d,\"inject\":%s}\n",
			 axes_count, max_buttons, inject_available ? "true" : "false");
	if (n < 0 || n >= buf_size)
		return -1;
	return n;
}

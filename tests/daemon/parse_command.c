/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Unit tests for the daemon command parser (src/daemon/protocol.c):
 * protocol_parse_command and, through it, the line-mode INJECT_CHORD
 * helper. The INJECT_CHORD helper is static, so it is exercised via
 * the public entry point with real "INJECT_CHORD ..." lines.
 *
 * The capability-token validation paths (length, hex-alphabet, missing
 * token, verbatim copy) are pinned in test_chord_auth_token (#45), so a
 * future refactor that weakens parse_auth_token (wrong length accepted,
 * hex check dropped, or a missing token treated as "no auth required")
 * fails here instead of silently in production.
 */
#define _GNU_SOURCE
#include "protocol.h"

#include <stdio.h>
#include <string.h>

#include "check.h"

/* Fill `out` with `n` lowercase-hex 'a' chars + NUL; the caller sizes the
 * buffer. Lets the token cases build a token at, below and above the
 * accepted length without hard-coding any count. */
static void make_hex(char *out, int n)
{
	int i;
	for (i = 0; i < n; i++)
		out[i] = 'a';
	out[n] = '\0';
}

/* A well-formed capability token: exactly SPACEUX_TOKEN_HEX_LEN - 1 hex
 * chars, matching what parse_auth_token accepts. Derived from the macro so
 * the length is never hard-coded. */
static void make_token(char *out)
{
	make_hex(out, SPACEUX_TOKEN_HEX_LEN - 1);
}

/* Build "INJECT_CHORD <token> <tail>" into buf. */
static void chord_line(char *buf, size_t n, const char *tail)
{
	char tok[SPACEUX_TOKEN_HEX_LEN];
	make_token(tok);
	snprintf(buf, n, "INJECT_CHORD %s %s", tok, tail);
}

/* Build "INJECT_SCROLL <token> <tail>" into buf. */
static void scroll_line(char *buf, size_t n, const char *tail)
{
	char tok[SPACEUX_TOKEN_HEX_LEN];
	make_token(tok);
	snprintf(buf, n, "INJECT_SCROLL %s %s", tok, tail);
}

/* Parse a chord line and return the command kind; the parsed payload is
 * left in *chord. scroll/led_on are unused by the chord path but the
 * public signature requires them. */
static enum protocol_cmd parse_chord(const char *line, struct protocol_chord *chord)
{
	struct protocol_scroll scroll;
	int led_on;
	return protocol_parse_command(line, chord, &scroll, &led_on);
}

static void test_verbs(void)
{
	struct protocol_chord chord;
	struct protocol_scroll scroll;
	int led_on;

	CHECK(protocol_parse_command("SUBSCRIBE axes", &chord, &scroll, &led_on) ==
	      PROTO_CMD_SUBSCRIBE_AXES);
	CHECK(protocol_parse_command("SUBSCRIBE buttons", &chord, &scroll, &led_on) ==
	      PROTO_CMD_SUBSCRIBE_BUTTONS);
	CHECK(protocol_parse_command("SUBSCRIBE axes,buttons", &chord, &scroll, &led_on) ==
	      PROTO_CMD_SUBSCRIBE_BOTH);
	CHECK(protocol_parse_command("UNSUBSCRIBE", &chord, &scroll, &led_on) ==
	      PROTO_CMD_UNSUBSCRIBE);
	CHECK(protocol_parse_command("GRAB", &chord, &scroll, &led_on) == PROTO_CMD_GRAB);
	CHECK(protocol_parse_command("RELEASE", &chord, &scroll, &led_on) == PROTO_CMD_RELEASE);
	CHECK(protocol_parse_command("PING", &chord, &scroll, &led_on) == PROTO_CMD_PING);

	/* Unknown verb and the NULL-line guard both fall through to UNKNOWN. */
	CHECK(protocol_parse_command("BOGUS", &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
	CHECK(protocol_parse_command(NULL, &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
}

static void test_chord_happy_path(void)
{
	char line[256];
	struct protocol_chord chord;

	/* Bare key, no modifiers. */
	chord_line(line, sizeof(line), "30");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_INJECT_CHORD);
	CHECK(chord.n_mods == 0);
	CHECK(chord.key == 30);

	/* One modifier + key, codes preserved in order. */
	chord_line(line, sizeof(line), "29 30");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_INJECT_CHORD);
	CHECK(chord.n_mods == 1);
	CHECK(chord.mods[0] == 29);
	CHECK(chord.key == 30);

	/* Exactly SPACEUX_MAX_CHORD_MODS modifiers + 1 key: the cap, accepted.
	 * Spot-check both ends of the modifier list to pin the order-preserving
	 * copy, not just the count. */
	chord_line(line, sizeof(line), "1 2 3 4 5 6 7 8 9");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_INJECT_CHORD);
	CHECK(chord.n_mods == SPACEUX_MAX_CHORD_MODS);
	CHECK(chord.mods[0] == 1);
	CHECK(chord.mods[SPACEUX_MAX_CHORD_MODS - 1] == 8);
	CHECK(chord.key == 9);

	/* Leading whitespace before the code list is skipped. */
	chord_line(line, sizeof(line), "   30");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_INJECT_CHORD);
	CHECK(chord.key == 30);

	/* Trailing whitespace after the codes still parses. */
	chord_line(line, sizeof(line), "30   ");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_INJECT_CHORD);
	CHECK(chord.key == 30);
}

static void test_chord_rejected(void)
{
	char line[256];
	struct protocol_chord chord;

	/* No token and no codes at all. */
	CHECK(parse_chord("INJECT_CHORD ", &chord) == PROTO_CMD_UNKNOWN);

	/* One code over the cap (SPACEUX_MAX_CHORD_MODS + 1 mods + 1 key). */
	chord_line(line, sizeof(line), "1 2 3 4 5 6 7 8 9 10");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* Trailing non-numeric junk. */
	chord_line(line, sizeof(line), "30 xx");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* Non-numeric token in the middle of the list. */
	chord_line(line, sizeof(line), "29 xx 30");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* Negative code. */
	chord_line(line, sizeof(line), "-5");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* Zero: codes are always >= 1. */
	chord_line(line, sizeof(line), "0");
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* One past the sanity bound, derived from the constant rather than a
	 * bare literal so the bound has a single source of truth. */
	char tail[32];
	snprintf(tail, sizeof(tail), "%ld", (long)SPACEUX_WIRE_VALUE_MAX + 1);
	chord_line(line, sizeof(line), tail);
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);
}

static void test_chord_auth_token(void)
{
	char line[256];
	/* Sized for one char past the accepted length (+ NUL): big enough to
	 * hold a deliberately over-long token. */
	char tok[SPACEUX_TOKEN_HEX_LEN + 1];
	struct protocol_chord chord;

	/* The accepted length is exactly SPACEUX_TOKEN_HEX_LEN - 1 hex chars.
	 * One short and one long are both rejected, so a daemon and renderer
	 * that disagree by a single byte can never authenticate by accident. */
	make_hex(tok, SPACEUX_TOKEN_HEX_LEN - 2); /* one too short */
	snprintf(line, sizeof(line), "INJECT_CHORD %s 30", tok);
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	make_hex(tok, SPACEUX_TOKEN_HEX_LEN); /* one too long */
	snprintf(line, sizeof(line), "INJECT_CHORD %s 30", tok);
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* Right length but one non-hex byte: the hex-alphabet check must
	 * reject it, not only the length gate. */
	make_hex(tok, SPACEUX_TOKEN_HEX_LEN - 1);
	tok[0] = 'g'; /* 'g' is just outside 0-9a-fA-F */
	snprintf(line, sizeof(line), "INJECT_CHORD %s 30", tok);
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* A short bare word where the token belongs ("56") is too short to be
	 * a token, so the whole line is malformed: a tokenless INJECT_CHORD is
	 * never treated as "no auth required". */
	CHECK(parse_chord("INJECT_CHORD 56 15", &chord) == PROTO_CMD_UNKNOWN);

	/* A well-formed token with no key codes after it: a token alone is
	 * not a chord. */
	make_token(tok);
	snprintf(line, sizeof(line), "INJECT_CHORD %s", tok);
	CHECK(parse_chord(line, &chord) == PROTO_CMD_UNKNOWN);

	/* Happy path: a valid token + codes parses, and the token is copied
	 * into the chord verbatim (mixed-case hex preserved) for the caller
	 * to validate against the slot's stored token. The upper-case bytes
	 * also pin the A-F branch of the hex check. */
	const char *mixed = "deadBEEFcafef00ddeadbeefcafef00d";
	/* Pin the hand-counted literal to the macro: if SPACEUX_TOKEN_HEX_LEN
	 * ever changes, this fails loudly here instead of the happy path
	 * quietly turning into a PROTO_CMD_UNKNOWN that reads like a bug. */
	CHECK(strlen(mixed) == (size_t)(SPACEUX_TOKEN_HEX_LEN - 1));
	snprintf(line, sizeof(line), "INJECT_CHORD %s 29 30", mixed);
	CHECK(parse_chord(line, &chord) == PROTO_CMD_INJECT_CHORD);
	CHECK(strcmp(chord.auth_token, mixed) == 0);
	CHECK(chord.n_mods == 1);
	CHECK(chord.mods[0] == 29);
	CHECK(chord.key == 30);
}

static void test_scroll(void)
{
	char line[256];
	struct protocol_scroll scroll;
	struct protocol_chord chord;
	int led_on;

	/* Two deltas, the second negative: unlike the chord, scroll accepts
	 * negative values (it carries signed wheel deltas, not key codes). */
	scroll_line(line, sizeof(line), "3 -5");
	CHECK(protocol_parse_command(line, &chord, &scroll, &led_on) == PROTO_CMD_INJECT_SCROLL);
	CHECK(scroll.dx == 3);
	CHECK(scroll.dy == -5);

	/* Exactly two deltas are required: one is too few, three too many. */
	scroll_line(line, sizeof(line), "3");
	CHECK(protocol_parse_command(line, &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
	scroll_line(line, sizeof(line), "3 4 5");
	CHECK(protocol_parse_command(line, &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);

	/* Sanity bounds: +-SPACEUX_WIRE_VALUE_MAX inclusive, anything past it
	 * rejected in either position. The over-bound value is derived from the
	 * constant so the bound has a single source of truth. */
	char tail[32];
	snprintf(tail, sizeof(tail), "%ld 0", (long)SPACEUX_WIRE_VALUE_MAX + 1);
	scroll_line(line, sizeof(line), tail);
	CHECK(protocol_parse_command(line, &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
	snprintf(tail, sizeof(tail), "0 %ld", -((long)SPACEUX_WIRE_VALUE_MAX + 1));
	scroll_line(line, sizeof(line), tail);
	CHECK(protocol_parse_command(line, &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);

	/* A missing capability token is rejected at the parser level. */
	CHECK(protocol_parse_command("INJECT_SCROLL ", &chord, &scroll, &led_on) ==
	      PROTO_CMD_UNKNOWN);
}

static void test_set_led(void)
{
	struct protocol_chord chord;
	struct protocol_scroll scroll;
	int led_on;

	/* Only 0 and 1 are accepted, and the flag is written through. */
	led_on = -1;
	CHECK(protocol_parse_command("SET_LED 0", &chord, &scroll, &led_on) == PROTO_CMD_SET_LED);
	CHECK(led_on == 0);
	led_on = -1;
	CHECK(protocol_parse_command("SET_LED 1", &chord, &scroll, &led_on) == PROTO_CMD_SET_LED);
	CHECK(led_on == 1);

	/* Any other value, an empty arg, or trailing junk is rejected. */
	CHECK(protocol_parse_command("SET_LED 2", &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
	CHECK(protocol_parse_command("SET_LED ", &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
	CHECK(protocol_parse_command("SET_LED 1 x", &chord, &scroll, &led_on) == PROTO_CMD_UNKNOWN);
}

int main(void)
{
	test_verbs();
	test_chord_happy_path();
	test_chord_rejected();
	test_chord_auth_token();
	test_scroll();
	test_set_led();
	return check_report();
}

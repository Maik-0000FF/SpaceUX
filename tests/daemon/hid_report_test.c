/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Unit tests for the raw HID report decoder (src/daemon/hid_report.c):
 * hid_report_decode. A relative puck is read over hidraw, so this decoder
 * is the model-specific, byte-fiddly part of that path. Being a pure
 * function (bytes in, axis/button state out) it is tested here directly,
 * with no device, the way protocol.c is.
 *
 * The cases pin the load-bearing properties: little-endian signed-16
 * decoding, the axis layout per report id (translation / rotation /
 * combined), the TZ sign convention (#153), that zeros are honoured (the
 * whole reason hidraw is used over EV_REL), and that short or unknown
 * reports touch nothing.
 */
#include "hid_report.h"

#include <stdint.h>
#include <string.h>

#include "check.h"

/* Write a signed value as a little-endian 16-bit pair at p. */
static void put16(unsigned char *p, int v)
{
	p[0] = (unsigned char)(v & 0xff);
	p[1] = (unsigned char)((v >> 8) & 0xff);
}

/* Translation report: id 1, three LE int16 axes. Z (index 2) comes back
 * negated per #153; X and Y pass through. Negative values exercise the
 * signed decode. */
static void test_translation(void)
{
	unsigned char buf[7];
	buf[0] = 1;
	put16(&buf[1], 100);
	put16(&buf[3], -200);
	put16(&buf[5], 300);

	int axes[SPACEUX_AXIS_COUNT];
	memset(axes, 0x7f, sizeof(axes));
	uint32_t buttons = 0;
	enum hid_report_kind kind = hid_report_decode(buf, sizeof(buf), axes, &buttons);

	CHECK(kind == HID_REPORT_AXES);
	CHECK(axes[0] == 100);
	CHECK(axes[1] == -200);
	CHECK(axes[2] == -300); /* TZ sign flip (#153) */
}

/* Rotation report: id 2 fills the rotational trio (indices 3..5), leaving
 * the translation axes untouched. */
static void test_rotation(void)
{
	unsigned char buf[7];
	buf[0] = 2;
	put16(&buf[1], 11);
	put16(&buf[3], -22);
	put16(&buf[5], 33);

	int axes[SPACEUX_AXIS_COUNT] = {1, 2, 3, 0, 0, 0};
	uint32_t buttons = 0;
	enum hid_report_kind kind = hid_report_decode(buf, sizeof(buf), axes, &buttons);

	CHECK(kind == HID_REPORT_AXES);
	CHECK(axes[0] == 1 && axes[1] == 2 && axes[2] == 3); /* translation kept */
	CHECK(axes[3] == 11);
	CHECK(axes[4] == -22);
	CHECK(axes[5] == 33);
}

/* Combined report: id 1 carrying all six axes (>= 13 bytes) is decoded in
 * one go, rotation included. */
static void test_combined(void)
{
	unsigned char buf[13];
	buf[0] = 1;
	put16(&buf[1], 10);
	put16(&buf[3], 20);
	put16(&buf[5], 30);
	put16(&buf[7], 40);
	put16(&buf[9], 50);
	put16(&buf[11], 60);

	int axes[SPACEUX_AXIS_COUNT] = {0};
	uint32_t buttons = 0;
	enum hid_report_kind kind = hid_report_decode(buf, sizeof(buf), axes, &buttons);

	CHECK(kind == HID_REPORT_AXES);
	CHECK(axes[0] == 10 && axes[1] == 20 && axes[2] == -30);
	CHECK(axes[3] == 40 && axes[4] == 50 && axes[5] == 60);
}

/* Zeros are real data, not "unchanged": a report of all-zero axes clears the
 * state. This is the property EV_REL cannot express and the reason the
 * hidraw path exists at all. */
static void test_zeros_recentre(void)
{
	unsigned char buf[7] = {1, 0, 0, 0, 0, 0, 0};
	int axes[SPACEUX_AXIS_COUNT] = {500, -500, 500, -500, 500, -500};
	uint32_t buttons = 0;
	enum hid_report_kind kind = hid_report_decode(buf, sizeof(buf), axes, &buttons);

	CHECK(kind == HID_REPORT_AXES);
	CHECK(axes[0] == 0 && axes[1] == 0 && axes[2] == 0);
}

/* Button report: id 3, little-endian bitmask over the tail. */
static void test_buttons(void)
{
	unsigned char buf[3] = {3, 0x05, 0x02}; /* bits 0, 2, 9 */
	int axes[SPACEUX_AXIS_COUNT] = {0};
	uint32_t buttons = 0xdeadbeef;
	enum hid_report_kind kind = hid_report_decode(buf, sizeof(buf), axes, &buttons);

	CHECK(kind == HID_REPORT_BUTTONS);
	CHECK(buttons == ((1u << 0) | (1u << 2) | (1u << 9)));
}

/* Unknown report ids and truncated axis reports touch nothing and report
 * HID_REPORT_NONE, so a stray report can never corrupt the axis state. */
static void test_none_paths(void)
{
	int axes[SPACEUX_AXIS_COUNT] = {7, 7, 7, 7, 7, 7};
	uint32_t buttons = 0;

	unsigned char unknown[7] = {9, 1, 2, 3, 4, 5, 6};
	CHECK(hid_report_decode(unknown, sizeof(unknown), axes, &buttons) == HID_REPORT_NONE);

	unsigned char shortrep[4] = {1, 1, 2, 3}; /* id 1 but too few bytes */
	CHECK(hid_report_decode(shortrep, sizeof(shortrep), axes, &buttons) == HID_REPORT_NONE);

	CHECK(hid_report_decode(unknown, 0, axes, &buttons) == HID_REPORT_NONE);

	/* State survived every non-decode. */
	for (int i = 0; i < SPACEUX_AXIS_COUNT; i++)
		CHECK(axes[i] == 7);
}

int main(void)
{
	test_translation();
	test_rotation();
	test_combined();
	test_zeros_recentre();
	test_buttons();
	test_none_paths();
	return check_report();
}

/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * hid_report - implementation. See hid_report.h.
 */
#include "hid_report.h"

/* Read a signed little-endian 16-bit HID axis value. */
static int rd16(const unsigned char *p)
{
	return (int16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

/* Store one raw HID logical axis value into axes[idx]. No scaling: the
 * kernel's generic-HID ABS mapping passes the same logical value through
 * unscaled, so raw passthrough matches byte-for-byte what the evdev ABS path
 * yields for a device the kernel maps to ABS (parity is the goal, not a
 * fixed range; the app's per-device clamp/profile handles range). Only the
 * app's TZ sign convention is applied (#153: axis index 2 is Z, down =
 * negative). */
static void set_axis(int axes[SPACEUX_AXIS_COUNT], int idx, int raw)
{
	axes[idx] = (idx == 2) ? -raw : raw;
}

enum hid_report_kind hid_report_decode(const unsigned char *buf, int n,
				       int axes[SPACEUX_AXIS_COUNT], uint32_t *buttons)
{
	if (n < 1)
		return HID_REPORT_NONE;
	switch (buf[0]) {
	case 1: /* translation, or all six axes on combined-report models */
		if (n < 7)
			return HID_REPORT_NONE;
		set_axis(axes, 0, rd16(&buf[1]));
		set_axis(axes, 1, rd16(&buf[3]));
		set_axis(axes, 2, rd16(&buf[5]));
		if (n >= 13) {
			set_axis(axes, 3, rd16(&buf[7]));
			set_axis(axes, 4, rd16(&buf[9]));
			set_axis(axes, 5, rd16(&buf[11]));
		}
		return HID_REPORT_AXES;
	case 2: /* rotation */
		if (n < 7)
			return HID_REPORT_NONE;
		set_axis(axes, 3, rd16(&buf[1]));
		set_axis(axes, 4, rd16(&buf[3]));
		set_axis(axes, 5, rd16(&buf[5]));
		return HID_REPORT_AXES;
	case 3: { /* buttons: little-endian bitmask over the report's tail */
		uint32_t mask = 0;
		for (int i = 1; i < n && i <= 4; i++)
			mask |= (uint32_t)buf[i] << (8 * (i - 1));
		*buttons = mask;
		return HID_REPORT_BUTTONS;
	}
	default:
		return HID_REPORT_NONE;
	}
}

/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * hid_report - decode raw 3Dconnexion HID input reports.
 *
 * A relative puck (one whose 6DOF the kernel maps to EV_REL, see
 * input_linux.c) is read over its hidraw node instead of evdev, because
 * EV_REL cannot express a return to centre. This unit turns one raw HID
 * input report into axis or button state. It is deliberately self-contained
 * (no kernel headers, no ioctls, no device or global state) so it links
 * into the C unit tests and is exercised directly, byte-in / state-out,
 * without any hardware, the same way protocol.c is tested.
 */
#ifndef SPACEUX_HID_REPORT_H
#define SPACEUX_HID_REPORT_H

#include <stdint.h>

#include "config.h"

/* What a decoded report updated. */
enum hid_report_kind {
	HID_REPORT_NONE = 0, /* unrecognised report id, or too short: nothing touched */
	HID_REPORT_AXES,     /* axes[] updated */
	HID_REPORT_BUTTONS,  /* *buttons updated */
};

/* Decode one raw HID input report of `n` bytes (leading report id included).
 * The SpaceNavigator family keys the report by that id:
 *   1 = translation  (3x signed-16 LE: x, y, z), or all six axes on models
 *       that fold rotation into the same report (>= 13 bytes)
 *   2 = rotation     (3x signed-16 LE: rx, ry, rz)
 *   3 = buttons      (little-endian bitmask over the report tail, 1..4 bytes)
 *
 * On an axis report the six-slot axes[] is updated in app convention: raw
 * HID logical values passed through unscaled (the kernel's generic-HID ABS
 * mapping does the same, so this matches byte-for-byte what evdev would
 * yield for a device mapped to ABS), with TZ sign-flipped (#153; axis index
 * 2 is Z, down = negative). On a button report *buttons receives the current
 * mask. Every report carries absolute values including zero, so there is no
 * lost return-to-centre. Unknown or short reports return HID_REPORT_NONE and
 * touch nothing. */
enum hid_report_kind hid_report_decode(const unsigned char *buf, int n,
				       int axes[SPACEUX_AXIS_COUNT], uint32_t *buttons);

#endif /* SPACEUX_HID_REPORT_H */

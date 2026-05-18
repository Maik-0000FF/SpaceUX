/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * kernel_input - direct evdev reader for 3Dconnexion pucks.
 *
 * The daemon owns one /dev/input/eventN at a time. Hot-plug and
 * device-vanished are surfaced via return codes from kinput_poll
 * so the main loop can call kinput_close + kinput_open in the
 * retry rhythm declared in config.h.
 */
#ifndef SPACEUX_KERNEL_INPUT_H
#define SPACEUX_KERNEL_INPUT_H

#include "config.h"

/* Discriminator for kinput_event below. */
enum kinput_event_kind {
	KIE_NONE = 0,
	KIE_AXES,   /* full snapshot, one entry per axis */
	KIE_BUTTON, /* one button transition */
};

/* Single event surfaced to the main loop. AXES carries the latest
 * value per axis (the kernel sends one EV_ABS per axis but we
 * coalesce up to SYN_REPORT so the renderer gets full snapshots
 * instead of dribbled deltas). BUTTON carries one transition. */
struct kinput_event {
	enum kinput_event_kind kind;
	int values[SPACEUX_AXIS_COUNT]; /* signed evdev values, valid for KIE_AXES */
	int bnum;		       /* 0..SPACEUX_MAX_BUTTONS-1, valid for KIE_BUTTON */
	int pressed;		       /* 0/1, valid for KIE_BUTTON */
};

/* Search /dev/input for a 3Dconnexion puck and open it read-only.
 * Returns the fd, or -1 if no compatible device is currently attached.
 * The fd is non-blocking. */
int kinput_open(void);

/* Close fd and clear any cached axis state. */
void kinput_close(int fd);

/* Drain one event from the kernel queue. Returns:
 *   1 — *out is populated, more may be queued (call again until 0)
 *   0 — nothing pending
 *  -1 — device is gone (POLLHUP / read error), caller closes + retries
 */
int kinput_poll(int fd, struct kinput_event *out);

#endif /* SPACEUX_KERNEL_INPUT_H */

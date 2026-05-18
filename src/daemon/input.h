/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * input - platform-abstract API for reading a 3Dconnexion puck.
 *
 * The daemon talks only to this header. The actual device-access
 * implementation lives in one of the input_<platform>.c files; the
 * build system selects which one ships based on the host OS:
 *
 *   Linux   → input_linux.c   (evdev via /dev/input/eventN)
 *   Windows → input_windows.c (3Dconnexion HID API, planned)
 *   macOS   → input_macos.c   (IOHIDManager via IOKit, planned)
 *
 * Every backend must surface the same struct puck_event shape and
 * the same input_open / input_poll / input_close contract so the
 * daemon main loop stays platform-neutral. The "puck_" prefix avoids
 * clashing with the Linux kernel's <linux/input.h> ::struct input_event
 * which the Linux backend pulls in.
 *
 * The "input fd" returned by input_open is an opaque integer handle
 * the backend understands — on Linux it's an actual file descriptor
 * usable with poll(); on Windows it might be a HANDLE cast to int.
 * The daemon never inspects it directly except for poll() readiness;
 * future backends that don't fit poll() will need either a different
 * abstraction or a thread that bridges into a pipe.
 */
#ifndef SPACEUX_INPUT_H
#define SPACEUX_INPUT_H

#include "config.h"

/* Discriminator for struct puck_event below. */
enum puck_event_kind {
	PE_NONE = 0,
	PE_AXES,   /* full snapshot, one entry per axis */
	PE_BUTTON, /* one button transition */
};

/* Single event surfaced to the main loop. AXES carries the latest
 * value per axis (devices typically send one tick per axis but we
 * coalesce until the firmware signals "frame done" so the renderer
 * sees whole snapshots instead of dribbled deltas). BUTTON carries
 * one transition. */
struct puck_event {
	enum puck_event_kind kind;
	int values[SPACEUX_AXIS_COUNT]; /* signed values, valid for PE_AXES */
	int bnum;		       /* 0..SPACEUX_MAX_BUTTONS-1, valid for PE_BUTTON */
	int pressed;		       /* 0/1, valid for PE_BUTTON */
};

/* Search the host for a 3Dconnexion puck and open it read-only.
 * Returns the backend's handle (>= 0) or -1 if no device is currently
 * attached. The handle is non-blocking; the daemon polls readiness
 * through poll() and drains via input_poll. */
int input_open(void);

/* Close the backend handle and clear any cached state. */
void input_close(int fd);

/* Drain one event from the backend's queue. Returns:
 *   1 — *out is populated, more may be queued (call again until 0)
 *   0 — nothing pending
 *  -1 — device is gone (POLLHUP / read error), caller closes + retries
 */
int input_poll(int fd, struct puck_event *out);

#endif /* SPACEUX_INPUT_H */

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
 * One physical puck can surface across more than one OS handle. On
 * Linux a device connected by USB cable usually presents a single
 * combined evdev node, but some links (a wireless receiver) split it
 * into an axis node and a separate button node. The backend therefore
 * owns a *set* of handles internally: input_open discovers and opens
 * every node of one device, input_get_fds hands the pollable handles to
 * the daemon, and input_poll drains whichever one is ready. input_close
 * and input_set_grab act on the whole set.
 *
 * Each handle is an opaque integer the backend understands. On Linux it
 * is an actual file descriptor usable with poll(); on Windows it might
 * be a HANDLE cast to int. The daemon never inspects it except for
 * poll() readiness; future backends that don't fit poll() will need
 * either a different abstraction or a thread that bridges into a pipe.
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
	int bnum;			/* 0..SPACEUX_MAX_BUTTONS-1, valid for PE_BUTTON */
	int pressed;			/* 0/1, valid for PE_BUTTON */
};

/* Search the host for a 3Dconnexion puck and open every evdev node that
 * belongs to it read-only. Returns the number of handles opened (>= 1)
 * or 0 if no device is currently attached. The handles are non-blocking;
 * the daemon fetches them with input_get_fds, polls readiness through
 * poll() and drains via input_poll. */
int input_open(void);

/* Copy the open device's pollable handles into out (capacity max) and
 * return how many were written (0 when no device is open). The daemon
 * adds each to its poll set. */
int input_get_fds(int *out, int max);

/* Close every open handle and clear any cached state. */
void input_close(void);

/* Identity + capabilities of the currently-open puck. All-zero / empty
 * when no device is open. Surfaced to clients in the `hello` and
 * `device` events: `buttons` lets the editor offer only buttons that
 * exist (#66); `vendor`/`product`/`name` let it pick the matching
 * per-device profile and label the active device (#113). */
struct input_device_info {
	unsigned short vendor;	/* USB vendor id (EVIOCGID), 0 when none */
	unsigned short product; /* USB product id, 0 when none */
	/* Button count discovered from the device's EV_KEY capabilities
	 * rather than a per-model table (0 when none open). */
	int buttons;
	/* EVIOCGNAME model string, truncated to fit and pre-sanitized to
	 * JSON-safe printable ASCII (see input_linux.c). "" when none. */
	char name[SPACEUX_DEVICE_NAME_LEN];
};

/* Fill *out with the currently-open device's identity (zeros/empty when
 * none is open). */
void input_device_info(struct input_device_info *out);

/* Drain one event from the handle fd (one of those returned by
 * input_get_fds). Returns:
 *   1 — *out is populated, more may be queued (call again until 0)
 *   0 — nothing pending
 *  -1 — the node is gone (POLLHUP / read error); the puck is treated as
 *       unplugged, so the caller closes the whole set and retries
 */
int input_poll(int fd, struct puck_event *out);

/* Take or drop an exclusive grab on every open node so that, while
 * grabbed, no other reader (spacenavd, FreeCAD, Blender) sees the puck's
 * axes or buttons. The pie holds the device for the duration it's open
 * (#327). Best-effort: returns 0 only when every node was set, -1 if any
 * node failed (no device open, or the backend rejected it); the caller
 * logs. The grab is transient and dies automatically when a handle is
 * closed, so an unplug needs no explicit release. */
int input_set_grab(int grab);

#endif /* SPACEUX_INPUT_H */

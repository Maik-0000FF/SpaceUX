/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * input_linux - Linux backend for input.h.
 *
 * Reads a 3Dconnexion puck via the kernel's evdev interface
 * (/dev/input/eventN). Coalesces per-axis EV_ABS deltas until the
 * kernel emits SYN_REPORT, at which point one full PE_AXES snapshot
 * goes out. Button transitions are forwarded one-for-one as
 * PE_BUTTON events.
 *
 * The local <linux/input.h> declares ::struct input_event for the
 * kernel's wire format; our higher-level event type is ::struct
 * puck_event so the two never collide.
 */
#define _GNU_SOURCE
#include "input.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>

#include <linux/input.h>

/* VIDs known to ship 3Dconnexion pucks. PID-level filtering happens
 * inside the loop — we accept anything whose VID matches and whose
 * BTN_0..BTN_9 + ABS_X..ABS_RZ bits show up. Mirrors the udev
 * device-table convention without depending on a userspace database. */
static const unsigned short SPACEMOUSE_VIDS[] = {0x046d, 0x256f};
static const size_t SPACEMOUSE_VIDS_N = sizeof(SPACEMOUSE_VIDS) / sizeof(SPACEMOUSE_VIDS[0]);

static int g_axis_state[SPACEUX_AXIS_COUNT];
static int g_axis_dirty;
/* Button count of the currently-open device, discovered from its
 * EV_KEY capability bits (0 when no device is open). Lets the editor
 * offer only the buttons the puck actually has — accurate for every
 * model, present and future, with no per-model table to maintain
 * (see #66). */
static int g_button_count;
/* Identity of the currently-open device (0 / "" when none). Captured at
 * open alongside the button count so clients can key per-device profiles
 * and label the active puck (#113). g_name is pre-sanitized to JSON-safe
 * printable ASCII so the event emitter can embed it without escaping. */
static unsigned short g_vendor;
static unsigned short g_product;
static char g_name[SPACEUX_DEVICE_NAME_LEN];

static int vid_matches(unsigned short vid)
{
	for (size_t i = 0; i < SPACEMOUSE_VIDS_N; i++)
		if (SPACEMOUSE_VIDS[i] == vid)
			return 1;
	return 0;
}

/* Count the buttons a device exposes via its EV_KEY capability bitmap,
 * over exactly the codes input_poll maps to a bnum: BTN_0..BTN_9
 * (bnum 0..9) and BTN_TRIGGER_HAPPY1..40 (bnum 10..49). The kernel
 * reports the device's real capabilities, so this is the authoritative
 * per-device count without any VID/PID database. Returns 0 on failure.
 *
 * The result is consumed as a contiguous range (buttons 0..count-1) —
 * fine because SpaceMice report contiguous button codes. It's clamped
 * to SPACEUX_MAX_BUTTONS: code_to_bnum drops any bnum past that cap, so
 * advertising more would promise buttons input_poll never delivers. */
static int discover_button_count(int fd)
{
	unsigned long keybits[(KEY_MAX / (8 * sizeof(unsigned long))) + 1];
	memset(keybits, 0, sizeof(keybits));
	if (ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(keybits)), keybits) < 0)
		return 0;
	const unsigned long wb = 8 * sizeof(unsigned long);
	int count = 0;
	for (int code = BTN_0; code <= BTN_9; code++)
		if (keybits[code / wb] & (1UL << (code % wb)))
			count++;
	for (int code = BTN_TRIGGER_HAPPY1; code <= BTN_TRIGGER_HAPPY40; code++)
		if (keybits[code / wb] & (1UL << (code % wb)))
			count++;
	return count > SPACEUX_MAX_BUTTONS ? SPACEUX_MAX_BUTTONS : count;
}

/* Capture the open device's VID/PID (EVIOCGID) and model name
 * (EVIOCGNAME) into the g_* identity globals. The name is the only
 * field that reaches the wire as a string, and the kernel sources it
 * from the device's USB descriptor — untrusted input. Rather than teach
 * the JSON emitter to escape, we sanitize here: any byte outside
 * printable ASCII, or a quote/backslash, becomes '?'. That keeps the
 * emitter trivial and the name safe to embed verbatim. A failed ioctl
 * leaves the corresponding field at its zeroed/empty default. */
static void capture_identity(int fd)
{
	struct input_id id;
	if (ioctl(fd, EVIOCGID, &id) == 0) {
		g_vendor = id.vendor;
		g_product = id.product;
	}
	if (ioctl(fd, EVIOCGNAME(sizeof(g_name)), g_name) < 0)
		g_name[0] = '\0';
	g_name[sizeof(g_name) - 1] = '\0';
	for (char *p = g_name; *p; p++) {
		unsigned char c = (unsigned char)*p;
		if (c < 0x20 || c > 0x7e || c == '"' || c == '\\')
			*p = '?';
	}
}

static int looks_like_spacemouse(int fd)
{
	struct input_id id;
	if (ioctl(fd, EVIOCGID, &id) < 0)
		return 0;
	if (!vid_matches(id.vendor))
		return 0;
	/* Confirm the device exposes the absolute axes we care about.
	 * EVIOCGBIT with EV_ABS returns a bitmap; we need at least ABS_X. */
	unsigned long absbits[(ABS_MAX / (8 * sizeof(unsigned long))) + 1];
	memset(absbits, 0, sizeof(absbits));
	if (ioctl(fd, EVIOCGBIT(EV_ABS, sizeof(absbits)), absbits) < 0)
		return 0;
	const unsigned long word_bits = 8 * sizeof(unsigned long);
	if (!(absbits[ABS_X / word_bits] & (1UL << (ABS_X % word_bits))))
		return 0;
	return 1;
}

int input_open(void)
{
	DIR *d = opendir("/dev/input");
	if (!d)
		return -1;

	int found_fd = -1;
	struct dirent *ent;
	while ((ent = readdir(d)) != NULL) {
		if (strncmp(ent->d_name, "event", 5) != 0)
			continue;
		/* d_name is bounded by NAME_MAX on Linux (255). The
		 * "/dev/input/" prefix is 11 chars, so 280 covers any
		 * filename plus the prefix plus a NUL — the compiler
		 * needs the buffer to be at least that wide to drop the
		 * format-truncation warning. */
		char path[280];
		snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
		int fd = open(path, O_RDONLY | O_NONBLOCK);
		if (fd < 0)
			continue;
		if (looks_like_spacemouse(fd)) {
			found_fd = fd;
			break;
		}
		close(fd);
	}
	closedir(d);

	memset(g_axis_state, 0, sizeof(g_axis_state));
	g_axis_dirty = 0;
	g_vendor = 0;
	g_product = 0;
	g_name[0] = '\0';
	if (found_fd >= 0) {
		g_button_count = discover_button_count(found_fd);
		capture_identity(found_fd);
	} else {
		g_button_count = 0;
	}
	return found_fd;
}

void input_close(int fd)
{
	if (fd >= 0)
		close(fd);
	memset(g_axis_state, 0, sizeof(g_axis_state));
	g_axis_dirty = 0;
	g_button_count = 0;
	g_vendor = 0;
	g_product = 0;
	g_name[0] = '\0';
}

void input_device_info(struct input_device_info *out)
{
	out->vendor = g_vendor;
	out->product = g_product;
	out->buttons = g_button_count;
	memcpy(out->name, g_name, sizeof(out->name));
}

/* Map a Linux EV_KEY code to a 0-based bnum. Buttons 1..10 live in
 * BTN_0..BTN_9; buttons 11+ live in BTN_TRIGGER_HAPPY1+. Anything
 * else is not a SpaceMouse button. */
static int code_to_bnum(int code)
{
	int bnum = -1;
	if (code >= BTN_0 && code <= BTN_9)
		bnum = code - BTN_0;
	else if (code >= BTN_TRIGGER_HAPPY1 && code <= BTN_TRIGGER_HAPPY40)
		bnum = 10 + (code - BTN_TRIGGER_HAPPY1);
	if (bnum < 0 || bnum >= SPACEUX_MAX_BUTTONS)
		return -1;
	return bnum;
}

int input_poll(int fd, struct puck_event *out)
{
	struct input_event ie;
	ssize_t n;
	while ((n = read(fd, &ie, sizeof(ie))) > 0) {
		if (n != sizeof(ie))
			return -1;
		if (ie.type == EV_ABS && ie.code < SPACEUX_AXIS_COUNT) {
			/* Normalise TZ to the coordinate convention down = negative Z.
			 * The kernel reports pushing the puck cap *down* as +ABS_Z, but
			 * the whole app treats TZ- as down/press (schema docs, editor
			 * labels, the default TZ-back gesture). Flip it here at the
			 * hardware boundary so push-down = TZ- on every device (#153). */
			g_axis_state[ie.code] = (ie.code == ABS_Z) ? -ie.value : ie.value;
			g_axis_dirty = 1;
		} else if (ie.type == EV_KEY) {
			int bnum = code_to_bnum(ie.code);
			if (bnum < 0)
				continue;
			out->kind = PE_BUTTON;
			out->bnum = bnum;
			out->pressed = ie.value;
			return 1;
		} else if (ie.type == EV_SYN && ie.code == SYN_REPORT) {
			if (!g_axis_dirty)
				continue;
			g_axis_dirty = 0;
			out->kind = PE_AXES;
			memcpy(out->values, g_axis_state, sizeof(g_axis_state));
			return 1;
		}
	}
	if (n == 0)
		return -1; /* EOF — device vanished */
	if (errno == EAGAIN || errno == EWOULDBLOCK)
		return 0;
	return -1;
}

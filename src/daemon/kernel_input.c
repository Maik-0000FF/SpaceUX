/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * kernel_input - implementation. See kernel_input.h.
 */
#define _GNU_SOURCE
#include "kernel_input.h"

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

static int vid_matches(unsigned short vid)
{
	for (size_t i = 0; i < SPACEMOUSE_VIDS_N; i++)
		if (SPACEMOUSE_VIDS[i] == vid)
			return 1;
	return 0;
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

int kinput_open(void)
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
	return found_fd;
}

void kinput_close(int fd)
{
	if (fd >= 0)
		close(fd);
	memset(g_axis_state, 0, sizeof(g_axis_state));
	g_axis_dirty = 0;
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

int kinput_poll(int fd, struct kinput_event *out)
{
	struct input_event ie;
	ssize_t n;
	while ((n = read(fd, &ie, sizeof(ie))) > 0) {
		if (n != sizeof(ie))
			return -1;
		if (ie.type == EV_ABS && ie.code < SPACEUX_AXIS_COUNT) {
			g_axis_state[ie.code] = ie.value;
			g_axis_dirty = 1;
		} else if (ie.type == EV_KEY) {
			int bnum = code_to_bnum(ie.code);
			if (bnum < 0)
				continue;
			out->kind = KIE_BUTTON;
			out->bnum = bnum;
			out->pressed = ie.value;
			return 1;
		} else if (ie.type == EV_SYN && ie.code == SYN_REPORT) {
			if (!g_axis_dirty)
				continue;
			g_axis_dirty = 0;
			out->kind = KIE_AXES;
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

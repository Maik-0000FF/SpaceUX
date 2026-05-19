/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * inject_linux - /dev/uinput backend for inject.h.
 *
 * One virtual keyboard device gets created at daemon start and lives
 * until the daemon exits. The device declares every Linux keyboard
 * scancode it might emit (1..KEY_MAX) so the dispatch layer doesn't
 * need a static allowlist that would have to track keycodes.ts in
 * the renderer.
 */
#define _GNU_SOURCE
#include "inject.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>

#include <linux/input.h>
#include <linux/uinput.h>

static void emit_event(int fd, int type, int code, int val)
{
	struct input_event ie;
	memset(&ie, 0, sizeof(ie));
	ie.type = (unsigned short)type;
	ie.code = (unsigned short)code;
	ie.value = val;
	/* uinput rarely fails to accept a write after UI_DEV_CREATE;
	 * a single dropped event isn't worth aborting the chord, the
	 * compositor will just see "no edge" for that one transition. */
	(void)!write(fd, &ie, sizeof(ie));
}

int inject_open(void)
{
	int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK | O_CLOEXEC);
	if (fd < 0) {
		fprintf(stderr,
			"spaceux-daemon: cannot open /dev/uinput (%s). "
			"Key injection disabled — ensure the uinput module is "
			"loaded and the udev rule grants the user access.\n",
			strerror(errno));
		return -1;
	}

	if (ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0) {
		fprintf(stderr, "spaceux-daemon: UI_SET_EVBIT EV_KEY failed (%s)\n",
			strerror(errno));
		close(fd);
		return -1;
	}
	/* Declare every keyboard scancode the kernel knows about. The
	 * loop is ~KEY_MAX ioctls — a few hundred microseconds at startup
	 * — and saves us a hand-curated allowlist that would have to be
	 * kept in lock-step with src/main/builtins/keycodes.ts. */
	for (int code = 1; code < KEY_MAX; code++)
		ioctl(fd, UI_SET_KEYBIT, code);

	struct uinput_setup usetup;
	memset(&usetup, 0, sizeof(usetup));
	usetup.id.bustype = BUS_VIRTUAL;
	/* pid.codes 0x1209 is the OSS test VID; product is arbitrary
	 * within that namespace. Visible in `lsusb`-like listings so a
	 * curious user can tell where the injected events come from. */
	usetup.id.vendor = 0x1209;
	usetup.id.product = 0xbeef;
	snprintf(usetup.name, UINPUT_MAX_NAME_SIZE, "SpaceUX Virtual Keyboard");

	if (ioctl(fd, UI_DEV_SETUP, &usetup) < 0) {
		fprintf(stderr, "spaceux-daemon: UI_DEV_SETUP failed (%s)\n", strerror(errno));
		close(fd);
		return -1;
	}
	if (ioctl(fd, UI_DEV_CREATE) < 0) {
		fprintf(stderr, "spaceux-daemon: UI_DEV_CREATE failed (%s)\n", strerror(errno));
		close(fd);
		return -1;
	}
	/* The kernel needs a brief moment to surface the new device
	 * through udev / libinput / the compositor's input stack. Without
	 * the pause, the first one or two events occasionally race the
	 * device-ready notification and get dropped silently. 100ms
	 * matches what other uinput users (ydotool, wtype) sleep here. */
	usleep(100000);
	return fd;
}

void inject_close(int fd)
{
	if (fd < 0)
		return;
	ioctl(fd, UI_DEV_DESTROY);
	close(fd);
}

void inject_chord(int fd, const int *mods, int n_mods, int key)
{
	if (fd < 0)
		return;

	/* Phase 1: every modifier down, single SYN_REPORT.
	 * The compositor sees "Alt held" before the key arrives so its
	 * modifier-state machine is primed for the shortcut. */
	for (int i = 0; i < n_mods; i++)
		emit_event(fd, EV_KEY, mods[i], 1);
	emit_event(fd, EV_SYN, SYN_REPORT, 0);

	/* Phase 2: key down + SYN_REPORT.
	 * A shortcut like Alt+Tab fires its window-switcher state here
	 * — the cycle is entered on this frame. */
	emit_event(fd, EV_KEY, key, 1);
	emit_event(fd, EV_SYN, SYN_REPORT, 0);

	/* Phase 3: key up, then modifiers up in reverse order, single
	 * SYN_REPORT. The compositor sees the "Alt released" edge, which
	 * commits the selection for cycling shortcuts. Folding this into
	 * the same frame as phase 2 would skip the cycle entirely. */
	emit_event(fd, EV_KEY, key, 0);
	for (int i = n_mods - 1; i >= 0; i--)
		emit_event(fd, EV_KEY, mods[i], 0);
	emit_event(fd, EV_SYN, SYN_REPORT, 0);
}

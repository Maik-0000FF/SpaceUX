/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * led_linux - hidraw backend for led.h.
 *
 * Walks /sys/class/hidraw/, reads each device's uevent file, and
 * opens the first one whose HID_ID string matches a known SpaceMouse.
 *
 * The match is split by VID for accuracy reasons. 0x046D is
 * Logitech's generic VID, shared with every mouse and keyboard the
 * company ships — a vendor-only allowlist would let our LED writes
 * land on whatever Logitech HID happens to be plugged in (smoke
 * testing caught an MX Master 3S being matched and silently ignoring
 * the report). For 0x046D we therefore allowlist the specific PIDs
 * that 3Dconnexion ever licensed under Logitech relabelling, mirror
 * of the udev-rule PID list. 0x256F is 3Dconnexion's own VID and
 * exclusive to SpaceMouse-family pucks, so a vendor-wide match there
 * is safe and saves enumerating every PID.
 *
 * If a future model rejects the (ID 0x04, one boolean byte) report
 * shape, swap that PID over to a per-model branch — but every product
 * shipped to date accepts it.
 */
#define _GNU_SOURCE
#include "led.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* HID_ID lines look like "HID_ID=0003:0000046D:0000C626"
 * (bus:vendor:product, hex uppercase, zero-padded).
 *
 * Vendor-only match would catch unrelated devices: 0x046D is the
 * generic Logitech VID, shared with every mouse and keyboard the
 * company ships. We pin the full VID:PID for each
 * Logitech-relabelled SpaceMouse model (the public list maintained
 * by spacenavd and the udev rules in the reference project).
 * 3Dconnexion's own VID (0x256F) is exclusive to SpaceMouse-family
 * pucks, so the trailing colon match accepts any product under it
 * without enumerating every PID. */
static const char *DEVICE_PATTERNS[] = {
	"0000046D:0000C603", /* SpaceTraveler */
	"0000046D:0000C605", /* CadMan */
	"0000046D:0000C606", /* SpaceMouse Classic */
	"0000046D:0000C621", /* SpaceBall 5000 */
	"0000046D:0000C623", /* SpaceTraveler / SpaceNavigator NB */
	"0000046D:0000C625", /* SpacePilot */
	"0000046D:0000C626", /* SpaceNavigator */
	"0000046D:0000C627", /* SpaceExplorer */
	"0000046D:0000C628", /* SpaceNavigator NB */
	"0000046D:0000C629", /* SpacePilot Pro */
	"0000046D:0000C62B", /* SpaceMouse Pro */
	"0000256F:",	     /* Any 3Dconnexion product on the dedicated VID */
	NULL,
};

static int uevent_is_spacemouse(const char *path)
{
	FILE *f = fopen(path, "r");
	if (!f)
		return 0;
	char buf[4096];
	size_t n = fread(buf, 1, sizeof(buf) - 1, f);
	fclose(f);
	buf[n] = '\0';
	for (const char **p = DEVICE_PATTERNS; *p; p++)
		if (strstr(buf, *p))
			return 1;
	return 0;
}

int led_open(void)
{
	DIR *d = opendir("/sys/class/hidraw");
	if (!d) {
		fprintf(stderr, "spaceux-daemon: /sys/class/hidraw unavailable, LED control off\n");
		return -1;
	}

	int found = -1;
	struct dirent *ent;
	while ((ent = readdir(d)) != NULL) {
		if (strncmp(ent->d_name, "hidraw", 6) != 0)
			continue;
		/* d_name's worst-case length is NAME_MAX (255); pad both
		 * buffers so gcc's -Wformat-truncation can't see a
		 * theoretical overflow. Real hidraw names are short
		 * ("hidraw0", "hidraw99", ...) so this is comfort, not
		 * substance. */
		char uevent_path[320];
		snprintf(uevent_path, sizeof(uevent_path), "/sys/class/hidraw/%s/device/uevent",
			 ent->d_name);
		if (!uevent_is_spacemouse(uevent_path))
			continue;
		char dev_path[320];
		snprintf(dev_path, sizeof(dev_path), "/dev/%s", ent->d_name);
		int fd = open(dev_path, O_WRONLY | O_NONBLOCK | O_CLOEXEC);
		if (fd >= 0) {
			fprintf(stderr, "spaceux-daemon: LED control via %s\n", dev_path);
			found = fd;
			break;
		}
		fprintf(stderr,
			"spaceux-daemon: %s found but cannot open (%s); "
			"check the hidraw udev rule and input-group membership\n",
			dev_path, strerror(errno));
	}
	closedir(d);
	if (found < 0)
		fprintf(stderr, "spaceux-daemon: no SpaceMouse hidraw node, LED control off\n");
	return found;
}

void led_close(int fd)
{
	if (fd >= 0)
		close(fd);
}

void led_set(int fd, int on)
{
	if (fd < 0)
		return;
	/* Report ID 0x04 + 1 payload byte; this is the same shape every
	 * SpaceNavigator-family puck accepts. write() failures (e.g. the
	 * device just got unplugged) are intentionally swallowed — a
	 * dropped LED transition is far cheaper than killing the daemon. */
	unsigned char report[2] = {0x04, on ? 0x01 : 0x00};
	(void)!write(fd, report, sizeof(report));
}

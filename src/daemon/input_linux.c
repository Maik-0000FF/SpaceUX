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
/* The evdev nodes of the currently-open puck. A USB-cable device fills a
 * single slot (axes + buttons on one node); a split device, e.g. a
 * wireless receiver, fills the axis node first, then its button node(s).
 * Empty (g_nfds == 0) when nothing is open. Every fd here belongs to the
 * same physical SpaceMouse and nothing else, so grabbing them never
 * touches an unrelated mouse or keyboard. */
static int g_fds[SPACEUX_INPUT_MAX_FDS];
static int g_nfds;
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

static int vid_ok(int fd)
{
	struct input_id id;
	if (ioctl(fd, EVIOCGID, &id) < 0)
		return 0;
	return vid_matches(id.vendor);
}

/* True when the device exposes the absolute axes a puck reports.
 * EVIOCGBIT with EV_ABS returns a bitmap; we need at least ABS_X. This is
 * the test that keeps ordinary pointers out: mice report relative motion
 * (REL_*) and keyboards report keys, neither has ABS_X, so a
 * Logitech-branded mouse sharing vendor 0x046d with older pucks never
 * passes here. */
static int has_abs_x(int fd)
{
	unsigned long absbits[(ABS_MAX / (8 * sizeof(unsigned long))) + 1];
	memset(absbits, 0, sizeof(absbits));
	if (ioctl(fd, EVIOCGBIT(EV_ABS, sizeof(absbits)), absbits) < 0)
		return 0;
	const unsigned long wb = 8 * sizeof(unsigned long);
	return (absbits[ABS_X / wb] & (1UL << (ABS_X % wb))) != 0;
}

/* Derive a key for the physical device a node belongs to, so a split
 * puck's button node is matched to its own axis node and to nothing else.
 * EVIOCGPHYS reports the topology path, e.g. "usb-0000:00:14.0-1.2/input0";
 * sibling interfaces of one device share everything up to the "/inputN"
 * suffix, so we key on that prefix. Returns 1 and fills buf on success, 0
 * when the kernel reports no phys — in which case the caller attaches no
 * sibling and stays on the single combined node, never risking an
 * unrelated device. */
static int device_group_key(int fd, char *buf, size_t len)
{
	char phys[128];
	phys[0] = '\0';
	if (ioctl(fd, EVIOCGPHYS(sizeof(phys)), phys) < 0 || phys[0] == '\0')
		return 0;
	phys[sizeof(phys) - 1] = '\0';
	char *sep = strstr(phys, "/input");
	if (sep)
		*sep = '\0';
	snprintf(buf, len, "%s", phys);
	return buf[0] != '\0';
}

int input_open(void)
{
	/* Start from a clean slate. input_close closes any handles a prior
	 * open might have left and zeroes the axis/identity state, so a scan
	 * that finds nothing leaves a clean "no device" picture. The daemon
	 * only calls input_open with no device open, but closing here keeps
	 * that invariant local and rules out an fd leak if it ever changes. */
	input_close();

	DIR *d = opendir("/dev/input");
	if (!d)
		return 0;

	/* d_name is bounded by NAME_MAX on Linux (255). The "/dev/input/"
	 * prefix is 11 chars, so 280 covers any filename plus the prefix
	 * plus a NUL — wide enough to drop the format-truncation warning. */
	char axis_path[280] = {0};
	char group[128] = {0};
	int have_group = 0;

	/* Pass 1: the axis node. It defines the device — a node that both
	 * matches a SpaceMouse vendor and exposes ABS_X. The ABS_X
	 * requirement is what keeps mice and keyboards out. */
	struct dirent *ent;
	while ((ent = readdir(d)) != NULL) {
		if (strncmp(ent->d_name, "event", 5) != 0)
			continue;
		char path[280];
		snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
		int fd = open(path, O_RDONLY | O_NONBLOCK);
		if (fd < 0)
			continue;
		if (vid_ok(fd) && has_abs_x(fd)) {
			g_fds[g_nfds++] = fd;
			snprintf(axis_path, sizeof(axis_path), "%s", path);
			have_group = device_group_key(fd, group, sizeof(group));
			capture_identity(fd);
			g_button_count = discover_button_count(fd);
			break;
		}
		close(fd);
	}

	if (g_nfds == 0) {
		closedir(d);
		return 0;
	}

	/* Pass 2: sibling button node(s), only when the axis node carries no
	 * buttons itself (a USB-cable puck is one combined node and needs
	 * none). A candidate must match the SpaceMouse vendor, expose
	 * SpaceMouse buttons (BTN_0..9 / BTN_TRIGGER_HAPPY*, never the
	 * BTN_MOUSE a mouse reports), and belong to the *same physical
	 * device* as the axis node. That phys-group match is the hard
	 * guarantee no unrelated device is opened or later grabbed; with no
	 * phys to compare we attach nothing and keep the single node. Real
	 * pucks expose one button node, but we add every match up to the cap
	 * rather than stop early, so a device that spread buttons over more
	 * than one sibling would still be read in full. */
	if (g_button_count == 0 && have_group) {
		rewinddir(d);
		while ((ent = readdir(d)) != NULL && g_nfds < SPACEUX_INPUT_MAX_FDS) {
			if (strncmp(ent->d_name, "event", 5) != 0)
				continue;
			char path[280];
			snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
			if (strcmp(path, axis_path) == 0)
				continue;
			int fd = open(path, O_RDONLY | O_NONBLOCK);
			if (fd < 0)
				continue;
			if (!vid_ok(fd)) {
				close(fd);
				continue;
			}
			int btns = discover_button_count(fd);
			char g2[128];
			if (btns > 0 && device_group_key(fd, g2, sizeof(g2)) &&
			    strcmp(g2, group) == 0) {
				g_fds[g_nfds++] = fd;
				g_button_count = btns;
			} else {
				close(fd);
			}
		}
	}

	closedir(d);
	return g_nfds;
}

int input_get_fds(int *out, int max)
{
	int n = g_nfds < max ? g_nfds : max;
	for (int i = 0; i < n; i++)
		out[i] = g_fds[i];
	return n;
}

void input_close(void)
{
	for (int i = 0; i < g_nfds; i++)
		if (g_fds[i] >= 0)
			close(g_fds[i]);
	g_nfds = 0;
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

int input_set_grab(int grab)
{
	if (g_nfds == 0)
		return -1;
	/* EVIOCGRAB takes the grab flag as the ioctl argument: non-zero grabs
	 * the node exclusively, zero releases it. The kernel also drops the
	 * grab when the fd closes, so the daemon never has to release on
	 * unplug, only on an explicit RELEASE. We apply this to every node of
	 * the puck (axes and, on a split device, buttons) so an open pie hides
	 * both from other readers; only these puck nodes are ever grabbed,
	 * never an unrelated device. */
	if (!grab) {
		/* Release: best-effort across all nodes. A failed ungrab keeps the
		 * caller's grab_applied set so its next reconcile retries, and the
		 * kernel releases the node anyway once the fd closes. */
		int rc = 0;
		for (int i = 0; i < g_nfds; i++)
			if (ioctl(g_fds[i], EVIOCGRAB, 0) < 0)
				rc = -1;
		return rc;
	}
	/* Grab: all-or-nothing. If any node can't be grabbed, roll back the
	 * ones already taken and report failure, so we never leave a node
	 * grabbed while the caller believes it holds nothing (which would
	 * strand that node grabbed until close). The caller treats -1 as "not
	 * grabbed" and retries on its next reconcile. */
	for (int i = 0; i < g_nfds; i++) {
		if (ioctl(g_fds[i], EVIOCGRAB, 1) < 0) {
			for (int j = 0; j < i; j++)
				ioctl(g_fds[j], EVIOCGRAB, 0);
			return -1;
		}
	}
	return 0;
}

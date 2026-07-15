/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * input_linux - Linux backend for input.h.
 *
 * Reads a 3Dconnexion puck. Two device shapes are handled:
 *
 *   Absolute pucks (the common case) report their 6DOF as EV_ABS on an
 *   evdev node (/dev/input/eventN). We read that node: per-axis deltas are
 *   coalesced until SYN_REPORT, then one full PE_AXES snapshot goes out,
 *   and button transitions are forwarded one-for-one as PE_BUTTON.
 *
 *   Relative pucks: some models/kernels map the 6DOF to EV_REL, so the
 *   device enumerates as a "mouse" (its by-id link ends in -event-mouse).
 *   EV_REL cannot express a return to centre (the kernel drops EV_REL 0),
 *   so an evdev read would leave axes stuck at their last deflection. For
 *   these we instead read the raw hidraw HID reports, which carry every
 *   axis as an absolute signed value including zero. The evdev node is
 *   still opened, but only so the pie's EVIOCGRAB can hide the puck from
 *   other evdev readers (spacenavd, FreeCAD, Blender); axes and buttons
 *   both come from hidraw.
 *
 * So each open device keeps two fd sets: a read set the daemon polls and
 * drains (evdev for absolute pucks, hidraw for relative ones) and a grab
 * set EVIOCGRAB acts on (always the evdev node(s)). For an absolute puck
 * the two sets are identical.
 *
 * The local <linux/input.h> declares ::struct input_event for the
 * kernel's wire format; our higher-level event type is ::struct
 * puck_event so the two never collide.
 */
#define _GNU_SOURCE
#include "input.h"

#include "hid_report.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>

#include <linux/input.h>

/* The relative rotational axes a REL-reporting puck uses (see
 * has_rel_6dof). Canonical kernel values; defined defensively so the build
 * succeeds against older <linux/input.h> headers that predate them. The
 * runtime kernel is what actually reports these bits, independent of the
 * header we compile against. */
#ifndef REL_RX
#define REL_RX 0x03
#endif
#ifndef REL_RY
#define REL_RY 0x04
#endif
#ifndef REL_RZ
#define REL_RZ 0x05
#endif

/* Largest raw HID input report we read in one go. 3Dconnexion pucks send
 * short reports (a report id plus at most six 16-bit axes = 13 bytes, or a
 * button bitmask); 32 is comfortable headroom. */
#define SPACEUX_HID_REPORT_MAX 32

/* VIDs known to ship 3Dconnexion pucks. PID-level filtering happens
 * inside the loop: we accept anything whose VID matches and whose
 * BTN_0..BTN_9 + ABS_X..ABS_RZ (or REL rotational) bits show up. Mirrors
 * the udev device-table convention without depending on a userspace
 * database. */
static const unsigned short SPACEMOUSE_VIDS[] = {0x046d, 0x256f};
static const size_t SPACEMOUSE_VIDS_N = sizeof(SPACEMOUSE_VIDS) / sizeof(SPACEMOUSE_VIDS[0]);

static int g_axis_state[SPACEUX_AXIS_COUNT];
static int g_axis_dirty;
/* 1 when the open puck reports its 6DOF over EV_REL rather than EV_ABS (a
 * puck the kernel maps to relative "mouse" axes; see has_rel_6dof). Selects
 * the hidraw read path over the evdev one. 0 when absolute / none open. */
static int g_axis_relative;

/* All fds owned by the currently-open device, closed together in
 * input_close. g_read_fds is the subset the daemon polls and drains
 * (evdev node(s) for an absolute puck, the hidraw node for a relative one);
 * g_grab_fds is the subset EVIOCGRAB acts on (always the evdev node(s)).
 * Every fd here belongs to the same physical SpaceMouse and nothing else,
 * so grabbing them never touches an unrelated mouse or keyboard. All empty
 * (counts 0) when nothing is open. */
static int g_fds[SPACEUX_INPUT_MAX_FDS];
static int g_nfds;
static int g_read_fds[SPACEUX_INPUT_MAX_FDS];
static int g_n_read;
static int g_grab_fds[SPACEUX_INPUT_MAX_FDS];
static int g_n_grab;

/* HID button state for the hidraw path: the mask last reported by the
 * device, and the mask already surfaced to the daemon as PE_BUTTON
 * transitions. hid_poll emits one bit of their difference per call. */
static uint32_t g_hid_btn_current;
static uint32_t g_hid_btn_emitted;
/* Last axis snapshot emitted on the hidraw path. Unlike EV_ABS (which the
 * kernel only forwards on real change), raw hidraw reports arrive on the
 * device's own cadence, which may repeat an unchanged deflection every
 * frame. We suppress a snapshot identical to the last one so an at-rest
 * puck that keeps streaming doesn't flood clients with the same neutral
 * frame, matching the evdev path's change-gated broadcasts. */
static int g_hid_last_axes[SPACEUX_AXIS_COUNT];

/* Button count of the currently-open device, discovered from its
 * EV_KEY capability bits (0 when no device is open). Lets the editor
 * offer only the buttons the puck actually has, accurate for every
 * model, present and future, with no per-model table to maintain
 * (see #66). Discovered from the evdev node in both modes. */
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
 * over exactly the codes we map to a bnum: BTN_0..BTN_9 (bnum 0..9) and
 * BTN_TRIGGER_HAPPY1..40 (bnum 10..49). The kernel reports the device's
 * real capabilities, so this is the authoritative per-device count without
 * any VID/PID database. Returns 0 on failure.
 *
 * The result is consumed as a contiguous range (buttons 0..count-1), fine
 * because SpaceMice report contiguous button codes. It's clamped to
 * SPACEUX_MAX_BUTTONS: bit b past that cap is never surfaced, so advertising
 * more would promise buttons the reader never delivers. */
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
 * from the device's USB descriptor, untrusted input. Rather than teach
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

/* True when the device exposes the six *relative* axes a puck reports when
 * the kernel maps its 6DOF to EV_REL instead of EV_ABS. Some models/kernels
 * do this, and the device then enumerates as a "mouse" (its by-id link ends
 * in -event-mouse). We key on the three rotational axes REL_RX/REL_RY/REL_RZ:
 * an ordinary mouse exposes REL_X/REL_Y and wheels but never the rotational
 * trio, so this admits a 6DOF puck without ever admitting a Logitech mouse
 * that shares vendor 0x046d, the same guarantee has_abs_x gives on the
 * absolute path. Checked only after vid_ok, never on its own. */
static int has_rel_6dof(int fd)
{
	unsigned long relbits[(REL_MAX / (8 * sizeof(unsigned long))) + 1];
	memset(relbits, 0, sizeof(relbits));
	if (ioctl(fd, EVIOCGBIT(EV_REL, sizeof(relbits)), relbits) < 0)
		return 0;
	const unsigned long wb = 8 * sizeof(unsigned long);
	const int need[] = {REL_RX, REL_RY, REL_RZ};
	for (size_t i = 0; i < sizeof(need) / sizeof(need[0]); i++)
		if (!(relbits[need[i] / wb] & (1UL << (need[i] % wb))))
			return 0;
	return 1;
}

/* Derive a key for the physical device a node belongs to, so a split
 * puck's button node is matched to its own axis node and to nothing else.
 * EVIOCGPHYS reports the topology path, e.g. "usb-0000:00:14.0-1.2/input0";
 * sibling interfaces of one device share everything up to the "/inputN"
 * suffix, so we key on that prefix. Returns 1 and fills buf on success, 0
 * when the kernel reports no phys, in which case the caller attaches no
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

/* Find the hidraw node that belongs to the *same physical device* as an
 * evdev node, so a relative puck is read on its own hidraw and nothing
 * else. An input event node and a hidraw node of one USB HID device both
 * live under the same ".../0003:VVVV:PPPP.NNNN" HID-device directory in
 * sysfs: the event node under ".../<hid>/input/inputN/eventM", the hidraw
 * under ".../<hid>/hidraw/hidrawK". We resolve the event node's device
 * link, cut it back to the HID-device directory, then pick the hidraw
 * whose own device link resolves to that same directory. Matching the full
 * topology (not just VID/PID) keeps two identical pucks apart. Returns 1
 * and fills out_dev ("/dev/hidrawK") on success, 0 if nothing correlates. */
static int find_hidraw_for_evdev(const char *event_name, char *out_dev, size_t out_len)
{
	char link[PATH_MAX];
	snprintf(link, sizeof(link), "/sys/class/input/%s/device", event_name);
	char hid_dir[PATH_MAX];
	if (!realpath(link, hid_dir))
		return 0;
	char *cut = strstr(hid_dir, "/input/");
	if (!cut)
		return 0;
	*cut = '\0'; /* hid_dir is now the shared HID-device directory */

	DIR *d = opendir("/sys/class/hidraw");
	if (!d)
		return 0;
	int found = 0;
	struct dirent *ent;
	while ((ent = readdir(d)) != NULL) {
		if (strncmp(ent->d_name, "hidraw", 6) != 0)
			continue;
		char hlink[PATH_MAX];
		snprintf(hlink, sizeof(hlink), "/sys/class/hidraw/%s/device", ent->d_name);
		char hreal[PATH_MAX];
		if (!realpath(hlink, hreal))
			continue;
		if (strcmp(hreal, hid_dir) == 0) {
			snprintf(out_dev, out_len, "/dev/%s", ent->d_name);
			found = 1;
			break;
		}
	}
	closedir(d);
	return found;
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
	 * plus a NUL, wide enough to drop the format-truncation warning. */
	char axis_path[280] = {0};
	char axis_name[NAME_MAX + 1] = {0};
	char group[128] = {0};
	int have_group = 0;

	/* Pass 1: the axis node. It defines the device, a node that matches a
	 * SpaceMouse vendor and exposes the 6DOF, either as absolute axes
	 * (ABS_X, the common case) or as relative axes (has_rel_6dof, for pucks
	 * the kernel maps to EV_REL). Both tests reject mice and keyboards, so
	 * an unrelated 0x046d Logitech device never passes. ABS wins when a node
	 * somehow offers both, keeping the well-trodden path the default. The
	 * evdev node is always owned and grabbable; whether it is also *read*
	 * depends on the mode, decided below. */
	struct dirent *ent;
	while ((ent = readdir(d)) != NULL) {
		if (strncmp(ent->d_name, "event", 5) != 0)
			continue;
		char path[280];
		snprintf(path, sizeof(path), "/dev/input/%s", ent->d_name);
		int fd = open(path, O_RDONLY | O_NONBLOCK);
		if (fd < 0)
			continue;
		if (vid_ok(fd)) {
			int abs_ok = has_abs_x(fd);
			if (abs_ok || has_rel_6dof(fd)) {
				g_fds[g_nfds++] = fd;
				g_grab_fds[g_n_grab++] = fd;
				g_axis_relative = !abs_ok;
				snprintf(axis_path, sizeof(axis_path), "%s", path);
				snprintf(axis_name, sizeof(axis_name), "%s", ent->d_name);
				have_group = device_group_key(fd, group, sizeof(group));
				capture_identity(fd);
				/* Button count comes from the evdev node's EV_KEY bits in both
				 * modes. On the relative path the buttons are then *read* over
				 * hidraw (hid_next_button), so two things must line up with
				 * this count and hold on real hardware: the puck exposes its
				 * buttons as BTN_0../BTN_TRIGGER_HAPPY (not as mouse buttons,
				 * else the count is 0 while hidraw still delivers presses), and
				 * a hidraw button-mask bit index equals the bnum this count
				 * implies. Both match the spacenavd convention; confirm on the
				 * target device. */
				g_button_count = discover_button_count(fd);
				if (abs_ok)
					g_read_fds[g_n_read++] = fd;
				break;
			}
		}
		close(fd);
	}

	if (g_nfds == 0) {
		closedir(d);
		return 0;
	}

	/* Relative puck: read axes and buttons over the correlated hidraw node,
	 * not evdev (EV_REL cannot express a return to centre). The evdev node
	 * stays open for the grab only. If we can't find or open the hidraw
	 * node, the device is unreadable this way, so report "no device" rather
	 * than fall back to the lossy evdev-REL read; the daemon retries and
	 * will pick it up once the node/permission is present. */
	if (g_axis_relative) {
		closedir(d);
		char hidpath[PATH_MAX];
		if (!find_hidraw_for_evdev(axis_name, hidpath, sizeof(hidpath))) {
			fprintf(stderr,
				"spaceux-daemon: relative puck %04x:%04x has no correlated "
				"hidraw node to read; leaving it closed\n",
				g_vendor, g_product);
			input_close();
			return 0;
		}
		int hfd = open(hidpath, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
		if (hfd < 0) {
			fprintf(stderr,
				"spaceux-daemon: cannot read %s (%s); check the hidraw "
				"uaccess rule and input-group membership\n",
				hidpath, strerror(errno));
			input_close();
			return 0;
		}
		g_fds[g_nfds++] = hfd;
		g_read_fds[g_n_read++] = hfd;
		fprintf(stderr, "spaceux-daemon: relative puck, reading over hidraw %s\n", hidpath);
		return g_nfds;
	}

	/* Absolute puck. Pass 2: sibling button node(s), only when the axis
	 * node carries no buttons itself (a USB-cable puck is one combined node
	 * and needs none). A candidate must match the SpaceMouse vendor, expose
	 * SpaceMouse buttons (BTN_0..9 / BTN_TRIGGER_HAPPY*, never the BTN_MOUSE
	 * a mouse reports), and belong to the *same physical device* as the axis
	 * node. That phys-group match is the hard guarantee no unrelated device
	 * is opened or later grabbed; with no phys to compare we attach nothing
	 * and keep the single node. Real pucks expose one button node, but we
	 * add every match up to the cap rather than stop early, so a device that
	 * spread buttons over more than one sibling would still be read in full.
	 * A sibling is both read and grabbed, like the axis node. */
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
				g_read_fds[g_n_read++] = fd;
				g_grab_fds[g_n_grab++] = fd;
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
	int n = g_n_read < max ? g_n_read : max;
	for (int i = 0; i < n; i++)
		out[i] = g_read_fds[i];
	return n;
}

void input_close(void)
{
	for (int i = 0; i < g_nfds; i++)
		if (g_fds[i] >= 0)
			close(g_fds[i]);
	g_nfds = 0;
	g_n_read = 0;
	g_n_grab = 0;
	memset(g_axis_state, 0, sizeof(g_axis_state));
	g_axis_dirty = 0;
	g_axis_relative = 0;
	g_hid_btn_current = 0;
	g_hid_btn_emitted = 0;
	memset(g_hid_last_axes, 0, sizeof(g_hid_last_axes));
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

/* Read one event from an evdev node (absolute puck). Coalesces per-axis
 * EV_ABS deltas until SYN_REPORT, forwards EV_KEY transitions one-for-one.
 * Return contract matches input_poll. */
static int evdev_poll(int fd, struct puck_event *out)
{
	struct input_event ie;
	ssize_t n;
	while ((n = read(fd, &ie, sizeof(ie))) > 0) {
		if (n != sizeof(ie))
			return -1;
		if (ie.type == EV_ABS && ie.code < SPACEUX_AXIS_COUNT) {
			/* Normalise TZ to the convention down = negative Z: the kernel
			 * reports pushing the cap *down* as +ABS_Z, but the whole app
			 * treats TZ- as down/press (schema docs, editor labels, the
			 * default TZ-back gesture), so flip it here at the hardware
			 * boundary (#153). */
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
		return -1; /* EOF, device vanished */
	if (errno == EAGAIN || errno == EWOULDBLOCK)
		return 0;
	return -1;
}

/* Surface the next button transition between the device's current mask and
 * what we've already emitted, one bit per call, low bit first. Returns 1
 * and fills *out when a transition is pending, 0 when the masks agree. */
static int hid_next_button(struct puck_event *out)
{
	uint32_t diff = g_hid_btn_current ^ g_hid_btn_emitted;
	if (!diff)
		return 0;
	int b = __builtin_ctz(diff);
	uint32_t bit = 1u << b;
	/* March the emitted mask one bit toward the current one. */
	g_hid_btn_emitted = (g_hid_btn_emitted & ~bit) | (g_hid_btn_current & bit);
	/* Defensive, not currently reachable: the mask is 32-bit so b <= 31, and
	 * SPACEUX_MAX_BUTTONS is 32, so no bit exceeds the cap today. The guard
	 * keeps a button past the cap from being surfaced should that cap ever be
	 * lowered below the mask width. */
	if (b >= SPACEUX_MAX_BUTTONS)
		return hid_next_button(out);
	out->kind = PE_BUTTON;
	out->bnum = b;
	out->pressed = (int)((g_hid_btn_current >> b) & 1u);
	return 1;
}

/* Read one event from the hidraw node (relative puck). Pending button
 * transitions drain first, one per call; otherwise we read the next report,
 * emitting a full PE_AXES snapshot for an axis report or beginning to drain
 * a button report. Return contract matches input_poll. */
static int hid_poll(int fd, struct puck_event *out)
{
	if (hid_next_button(out))
		return 1;

	unsigned char buf[SPACEUX_HID_REPORT_MAX];
	ssize_t n;
	while ((n = read(fd, buf, sizeof(buf))) > 0) {
		enum hid_report_kind kind =
			hid_report_decode(buf, (int)n, g_axis_state, &g_hid_btn_current);
		if (kind == HID_REPORT_AXES) {
			/* Suppress a snapshot identical to the last one emitted: raw
			 * reports can repeat an unchanged deflection every frame, and
			 * clients only need the changes (matching the evdev path). */
			if (memcmp(g_axis_state, g_hid_last_axes, sizeof(g_axis_state)) == 0)
				continue;
			memcpy(g_hid_last_axes, g_axis_state, sizeof(g_hid_last_axes));
			out->kind = PE_AXES;
			memcpy(out->values, g_axis_state, sizeof(g_axis_state));
			return 1;
		}
		if (kind == HID_REPORT_BUTTONS && hid_next_button(out))
			return 1;
		/* HID_REPORT_NONE, or a button report that changed nothing: keep reading. */
	}
	if (n == 0)
		return -1; /* EOF, device vanished */
	if (errno == EAGAIN || errno == EWOULDBLOCK)
		return 0;
	return -1;
}

int input_poll(int fd, struct puck_event *out)
{
	return g_axis_relative ? hid_poll(fd, out) : evdev_poll(fd, out);
}

int input_set_grab(int grab)
{
	if (g_n_grab == 0)
		return -1;
	/* EVIOCGRAB takes the grab flag as the ioctl argument: non-zero grabs
	 * the node exclusively, zero releases it. The kernel also drops the
	 * grab when the fd closes, so the daemon never has to release on
	 * unplug, only on an explicit RELEASE. We apply this to every evdev node
	 * of the puck (axes and, on a split device, buttons) so an open pie
	 * hides them from other evdev readers; only these puck nodes are ever
	 * grabbed, never an unrelated device. A relative puck is read over
	 * hidraw but still grabbed here on its evdev node: it enumerates as a
	 * "mouse", so without the grab libinput would read that node and drift
	 * the cursor while the pie is open. hidraw consumers are neither grabbed
	 * nor grabbable, exactly as on the absolute path, so nothing regresses. */
	if (!grab) {
		/* Release: best-effort across all nodes. A failed ungrab keeps the
		 * caller's grab_applied set so its next reconcile retries, and the
		 * kernel releases the node anyway once the fd closes. */
		int rc = 0;
		for (int i = 0; i < g_n_grab; i++)
			if (ioctl(g_grab_fds[i], EVIOCGRAB, 0) < 0)
				rc = -1;
		return rc;
	}
	/* Grab: all-or-nothing. If any node can't be grabbed, roll back the
	 * ones already taken and report failure, so we never leave a node
	 * grabbed while the caller believes it holds nothing (which would
	 * strand that node grabbed until close). The caller treats -1 as "not
	 * grabbed" and retries on its next reconcile. */
	for (int i = 0; i < g_n_grab; i++) {
		if (ioctl(g_grab_fds[i], EVIOCGRAB, 1) < 0) {
			for (int j = 0; j < i; j++)
				ioctl(g_grab_fds[j], EVIOCGRAB, 0);
			return -1;
		}
	}
	return 0;
}

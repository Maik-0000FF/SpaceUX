/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * socket - implementation. See socket.h.
 *
 * Every wire-side primitive is routed through ipc.h so the transport
 * (UNIX socket today) can be swapped without touching this file.
 */
#include "socket.h"
#include "inject.h"
#include "ipc.h"
#include "led.h"
#include "protocol.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#if defined(__linux__)
#include <limits.h>
#endif

/* Monotonic time in microseconds. Used as the rate-limit clock so
 * a system clock step (NTP, manual `date`) doesn't suddenly let a
 * client burst through the bucket or starve a legitimate one. */
static long long monotonic_us(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (long long)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}

static void slot_clear(struct sock_client *c)
{
	if (c->fd >= 0)
		ipc_close(c->fd);
	c->fd = -1;
	c->subscriptions = 0;
	c->grabbed = 0;
	c->cmd_len = 0;
	c->peer_pid = -1;
	c->peer_uid = -1;
	c->chord_tokens = 0.0;
	c->chord_refill_us = 0;
	c->chord_drop_count = 0;
	c->chord_drop_log_us = 0;
}

static int slot_alloc(struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		if (s->clients[i].fd < 0)
			return i;
	return -1;
}

int sock_init(struct sock_state *s)
{
	memset(s, 0, sizeof(*s));
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		s->clients[i].fd = -1;
	s->inject_fd = -1;
	s->led_fd = -1;
	return ipc_listener_open(&s->listener);
}

void sock_set_inject_fd(struct sock_state *s, int fd)
{
	s->inject_fd = fd;
}

void sock_set_led_fd(struct sock_state *s, int fd)
{
	s->led_fd = fd;
}

void sock_close(struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		slot_clear(&s->clients[i]);
	ipc_listener_close(&s->listener);
}

/* Resolve the peer binary path via /proc/<pid>/exe on Linux. Best-
 * effort: returns 1 on success with `out` populated, 0 otherwise.
 * macOS/BSD don't have /proc, so the path stays unfilled there and
 * the log line falls back to pid alone.
 *
 * `cap` of 256 covers any realistic peer path. Linux PATH_MAX is
 * 4096 but real binaries live under /usr, /home, etc. and almost
 * never reach 256 bytes; truncating an absurdly-long path to a
 * forensic hint is acceptable. The result is sanitised before
 * return so a peer with a newline in its binary's path can't
 * forge a fake `[sock] accept ...` line via the audit log. */
static int peer_exe_path(int pid, char *out, size_t cap)
{
#if defined(__linux__)
	if (pid <= 0)
		return 0;
	char link[64];
	snprintf(link, sizeof(link), "/proc/%d/exe", pid);
	ssize_t n = readlink(link, out, cap - 1);
	if (n < 0)
		return 0;
	out[n] = '\0';
	/* Sanitise non-printable bytes (anything below space or the
	 * DEL byte) to '?' so a peer can't embed control chars in
	 * their binary's path and split the audit-log line. */
	for (ssize_t i = 0; i < n; i++) {
		unsigned char ch = (unsigned char)out[i];
		if (ch < 0x20 || ch == 0x7f)
			out[i] = '?';
	}
	return 1;
#else
	(void)pid;
	(void)out;
	(void)cap;
	return 0;
#endif
}

int sock_accept(struct sock_state *s)
{
	int fd = ipc_accept(&s->listener);
	if (fd < 0)
		return -1;

	/* Authorization: same UID only. SO_PEERCRED (Linux) and
	 * getpeereid (macOS/BSD) give us the connecting UID
	 * without trusting the peer's word. Cross-UID connects are
	 * dropped before the slot is allocated and logged so a
	 * forensic reader can see who tried. */
	struct ipc_peer peer = {-1, -1, -1};
	if (ipc_peer_credentials(fd, &peer) < 0) {
		fprintf(stderr, "[sock] reject: peer credentials unavailable\n");
		ipc_close(fd);
		return -1;
	}
	/* Use effective UID — that's what SO_PEERCRED reports on the
	 * peer side, so comparing same-to-same keeps the semantics
	 * tight. Identical to getuid() for the non-setuid daemon we
	 * actually ship, but the geteuid path is what the comparison
	 * is conceptually about. */
	uid_t my_uid = geteuid();
	if (peer.uid != (int)my_uid) {
		fprintf(stderr,
			"[sock] reject: cross-UID connect (peer uid=%d pid=%d, daemon uid=%u)\n",
			peer.uid, peer.pid, (unsigned int)my_uid);
		ipc_close(fd);
		return -1;
	}

	int slot = slot_alloc(s);
	if (slot < 0) {
		fprintf(stderr, "[sock] reject: client table full (peer pid=%d)\n", peer.pid);
		ipc_close(fd);
		return -1;
	}
	struct sock_client *c = &s->clients[slot];
	c->fd = fd;
	c->subscriptions = 0;
	c->grabbed = 0;
	c->cmd_len = 0;
	c->peer_pid = peer.pid;
	c->peer_uid = peer.uid;
	/* Bucket starts full so a fresh connection can immediately
	 * fire a small burst — the limit only kicks in once the
	 * client has actually pumped chords. */
	c->chord_tokens = (double)SPACEUX_CHORD_BURST;
	c->chord_refill_us = monotonic_us();

	/* Forensic log: pid + peer binary path so a misbehaving
	 * client can be traced back to its executable. The exe
	 * path is best-effort (only on Linux, only when
	 * /proc/<pid>/exe is readable). */
	char exe[256] = {0};
	if (peer_exe_path(peer.pid, exe, sizeof(exe)))
		fprintf(stderr, "[sock] accept slot=%d pid=%d uid=%d exe=%s\n", slot, peer.pid,
			peer.uid, exe);
	else
		fprintf(stderr, "[sock] accept slot=%d pid=%d uid=%d\n", slot, peer.pid, peer.uid);

	char hello[SPACEUX_EVENT_BUF_SIZE];
	int hlen = protocol_format_hello(hello, sizeof(hello), SPACEUX_AXIS_COUNT,
					 SPACEUX_MAX_BUTTONS, s->inject_fd >= 0, s->led_fd >= 0);
	if (hlen > 0)
		(void)ipc_write(fd, hello, hlen);
	return slot;
}

/* Refill `c->chord_tokens` based on monotonic-clock elapsed time
 * since the previous refill. Cap at SPACEUX_CHORD_BURST so an idle
 * client doesn't accumulate an enormous reserve. Called immediately
 * before every consume — keeping the bucket lazily-refilled means
 * we never have to walk the client array on a timer. */
static void chord_bucket_refill(struct sock_client *c)
{
	long long now = monotonic_us();
	long long elapsed = now - c->chord_refill_us;
	if (elapsed > 0) {
		double add = ((double)elapsed / 1000000.0) * SPACEUX_CHORD_RATE_PER_SEC;
		c->chord_tokens += add;
		if (c->chord_tokens > (double)SPACEUX_CHORD_BURST)
			c->chord_tokens = (double)SPACEUX_CHORD_BURST;
	}
	c->chord_refill_us = now;
}

/* Format the modifier list of a chord into a short text fragment for
 * audit logs. e.g. mods=[29,42] becomes "ctrl+shift" in the renderer's
 * key map, but here we keep it as raw evdev codes so the log stays
 * fast (no codename table lookup) and lossless (any future code is
 * still legible). On buffer pressure the function truncates cleanly
 * — snprintf returns the *would-have-been-written* length, so we
 * clamp explicitly to avoid `off` overshooting `cap` on a partial
 * write of the final mod. */
static void format_mods(const int *mods, int n_mods, char *out, size_t cap)
{
	if (cap == 0)
		return;
	if (n_mods <= 0) {
		snprintf(out, cap, "-");
		return;
	}
	size_t off = 0;
	for (int i = 0; i < n_mods; i++) {
		if (off + 1 >= cap)
			break;
		int w = snprintf(out + off, cap - off, "%s%d", i == 0 ? "" : ",", mods[i]);
		if (w < 0)
			break;
		if ((size_t)w >= cap - off) {
			/* Would have written more than the remaining
			 * buffer holds — snprintf already null-terminated
			 * what it managed to write. Stop here rather than
			 * advancing `off` past `cap`. */
			break;
		}
		off += (size_t)w;
	}
}

/* Apply a parsed command to one client's state. Some commands
 * have side effects (PING replies with PONG, INJECT_CHORD emits
 * keys via the daemon-owned inject fd); the side effect is
 * co-located with the state change for readability. */
static int apply_cmd(struct sock_state *s, int slot, struct sock_client *c, enum protocol_cmd cmd,
		     const struct protocol_chord *chord, int led_on)
{
	switch (cmd) {
	case PROTO_CMD_SUBSCRIBE_AXES:
		c->subscriptions |= PROTO_SUB_AXES;
		return 0;
	case PROTO_CMD_SUBSCRIBE_BUTTONS:
		c->subscriptions |= PROTO_SUB_BUTTONS;
		return 0;
	case PROTO_CMD_SUBSCRIBE_BOTH:
		c->subscriptions |= PROTO_SUB_AXES | PROTO_SUB_BUTTONS;
		return 0;
	case PROTO_CMD_UNSUBSCRIBE:
		c->subscriptions = 0;
		return 0;
	case PROTO_CMD_GRAB:
		c->grabbed = 1;
		return 0;
	case PROTO_CMD_RELEASE:
		c->grabbed = 0;
		return 0;
	case PROTO_CMD_PING:
		return ipc_write(c->fd, "PONG\n", 5) < 0 ? -1 : 0;
	case PROTO_CMD_INJECT_CHORD: {
		/* inject_chord is a no-op when inject_fd is -1, so the
		 * command parses + dispatches successfully even on hosts
		 * where /dev/uinput was unavailable at startup. The
		 * client side learns about the capability from the hello
		 * event's "inject" flag. */
		chord_bucket_refill(c);
		char modbuf[64];
		format_mods(chord->mods, chord->n_mods, modbuf, sizeof(modbuf));
		if (c->chord_tokens < 1.0) {
			/* Rate-limit drop: skip the injection, leave the
			 * slot intact. A misbehaving client gets "nothing
			 * happens" rather than a kicked socket.
			 *
			 * Audit logging is throttled to at most one line
			 * per slot per second — a hostile peer pumping at
			 * IPC speed would otherwise emit thousands of
			 * lines/sec and partially defeat the survivability
			 * goal by flooding stderr/journal. The emitted
			 * line carries the cumulative drop count since the
			 * previous log so no drop is silently lost from
			 * the audit trail. */
			long long now = monotonic_us();
			c->chord_drop_count++;
			if (now - c->chord_drop_log_us >= 1000000LL) {
				fprintf(stderr,
					"[inject] drop (rate-limit) slot=%d pid=%d count=%d "
					"mods=%s key=%d\n",
					slot, c->peer_pid, c->chord_drop_count, modbuf, chord->key);
				c->chord_drop_count = 0;
				c->chord_drop_log_us = now;
			}
			return 0;
		}
		c->chord_tokens -= 1.0;
		fprintf(stderr, "[inject] slot=%d pid=%d mods=%s key=%d\n", slot, c->peer_pid,
			modbuf, chord->key);
		inject_chord(s->inject_fd, chord->mods, chord->n_mods, chord->key);
		return 0;
	}
	case PROTO_CMD_SET_LED:
		/* Symmetric to INJECT_CHORD: no-ops when led_fd is -1,
		 * client side has the hello "led" flag to suppress the
		 * round-trip entirely on capability-less daemons. */
		led_set(s->led_fd, led_on);
		return 0;
	case PROTO_CMD_UNKNOWN:
	default:
		return 0;
	}
}

int sock_handle_client(struct sock_state *s, int slot)
{
	struct sock_client *c = &s->clients[slot];
	if (c->fd < 0)
		return -1;
	for (;;) {
		ssize_t n = ipc_read(c->fd, c->cmd_buf + c->cmd_len,
				     (size_t)((int)sizeof(c->cmd_buf) - c->cmd_len - 1));
		if (n == 0) {
			slot_clear(c);
			return -1;
		}
		if (n < 0) {
			if (errno == EAGAIN || errno == EWOULDBLOCK)
				return 0;
			slot_clear(c);
			return -1;
		}
		c->cmd_len += (int)n;
		c->cmd_buf[c->cmd_len] = '\0';
		/* Process every complete line we have. Anything after the
		 * last newline stays buffered for the next read. */
		for (;;) {
			char *nl = memchr(c->cmd_buf, '\n', c->cmd_len);
			if (!nl)
				break;
			*nl = '\0';
			struct protocol_chord chord;
			int led_on = 0;
			enum protocol_cmd parsed =
				protocol_parse_command(c->cmd_buf, &chord, &led_on);
			if (apply_cmd(s, slot, c, parsed, &chord, led_on) < 0) {
				slot_clear(c);
				return -1;
			}
			int consumed = (int)(nl - c->cmd_buf) + 1;
			int remaining = c->cmd_len - consumed;
			memmove(c->cmd_buf, c->cmd_buf + consumed, remaining);
			c->cmd_len = remaining;
			c->cmd_buf[c->cmd_len] = '\0';
		}
	}
}

void sock_broadcast_axes(struct sock_state *s, const int *values, int n_values)
{
	char buf[SPACEUX_EVENT_BUF_SIZE];
	int len = protocol_format_axes(buf, sizeof(buf), values, n_values);
	if (len <= 0)
		return;
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++) {
		struct sock_client *c = &s->clients[i];
		if (c->fd < 0 || !(c->subscriptions & PROTO_SUB_AXES))
			continue;
		if (ipc_write(c->fd, buf, len) < 0)
			slot_clear(c);
	}
}

void sock_broadcast_button(struct sock_state *s, int bnum, int pressed)
{
	char buf[SPACEUX_EVENT_BUF_SIZE];
	int len = protocol_format_button(buf, sizeof(buf), bnum, pressed);
	if (len <= 0)
		return;
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++) {
		struct sock_client *c = &s->clients[i];
		if (c->fd < 0 || !(c->subscriptions & PROTO_SUB_BUTTONS))
			continue;
		if (ipc_write(c->fd, buf, len) < 0)
			slot_clear(c);
	}
}

int sock_any_grabbed(const struct sock_state *s)
{
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++)
		if (s->clients[i].fd >= 0 && s->clients[i].grabbed)
			return 1;
	return 0;
}

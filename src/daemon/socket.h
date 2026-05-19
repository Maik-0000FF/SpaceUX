/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * socket - daemon-side client multiplexer.
 *
 * The daemon multiplexes multiple clients (Electron UI, debug CLI,
 * future helpers) on one listener. Each client carries its own
 * subscription bitmask; broadcast_axes / broadcast_button walk the
 * client array and skip everyone who hasn't subscribed.
 *
 * Transport (UNIX socket today, named pipe on Windows tomorrow) is
 * fully hidden behind ipc.h. This file only deals with what each
 * client *is* — slot state, subscription mask, GRAB lifecycle —
 * never with how bytes reach it.
 */
#ifndef SPACEUX_SOCKET_H
#define SPACEUX_SOCKET_H

#include "config.h"
#include "ipc.h"

struct sock_client {
	int fd; /* -1 if slot is empty */
	int subscriptions;
	int grabbed; /* this client holds the exclusive grab */
	/* Peer identity captured at sock_accept-time. `peer_pid` is -1
	 * on platforms whose IPC transport doesn't carry the connecting
	 * pid (macOS getpeereid); it's still used as an audit-log hint
	 * so a forensic reader can correlate UID activity. Forensic-
	 * only — the kernel may have reused the pid by the time the
	 * audit log is read, so never trust `peer_pid` as the
	 * authoritative identity of the *current* connection holder. */
	int peer_pid;
	int peer_uid;
	/* INJECT_CHORD leaky-bucket state. `chord_tokens` is the
	 * current fill (0..BURST) as a double for fractional refills;
	 * `chord_refill_us` is the monotonic-clock timestamp of the
	 * last refill so the delta gives us the tokens to add. The
	 * bucket starts full (BURST tokens) so a freshly-connected
	 * client can fire a burst before steady-state kicks in. */
	double chord_tokens;
	long long chord_refill_us;
	/* Drop-log throttle: a hostile client pumping INJECT_CHORD at
	 * IPC speed would otherwise flood stderr/journal with one log
	 * line per dropped chord — the rate limit silences the
	 * injection but not the audit, defeating the "connection
	 * survives" intent. Cap at one drop-log per slot per second;
	 * each emitted line names the count of drops since the
	 * previous one so no information is lost. */
	int chord_drop_count;
	long long chord_drop_log_us;
	char cmd_buf[SPACEUX_CMD_BUF_SIZE];
	int cmd_len;
};

struct sock_state {
	struct ipc_listener listener;
	struct sock_client clients[SPACEUX_MAX_CLIENTS];
	/* uinput fd owned by the daemon's inject layer. -1 if injection
	 * is unavailable (open of /dev/uinput failed at startup); a
	 * client that sends INJECT_CHORD then sees the command parse
	 * successfully but inject_chord no-ops, which is the same
	 * fail-soft behaviour the old ydotool path had when ydotoold
	 * wasn't running. */
	int inject_fd;
	/* hidraw fd owned by the daemon's LED layer. -1 if LED control
	 * is unavailable (no SpaceMouse hidraw node, or permission
	 * denied). SET_LED commands parse successfully but led_set
	 * no-ops; the client side checks the hello event's "led" flag
	 * to suppress the round-trip entirely when it's known dead. */
	int led_fd;
};

/* Bind a UNIX socket at /run/user/<uid>/spaceux.sock and start
 * listening. Returns 0 on success, -1 on error. The state struct
 * must outlive every other call. */
int sock_init(struct sock_state *s);

/* Tear down — closes every client and unlinks the socket file. */
void sock_close(struct sock_state *s);

/* Accept any pending connection on listen_fd. Sends the welcome
 * hello message to the new client. Returns the new client slot
 * index, or -1 if the table is full / accept failed. */
int sock_accept(struct sock_state *s);

/* Drain command bytes from one client and dispatch any complete
 * lines through protocol_parse_command. Returns 0 on success, -1
 * if the client closed or errored (caller closes the slot). */
int sock_handle_client(struct sock_state *s, int slot);

/* Push an axes snapshot to every client that has the axes
 * subscription bit set. Failed writes close the offending client. */
void sock_broadcast_axes(struct sock_state *s, const int *values, int n_values);

/* Push a single button transition to every subscribed client. */
void sock_broadcast_button(struct sock_state *s, int bnum, int pressed);

/* Wire the daemon's inject layer fd into the dispatch state. Called
 * once at startup after inject_open(); -1 disables INJECT_CHORD
 * handling but leaves the rest of the protocol working. */
void sock_set_inject_fd(struct sock_state *s, int fd);

/* Same idea for the LED layer: wire led_open's fd into dispatch.
 * -1 disables SET_LED handling. */
void sock_set_led_fd(struct sock_state *s, int fd);

/* Returns 1 if any client currently holds the GRAB. */
int sock_any_grabbed(const struct sock_state *s);

#endif /* SPACEUX_SOCKET_H */

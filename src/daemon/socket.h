/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * socket - UNIX domain socket server for the daemon.
 *
 * The daemon multiplexes multiple clients (Electron UI, debug CLI,
 * future helpers) on one listener. Each client carries its own
 * subscription bitmask; broadcast_axes / broadcast_button walk the
 * client array and skip everyone who hasn't subscribed.
 */
#ifndef SPACEUX_SOCKET_H
#define SPACEUX_SOCKET_H

#include "config.h"

struct sock_client {
	int fd; /* -1 if slot is empty */
	int subscriptions;
	int grabbed; /* this client holds the exclusive grab */
	char cmd_buf[SPACEUX_CMD_BUF_SIZE];
	int cmd_len;
};

/* sun_path on Linux is 108 bytes; sizing this to match keeps the
 * compiler quiet about format-truncation in sock_init. */
#define SPACEUX_SOCK_PATH_MAX 108

struct sock_state {
	int listen_fd;
	char path[SPACEUX_SOCK_PATH_MAX];
	struct sock_client clients[SPACEUX_MAX_CLIENTS];
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

/* Returns 1 if any client currently holds the GRAB. */
int sock_any_grabbed(const struct sock_state *s);

#endif /* SPACEUX_SOCKET_H */

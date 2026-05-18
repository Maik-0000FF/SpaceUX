/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * daemon - main entry point.
 *
 * Single poll() loop that watches the kernel input fd, the UNIX
 * socket listener, and every connected client. Events from the puck
 * are broadcast to subscribed clients as JSON-Lines; the GRAB
 * mechanism is reserved for future action-suppression logic (today
 * the daemon emits events regardless of grab state — the renderer
 * is the only thing that consumes them, so there's nothing to
 * suppress yet).
 */
#define _GNU_SOURCE

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "config.h"
#include "input.h"
#include "socket.h"

static volatile sig_atomic_t g_running = 1;

static void on_sigterm(int sig)
{
	(void)sig;
	g_running = 0;
}

static long long time_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

/* Build the pollfd array fresh each iteration. The slot count is
 * tiny (1 listener + 1 puck + up to MAX_CLIENTS) so the rebuild
 * cost is negligible compared to a stable-slot tracker. */
static int build_pollfds(struct pollfd *fds, int input_fd, const struct sock_state *sock,
			 int *input_idx, int *listen_idx, int *client_indices)
{
	int n = 0;
	*input_idx = -1;
	*listen_idx = -1;

	if (input_fd >= 0) {
		fds[n].fd = input_fd;
		fds[n].events = POLLIN;
		*input_idx = n;
		n++;
	}
	if (sock->listen_fd >= 0) {
		fds[n].fd = sock->listen_fd;
		fds[n].events = POLLIN;
		*listen_idx = n;
		n++;
	}
	for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++) {
		if (sock->clients[i].fd < 0) {
			client_indices[i] = -1;
			continue;
		}
		fds[n].fd = sock->clients[i].fd;
		fds[n].events = POLLIN;
		client_indices[i] = n;
		n++;
	}
	return n;
}

int main(void)
{
	struct sigaction sa;
	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = on_sigterm;
	sigaction(SIGTERM, &sa, NULL);
	sigaction(SIGINT, &sa, NULL);

	struct sock_state sock;
	if (sock_init(&sock) < 0) {
		fprintf(stderr, "spaceux-daemon: socket init failed\n");
		return 1;
	}
	fprintf(stderr, "spaceux-daemon: listening on %s\n", sock.path);

	int input_fd = input_open();
	long long last_input_retry = time_ms();
	if (input_fd < 0)
		fprintf(stderr, "spaceux-daemon: no SpaceMouse detected yet, will retry\n");

	struct pollfd fds[2 + SPACEUX_MAX_CLIENTS];
	int input_idx = -1;
	int listen_idx = -1;
	int client_indices[SPACEUX_MAX_CLIENTS];

	while (g_running) {
		int nfds = build_pollfds(fds, input_fd, &sock, &input_idx, &listen_idx,
					 client_indices);
		int rc = poll(fds, nfds, SPACEUX_POLL_TIMEOUT_MS);
		if (rc < 0) {
			if (errno == EINTR)
				continue;
			break;
		}

		/* Kernel input. POLLHUP or read errors trigger a close-
		 * and-retry — the device may have been unplugged. */
		if (input_idx >= 0 && fds[input_idx].revents & (POLLIN | POLLHUP | POLLERR)) {
			struct puck_event ev;
			int r;
			while ((r = input_poll(input_fd, &ev)) > 0) {
				if (ev.kind == PE_AXES)
					sock_broadcast_axes(&sock, ev.values, SPACEUX_AXIS_COUNT);
				else if (ev.kind == PE_BUTTON)
					sock_broadcast_button(&sock, ev.bnum, ev.pressed);
			}
			if (r < 0) {
				input_close(input_fd);
				input_fd = -1;
				last_input_retry = time_ms();
				fprintf(stderr, "spaceux-daemon: input device gone, retrying\n");
			}
		}

		if (input_fd < 0) {
			long long now = time_ms();
			if (now - last_input_retry >= SPACEUX_INPUT_RETRY_MS) {
				last_input_retry = now;
				input_fd = input_open();
				if (input_fd >= 0)
					fprintf(stderr, "spaceux-daemon: input device reopened\n");
			}
		}

		/* Listener. Accept everything pending — accept4 returns
		 * -1/EAGAIN once the queue is drained. */
		if (listen_idx >= 0 && fds[listen_idx].revents & POLLIN) {
			while (sock_accept(&sock) >= 0) {
			}
		}

		/* Clients. */
		for (int i = 0; i < SPACEUX_MAX_CLIENTS; i++) {
			int idx = client_indices[i];
			if (idx < 0)
				continue;
			if (fds[idx].revents & (POLLIN | POLLHUP | POLLERR))
				(void)sock_handle_client(&sock, i);
		}
	}

	fprintf(stderr, "spaceux-daemon: shutting down\n");
	if (input_fd >= 0)
		input_close(input_fd);
	sock_close(&sock);
	return 0;
}

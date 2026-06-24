/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * daemon - main entry point.
 *
 * Single poll() loop that watches the kernel input fd, the UNIX
 * socket listener, and every connected client. Events from the puck
 * are broadcast to subscribed clients as JSON-Lines; while any client
 * holds a GRAB the loop also takes an exclusive EVIOCGRAB on the input
 * fd, so other readers (spacenavd, FreeCAD) see nothing for the
 * duration the pie is open (#327). The grab is reconciled against
 * sock_any_grabbed() each iteration, so a RELEASE or a client
 * disconnect drops it, but the release is deferred until the puck
 * settles back to neutral (or a safety timeout) so its residual
 * deflection doesn't leak into the underlying app.
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
#include "inject.h"
#include "input.h"
#include "led.h"
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

/* True when every axis sits within the neutral band, i.e. the puck has
 * sprung back to centre. Gates the deferred grab release (#327) so the
 * device only returns to other apps once nothing is deflected. */
static int axes_neutral(const int *axes)
{
	for (int i = 0; i < SPACEUX_AXIS_COUNT; i++) {
		int v = axes[i] < 0 ? -axes[i] : axes[i];
		if (v > SPACEUX_GRAB_NEUTRAL_BAND)
			return 0;
	}
	return 1;
}

/* Build the pollfd array fresh each iteration. The slot count is
 * tiny (1 listener + up to INPUT_MAX_FDS puck nodes + up to MAX_CLIENTS)
 * so the rebuild cost is negligible compared to a stable-slot tracker.
 * The puck nodes always occupy the first *input_n slots, so the caller
 * scans fds[0 .. input_n-1] for device input. */
static int build_pollfds(struct pollfd *fds, const struct sock_state *sock, int *input_n,
			 int *listen_idx, int *client_indices)
{
	int n = 0;
	*listen_idx = -1;

	int ifds[SPACEUX_INPUT_MAX_FDS];
	int in = input_get_fds(ifds, SPACEUX_INPUT_MAX_FDS);
	for (int i = 0; i < in; i++) {
		fds[n].fd = ifds[i];
		fds[n].events = POLLIN;
		n++;
	}
	*input_n = in;

	if (sock->listener.fd >= 0) {
		fds[n].fd = sock->listener.fd;
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

/* Fetch the open device's identity, advertise it to clients, and return
 * it so the caller can log without a second fetch. Called at startup and
 * on every (un)plug; sock_set_device only broadcasts when the identity
 * actually changes, so calling it unconditionally is fine. */
static struct input_device_info publish_device(struct sock_state *s)
{
	struct input_device_info dev;
	input_device_info(&dev);
	sock_set_device(s, &dev);
	return dev;
}

int main(void)
{
	struct sigaction sa;
	memset(&sa, 0, sizeof(sa));
	sa.sa_handler = on_sigterm;
	sigaction(SIGTERM, &sa, NULL);
	sigaction(SIGINT, &sa, NULL);

	struct sock_state sock;
	int sock_rc = sock_init(&sock);
	if (sock_rc == IPC_LISTENER_IN_USE) {
		/* Another daemon already holds the socket: exit cleanly (0, not an
		 * error from the launcher's view) instead of stealing it. */
		fprintf(stderr, "spaceux-daemon: already running, exiting\n");
		return 0;
	}
	if (sock_rc < 0) {
		fprintf(stderr, "spaceux-daemon: socket init failed\n");
		return 1;
	}
	fprintf(stderr, "spaceux-daemon: listening on %s\n", sock.listener.path);

	/* Key-injection is best-effort: a daemon without /dev/uinput
	 * access keeps the rest of its job (puck reading + broadcast)
	 * and INJECT_CHORD commands silently no-op via inject_chord's
	 * negative-fd guard. */
	int inject_fd = inject_open();
	sock_set_inject_fd(&sock, inject_fd);
	if (inject_fd >= 0)
		fprintf(stderr, "spaceux-daemon: key injection ready\n");

	/* Relative pointer device for desktop-mode scroll (#199). Best-effort
	 * like the keyboard: a failed open just disables INJECT_SCROLL, the
	 * rest of the daemon keeps working. */
	int inject_ptr_fd = inject_pointer_open();
	sock_set_inject_ptr_fd(&sock, inject_ptr_fd);
	if (inject_ptr_fd >= 0)
		fprintf(stderr, "spaceux-daemon: pointer (scroll) injection ready\n");

	/* LED control is also best-effort. led_open scans /sys/class/hidraw
	 * for a SpaceMouse node; if nothing matches (no puck plugged in,
	 * or no hidraw udev rule yet) the daemon just leaves the LED in
	 * its hardware-default state and SET_LED no-ops. The hello event
	 * advertises capability so clients can stop sending. Make sure
	 * the LED starts dark so the open-overlay state is consistent
	 * regardless of what the hardware did at power-on. */
	int led_fd = led_open();
	sock_set_led_fd(&sock, led_fd);
	led_set(led_fd, 0);

	/* Whether a puck is currently open. input_open returns the number of
	 * evdev nodes it claimed (1 combined, or 2 when a device splits axes
	 * and buttons); we only need the boolean "have a device" here and
	 * fetch the actual fds via input_get_fds when building the poll set. */
	int input_active = input_open() > 0;
	/* The grab currently applied to the open nodes. Freshly opened fds are
	 * never grabbed (the kernel releases on close), so this resets to 0
	 * alongside every input_open/input_close. The end-of-loop reconcile
	 * drives it toward sock_any_grabbed(). */
	int grab_applied = 0;
	/* Latest axes snapshot, used to defer the grab release until the puck
	 * settles to neutral (#327). Zeros = neutral, so a release before any
	 * movement goes through immediately. */
	int last_axes[SPACEUX_AXIS_COUNT] = {0};
	/* Monotonic deadline (ms) for a pending deferred release; 0 = none
	 * pending. Bounds how long a never-settling puck holds the grab. */
	long long grab_release_deadline = 0;
	/* True once we've logged the current EVIOCGRAB failure so the retry
	 * loop doesn't spam syslog; cleared on the next success. */
	int grab_fail_logged = 0;
	long long last_input_retry = time_ms();
	/* input_device_info reports zeros when no device opened, so no guard. */
	publish_device(&sock);
	if (!input_active)
		fprintf(stderr, "spaceux-daemon: no SpaceMouse detected yet, will retry\n");

	struct pollfd fds[SPACEUX_INPUT_MAX_FDS + 1 + SPACEUX_MAX_CLIENTS];
	int input_n = 0;
	int listen_idx = -1;
	int client_indices[SPACEUX_MAX_CLIENTS];

	while (g_running) {
		int nfds = build_pollfds(fds, &sock, &input_n, &listen_idx, client_indices);
		int rc = poll(fds, nfds, SPACEUX_POLL_TIMEOUT_MS);
		if (rc < 0) {
			if (errno == EINTR)
				continue;
			break;
		}

		/* Kernel input. The puck occupies the first input_n poll slots
		 * (one combined node, or an axis node plus a button node on a
		 * split device). Drain every ready slot; POLLHUP or a read error
		 * on any of them means the device vanished — they all belong to
		 * the same physical puck — so we tear the whole set down and
		 * retry. */
		int device_gone = 0;
		for (int i = 0; i < input_n; i++) {
			if (!(fds[i].revents & (POLLIN | POLLHUP | POLLERR)))
				continue;
			struct puck_event ev;
			int r;
			while ((r = input_poll(fds[i].fd, &ev)) > 0) {
				if (ev.kind == PE_AXES) {
					/* Track the live deflection so the grab-release
					 * reconcile can wait for the puck to settle (#327). */
					memcpy(last_axes, ev.values, sizeof(last_axes));
					sock_broadcast_axes(&sock, ev.values, SPACEUX_AXIS_COUNT);
				} else if (ev.kind == PE_BUTTON) {
					sock_broadcast_button(&sock, ev.bnum, ev.pressed);
				}
			}
			if (r < 0)
				device_gone = 1;
		}
		if (device_gone) {
			input_close();
			input_active = 0;
			/* The grab died with the fds. If a client still holds it,
			 * the end-of-loop reconcile re-applies once the device
			 * comes back. Drop any pending deferred release and the
			 * stale deflection so the fresh device starts from neutral. */
			grab_applied = 0;
			grab_release_deadline = 0;
			grab_fail_logged = 0;
			memset(last_axes, 0, sizeof(last_axes));
			last_input_retry = time_ms();
			/* Device unplugged: input_close zeroed the identity, so
			 * this advertises "none" to clients connecting before
			 * the replug (and pushes the change to existing ones). */
			publish_device(&sock);
			fprintf(stderr, "spaceux-daemon: input device gone, retrying\n");
		}

		if (!input_active) {
			long long now = time_ms();
			if (now - last_input_retry >= SPACEUX_INPUT_RETRY_MS) {
				last_input_retry = now;
				input_active = input_open() > 0;
				if (input_active) {
					/* Swapped/replugged puck: advertise the new
					 * device's identity (count + VID/PID/name) so
					 * clients re-clamp and re-pick their profile. */
					struct input_device_info dev = publish_device(&sock);
					fprintf(stderr,
						"spaceux-daemon: input device reopened: %s "
						"(%04x:%04x)\n",
						dev.name[0] ? dev.name : "?", dev.vendor,
						dev.product);
				}
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

		/* Reconcile the kernel grab with client intent. GRAB/RELEASE
		 * commands and disconnects (a crashed client's slot is cleared
		 * above) all land before this point, so one pass here covers
		 * every transition. The ioctl only fires on an actual change;
		 * an open pie costs nothing per idle iteration. */
		int want = sock_any_grabbed(&sock);
		if (input_active) {
			if (want) {
				/* Grab requested: take it immediately so an opening
				 * pie loses no movement, and cancel any pending
				 * deferred release (e.g. a quick reopen). */
				grab_release_deadline = 0;
				if (!grab_applied) {
					if (input_set_grab(1) == 0) {
						grab_applied = 1;
						grab_fail_logged = 0;
					} else if (!grab_fail_logged) {
						/* Only flip grab_applied on success, so the next
						 * reconcile retries (a transient EBUSY, e.g. another
						 * process grabbed first, then self-heals). Until it
						 * succeeds the puck still reaches other apps, which is
						 * the whole leak this feature prevents, so log it, but
						 * once per failure episode, not every iteration. */
						fprintf(stderr,
							"spaceux-daemon: EVIOCGRAB(1) failed (%s); "
							"puck still reaches other apps, retrying\n",
							strerror(errno));
						grab_fail_logged = 1;
					}
				}
			} else if (grab_applied) {
				/* Release requested, but hold the grab until the puck
				 * settles to neutral so its residual deflection doesn't
				 * leak into other apps and snap the 3D view (#327). A
				 * safety deadline releases a never-settling puck anyway. */
				long long now = time_ms();
				if (grab_release_deadline == 0)
					grab_release_deadline =
						now + SPACEUX_GRAB_SETTLE_TIMEOUT_MS;
				if (axes_neutral(last_axes) || now >= grab_release_deadline) {
					if (input_set_grab(0) == 0) {
						grab_applied = 0;
						grab_release_deadline = 0;
						grab_fail_logged = 0;
					} else if (!grab_fail_logged) {
						/* Same retry-on-success rule: keep grab_applied set so
						 * the next reconcile retries the ungrab. */
						fprintf(stderr,
							"spaceux-daemon: EVIOCGRAB(0) failed (%s), "
							"retrying\n",
							strerror(errno));
						grab_fail_logged = 1;
					}
				}
			}
		}
	}

	fprintf(stderr, "spaceux-daemon: shutting down\n");
	if (input_active)
		input_close();
	/* Turn the LED off on the way out so the dark state survives the
	 * daemon exit — otherwise we'd leave the user staring at a glowing
	 * puck even though SpaceUX is no longer running. */
	led_set(led_fd, 0);
	led_close(led_fd);
	inject_close(inject_fd);
	inject_close(inject_ptr_fd);
	sock_close(&sock);
	return 0;
}

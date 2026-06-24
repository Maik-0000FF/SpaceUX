/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ipc - transport-abstract IPC primitives for the daemon.
 *
 * The daemon talks to the SpaceUX core (and any other connected
 * tool) over an OS-native local IPC channel. On UNIX-style hosts
 * that's a SOCK_STREAM AF_UNIX socket; on Windows it will be a named
 * pipe. This header is what the daemon dispatch layer in socket.c
 * speaks to — the per-host implementation lives in one of the
 * ipc_<transport>.c files and is selected at build time:
 *
 *   Linux, macOS → ipc_unix.c
 *   Windows      → ipc_namedpipe.c   (planned)
 *
 * Goals:
 *   - Daemon logic (slot-tracking, subscription mask, broadcast loop)
 *     never opens, reads, or writes the wire directly — every call
 *     goes through this header. That makes a Windows port a new
 *     .c file, not a daemon rewrite.
 *   - The per-client file descriptor stays a plain int; on UNIX it
 *     is a kernel fd usable with poll(), on Windows the named-pipe
 *     port will need to bridge into the same poll() set somehow
 *     (probably overlapped I/O + event handle wrapped to look like
 *     a pollable fd, but that decision is deferred to the Windows
 *     PR).
 *   - Linux-specific syscall conveniences (accept4, SOCK_NONBLOCK,
 *     SOCK_CLOEXEC) are hidden behind ipc_unix.c so macOS — which
 *     lacks them — can join the same backend without #ifdef churn
 *     leaking into daemon code.
 *
 * Error contract (mirrors the wire-side write_full semantics):
 *
 *   ipc_listener_open / ipc_accept / ipc_read:
 *      returns the obvious "value or -1 on error"; errno is set.
 *
 *   ipc_write:
 *      len   — every byte landed in the kernel buffer
 *      0     — nothing was written because the peer would block on
 *              the first byte; caller may safely drop this single
 *              event and keep the client connected
 *      -1    — fatal: partial write hit EAGAIN (would corrupt the
 *              JSON-Lines stream), a write error, or EOF. Caller
 *              must close the slot.
 */
#ifndef SPACEUX_IPC_H
#define SPACEUX_IPC_H

#include <stddef.h>
#include <sys/types.h>

/* Upper bound for the IPC endpoint path string. 108 matches Linux's
 * sun_path; named-pipe paths on Windows fit comfortably. The struct
 * sizes here so the listener can carry its own path for the unlink()
 * on shutdown. */
#define SPACEUX_IPC_PATH_MAX 108

/* Listener handle. `fd` is the kernel descriptor the daemon's poll()
 * loop arms with POLLIN — exposed deliberately so daemon.c can keep
 * its existing pollfd array shape. `path` is the bound endpoint;
 * ipc_listener_close() unlinks it on shutdown (UNIX socket files
 * need explicit cleanup; named pipes are torn down automatically).
 *
 * The struct is not opaque on purpose: the daemon owns its lifetime
 * and we don't want a heap allocation per listener. The fields are
 * private to ipc_<transport>.c — daemon code reads `fd` and treats
 * `path` as a log string. */
struct ipc_listener {
	int fd;
	char path[SPACEUX_IPC_PATH_MAX];
};

/* ipc_listener_open returns this (a positive value, distinct from the 0/-1
 * success/error codes) when another daemon already holds the IPC endpoint, so
 * the caller can exit cleanly instead of stealing it (single-instance). */
#define IPC_LISTENER_IN_USE 1

/* Bind the daemon's IPC endpoint, mark it non-blocking and
 * close-on-exec, and start accepting. Returns 0 on success, -1 on any
 * failure (errno set), or IPC_LISTENER_IN_USE when a live daemon is already
 * listening on the path (probed by a connect before claiming it). The path is
 * chosen by platform.h's platform_socket_path(); on a successful return
 * l->path holds the bound name so a log line can quote it. */
int ipc_listener_open(struct ipc_listener *l);

/* Tear down the listener — closes the fd and unlinks the endpoint
 * file. Safe to call on a partially-initialised listener (zeroed
 * memory or after a failed open). */
void ipc_listener_close(struct ipc_listener *l);

/* Accept one pending connection. Returns a non-blocking, close-on-
 * exec client fd, or -1 if nothing is pending / the accept failed
 * (errno set). The caller adds the returned fd to its poll() set. */
int ipc_accept(struct ipc_listener *l);

/* Peer-side credentials captured at accept-time. `uid` and `gid`
 * are always populated on success; `pid` is set on platforms whose
 * IPC transport exposes the connecting process id (Linux's
 * SO_PEERCRED does; macOS's getpeereid does not — `pid` stays -1
 * there). The daemon uses uid for an authorization check and pid
 * for forensic logging when available. */
struct ipc_peer {
	int uid;
	int gid;
	int pid;
};

/* Resolve the peer credentials for a client fd freshly returned by
 * `ipc_accept`. Returns 0 on success, -1 on failure (e.g. platform
 * doesn't support peer-id queries on its IPC transport). On failure
 * the daemon should still reject the connection — refusing to
 * authenticate a peer is safer than allowing it through. */
int ipc_peer_credentials(int fd, struct ipc_peer *out);

/* Read up to `max` bytes into `buf`. Returns:
 *    > 0   bytes actually read
 *      0   peer closed cleanly (EOF) — caller must close the slot
 *     -1   error (errno set; EAGAIN/EWOULDBLOCK signal "would block")
 * Thin wrapper over read() today so a Windows backend can substitute
 * an overlapped-I/O equivalent without changing the dispatch loop. */
ssize_t ipc_read(int fd, char *buf, size_t max);

/* Write the full payload to a non-blocking peer. See the file-level
 * error contract for the len / 0 / -1 semantics. */
int ipc_write(int fd, const char *buf, int len);

/* Close one client fd. Wrapper rather than direct close() so the
 * Windows backend (named pipes, possibly with overlapped I/O state)
 * can clean up its per-client bookkeeping in one place. */
void ipc_close(int fd);

#endif /* SPACEUX_IPC_H */

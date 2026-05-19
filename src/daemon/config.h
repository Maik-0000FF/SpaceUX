/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * config - compile-time daemon constants.
 *
 * Everything that would otherwise be a literal in the daemon source
 * (buffer sizes, axis count, socket path template, default timeouts)
 * lives here so the daemon has a single grep-able place for tuning
 * and downstream readers don't have to chase magic numbers.
 */
#ifndef SPACEUX_DAEMON_CONFIG_H
#define SPACEUX_DAEMON_CONFIG_H

/* ── Hardware shape ─────────────────────────────────────────────────── */

/* SpaceMouse pucks expose six absolute axes (TX, TY, TZ, RX, RY, RZ)
 * via /dev/input/eventN. We never read more even if a future device
 * exposes them — the protocol is fixed at six. */
#define SPACEUX_AXIS_COUNT 6

/* Hard upper bound on buttons we forward. SpacePilot Pro (the current
 * record holder) has 31. 32 leaves one slot of headroom and keeps
 * the bitfield/array sizing comfortable. */
#define SPACEUX_MAX_BUTTONS 32

/* ── Socket / protocol ──────────────────────────────────────────────── */

/* UNIX socket path template under /run/user/<UID>/. Single-user
 * daemon — one socket per uid, picked up by the Electron app. */
#define SPACEUX_SOCK_BASENAME "spaceux.sock"

/* Maximum number of concurrent clients. The Electron app counts as
 * one; leaving room for a CLI debug client and a future status
 * sidebar keeps the ceiling generous without burning fds. */
#define SPACEUX_MAX_CLIENTS 8

/* Inbound command line length. Commands are short ASCII tokens
 * (GRAB, RELEASE, SUBSCRIBE axes,buttons), well under this cap. */
#define SPACEUX_CMD_BUF_SIZE 256

/* Outbound JSON-Lines event length. One axes snapshot is ~80 bytes,
 * one button event ~40 bytes; 512 leaves room for future fields
 * without forcing a reallocation. */
#define SPACEUX_EVENT_BUF_SIZE 512

/* ── Event loop ─────────────────────────────────────────────────────── */

/* poll() timeout. Short enough that SIGTERM is honoured promptly,
 * long enough that an idle daemon barely uses CPU. */
#define SPACEUX_POLL_TIMEOUT_MS 100

/* How often the daemon retries input_open() after a device unplug.
 * Cheap enough to feel responsive on hot-plug, slow enough not to
 * spam syslog with "no device" while the cable is out. */
#define SPACEUX_INPUT_RETRY_MS 1000

/* ── Per-client INJECT_CHORD rate limit ─────────────────────────────── */

/* Leaky-bucket parameters for INJECT_CHORD. The puck fires chords at
 * human pace (a few per second at most) so the steady-state rate is
 * a generous cap on what a *legitimate* client needs; the burst
 * absorbs e.g. two chords in quick succession when the user mashes
 * the trigger. A misbehaving or hostile same-UID process that spams
 * INJECT_CHORD will exhaust the bucket within ~250 ms and have
 * subsequent chords dropped (with an audit log line per drop).
 *
 * Bump the rate if a real workflow ever needs more — the cost of
 * being more permissive is bounded by what /dev/uinput can sustain.
 *
 * Scope: the bucket is *per-connection*, not per-UID. A same-UID
 * attacker can hold up to `SPACEUX_MAX_CLIENTS` concurrent
 * connections and aggregate up to `SPACEUX_MAX_CLIENTS *
 * SPACEUX_CHORD_RATE_PER_SEC` injects/sec. The threat model treats
 * a single hostile process as the realistic case; a per-UID bucket
 * would be tighter but requires shared state across slots and is
 * deferred to #9's capability-token work or later. */
#define SPACEUX_CHORD_RATE_PER_SEC 20
#define SPACEUX_CHORD_BURST 5

#endif /* SPACEUX_DAEMON_CONFIG_H */

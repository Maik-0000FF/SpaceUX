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

/* Bytes (including NUL) for the device's EVIOCGNAME model string, used
 * to key per-device profiles (#113) and label the active device in the
 * editor. Real names ("3Dconnexion SpaceMouse Pro") sit well under
 * this; a longer kernel name is truncated. The string is pre-sanitized
 * to JSON-safe printable ASCII before it goes on the wire (see
 * input_linux.c), so the event emitter can embed it without escaping. */
#define SPACEUX_DEVICE_NAME_LEN 80

/* Maximum evdev nodes the daemon reads for one physical puck. A device
 * connected by USB cable usually presents a single combined node (axes +
 * buttons), but some links (e.g. a wireless receiver) split the puck into
 * an axis node and a separate button node. We open every node that belongs
 * to the same physical device so buttons are seen on both layouts. Four
 * leaves headroom for odd composite descriptors. */
#define SPACEUX_INPUT_MAX_FDS 4

/* ── Socket / protocol ──────────────────────────────────────────────── */

/* UNIX socket path template under /run/user/<UID>/. Single-user
 * daemon — one socket per uid, picked up by the SpaceUX core. */
#define SPACEUX_SOCK_BASENAME "spaceux.sock"

/* Maximum number of concurrent clients. The SpaceUX core counts as
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

/* ── Grab settle-on-release (#327) ──────────────────────────────────── */

/* When the last client drops the GRAB, the puck is often still
 * deflected, the user hasn't let it spring back to centre yet.
 * Releasing EVIOCGRAB at that instant dumps the residual deflection
 * straight into FreeCAD/Blender and snaps the 3D view. So instead of
 * releasing immediately the daemon holds the grab until every axis has
 * settled within this neutral band, then releases at rest. The value is
 * in raw device units; pucks report full-scale around ±500 (matching the
 * renderer's MAX_LATERAL_DEADZONE) and zero cleanly at rest, so a small
 * band absorbs sensor drift without waiting on a moving puck. */
#define SPACEUX_GRAB_NEUTRAL_BAND 24

/* Safety cap on the settle wait. If the puck never returns to neutral
 * (the user keeps holding it deflected after closing the pie), release
 * anyway after this long so a held puck can't starve other apps
 * indefinitely. The residual jump in that rare case is the accepted
 * trade-off against a stuck grab. */
#define SPACEUX_GRAB_SETTLE_TIMEOUT_MS 600

/* How often the daemon retries input_open() after a device unplug.
 * Cheap enough to feel responsive on hot-plug, slow enough not to
 * spam syslog with "no device" while the cable is out. */
#define SPACEUX_INPUT_RETRY_MS 1000

/* ── Per-client INJECT_CHORD rate limit ─────────────────────────────── */

/* ── Capability token ───────────────────────────────────────────────── */

/* INJECT_CHORD is the daemon's one privileged operation — it injects
 * keystrokes into whatever window has focus. Every accept() generates
 * a fresh per-slot token (16 random bytes, hex-encoded) which the
 * daemon emits in the hello event. INJECT_CHORD commands have to
 * echo the token back, or the daemon drops the chord with an audit
 * log line. This raises the bar for the abuse case where a hostile
 * same-UID process connects to the socket and starts pumping
 * injects — it now has to first read the hello event, capture the
 * token, and only then can it inject. Cheap to bypass for a real
 * attacker (same-UID can ptrace the renderer or read its memory)
 * but blocks the trivial fuzz-the-socket case.
 *
 * 16 bytes / 128 bits is well past any plausible online-guess
 * budget on a local socket, with 32 hex chars on the wire still
 * fitting comfortably in the command-line buffer. */
#define SPACEUX_TOKEN_BYTES 16
#define SPACEUX_TOKEN_HEX_LEN 33 /* 32 hex chars + NUL */

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

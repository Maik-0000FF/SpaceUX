// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire-format types for the daemon UNIX socket.
 *
 * The daemon emits JSON-Lines events: one JSON object per line,
 * newline-terminated. Inbound commands are short ASCII tokens, also
 * one per line. Keeping these contracts in one shared file means the
 * Electron main process and any test that exercises the parser see
 * the same source of truth.
 *
 * If you add a new daemon event or command, update `Protocol.VERSION`
 * so connecting clients can negotiate gracefully when the daemon and
 * UI drift apart in development.
 */

export const Protocol = {
  /** Bumped on every backwards-incompatible wire change. */
  VERSION: 1,

  /** Axis count exposed by the protocol. Mirrors SPACEUX_AXIS_COUNT in
   *  src/daemon/config.h — the daemon never emits more or fewer than this. */
  AXIS_COUNT: 6,
} as const;

// ── Events: daemon → client ───────────────────────────────────────────

export type AxesEvent = {
  event: 'axes';
  /** Six signed integers (TX, TY, TZ, RX, RY, RZ) at the kernel's raw scale. */
  values: [number, number, number, number, number, number];
};

export type ButtonEvent = {
  event: 'button';
  /** Zero-based button index — 0 = Button 1 on the puck. */
  bnum: number;
  pressed: boolean;
};

export type HelloEvent = {
  event: 'hello';
  axes: number;
  buttons: number;
  /**
   * True if the daemon successfully opened /dev/uinput at startup.
   * False means INJECT_CHORD commands will silently no-op — the
   * renderer should surface a status hint instead of letting
   * key-combo bindings appear to work and produce no key events.
   *
   * Older daemons that predate this flag won't include the field;
   * treat missing as `false` (conservative — assumes no injection).
   */
  inject?: boolean;
  /**
   * True if the daemon found a SpaceMouse hidraw node it can write
   * to (controls the puck's status LED). False means SET_LED
   * commands silently no-op — the renderer should suppress the
   * pie-open/close round-trip entirely to keep the wire quiet.
   *
   * Older daemons that predate this flag won't include the field;
   * treat missing as `false`.
   */
  led?: boolean;
  /**
   * Per-connection capability token (32-hex-char string) that the
   * daemon expects echoed back on every INJECT_CHORD line. Lets the
   * renderer authenticate as the holder of *this* hello — a
   * different same-UID process that connects directly to the socket
   * gets its own token and can't replay ours.
   *
   * Older daemons that predate the token won't include the field;
   * the renderer treats missing as "no auth required" and falls
   * back to the pre-#9-PR-B wire format on INJECT_CHORD.
   */
  token?: string;
};

export type DaemonEvent = AxesEvent | ButtonEvent | HelloEvent;

/** Type predicate so the renderer can switch over the discriminant safely. */
export function isDaemonEvent(value: unknown): value is DaemonEvent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj.event === 'axes' || obj.event === 'button' || obj.event === 'hello';
}

// ── Commands: client → daemon ─────────────────────────────────────────
//
// Commands are emitted by name as a single line so the daemon parser
// stays trivial. Helpers below format them; never build the strings by
// hand at call sites — that's how typos in protocol names happen.

export type DaemonCommand =
  | { kind: 'subscribe'; events: ('axes' | 'buttons')[] }
  | { kind: 'unsubscribe' }
  | { kind: 'grab' }
  | { kind: 'release' }
  | { kind: 'ping' }
  /**
   * Inject one modifier+key chord through the daemon's uinput device.
   * `modifiers` are Linux keycodes held during the tap (e.g. 56 for
   * KEY_LEFTALT); `key` is the keycode tapped (e.g. 15 for KEY_TAB).
   * The renderer's parseChord() already produces these codes — no
   * translation table needed in flight.
   *
   * Daemon-side limit: `modifiers.length` must be <= 8
   * (SPACEUX_MAX_CHORD_MODS in `src/daemon/protocol.h`). The wire
   * line "INJECT_CHORD <m1> ... <mN> <key>" must fit 9 tokens; the
   * daemon parser silently drops any line that exceeds that. No real
   * keyboard chord uses more than ~4 modifiers, so the cap is
   * theoretical, but a future expansion (Hyper, Compose, AltGr in
   * unusual combos) would need a bump on both sides. */
  | { kind: 'inject-chord'; modifiers: number[]; key: number; token: string }
  /**
   * Drive the SpaceMouse status LED. `on: true` lights it up,
   * `on: false` turns it dark. Used by the main process to mirror
   * the pie-open/close lifecycle. Callers should check
   * `daemon.isLedAvailable()` first — sending SET_LED to a daemon
   * that reported `led: false` in its hello does nothing useful and
   * just costs a socket round-trip. */
  | { kind: 'set-led'; on: boolean };

export function encodeCommand(cmd: DaemonCommand): string {
  switch (cmd.kind) {
    case 'subscribe':
      if (cmd.events.length === 0) return 'UNSUBSCRIBE\n';
      return `SUBSCRIBE ${cmd.events.join(',')}\n`;
    case 'unsubscribe':
      return 'UNSUBSCRIBE\n';
    case 'grab':
      return 'GRAB\n';
    case 'release':
      return 'RELEASE\n';
    case 'ping':
      return 'PING\n';
    case 'inject-chord':
      // Wire form is "INJECT_CHORD <token> <c1> <c2> ... <cN>"
      // where <token> is the per-connection capability the daemon
      // emitted in its hello event. The last code is the key and
      // everything before it is held as modifiers; empty modifiers
      // means "tap key alone". The daemon validates the token
      // first and rejects unauthenticated lines without consuming
      // the rate-limit bucket.
      return `INJECT_CHORD ${cmd.token} ${[...cmd.modifiers, cmd.key].join(' ')}\n`;
    case 'set-led':
      // Wire form is "SET_LED 0" or "SET_LED 1" — the daemon parser
      // refuses anything else, so the boolean→01 narrowing here is
      // load-bearing.
      return `SET_LED ${cmd.on ? 1 : 0}\n`;
  }
}

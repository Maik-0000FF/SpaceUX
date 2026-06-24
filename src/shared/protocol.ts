// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Wire-format types for the daemon UNIX socket.
 *
 * The daemon emits JSON-Lines events: one JSON object per line,
 * newline-terminated. Inbound commands are short ASCII tokens, also
 * one per line. Keeping these contracts in one shared file means the
 * core and any test that exercises the parser see the same source of
 * truth.
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

export type DeviceEvent = {
  event: 'device';
  /** The connected puck's discovered button count, or 0 when none is
   *  attached. Emitted whenever the device changes (hotplug swap) so a
   *  long-lived client can re-clamp without reconnecting — the count is
   *  also in the `hello` every fresh connection already receives. */
  buttons: number;
} & DeviceIdentity;

/**
 * Device identity carried in both `hello` and `device` events (#113):
 * the USB VID/PID key the matching per-device profile, and the model
 * name labels the active device in the editor. All optional — daemons
 * predating #113 omit them; treat missing vendor/product as 0 (no
 * device / unknown) and a missing name as empty. The name is sanitized
 * daemon-side to printable ASCII before it hits the wire.
 */
export type DeviceIdentity = {
  vendor?: number;
  product?: number;
  name?: string;
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
   * True if the daemon opened its relative pointer device at startup
   * (controls analog scroll for desktop mode). False means INJECT_SCROLL
   * commands silently no-op.
   *
   * Older daemons that predate this flag won't include the field;
   * treat missing as `false`.
   */
  scroll?: boolean;
  /**
   * Per-connection capability token (32-hex-char string) that the
   * daemon expects echoed back on every INJECT_CHORD line. Lets the
   * renderer authenticate as the holder of *this* hello — a
   * different same-UID process that connects directly to the socket
   * gets its own token and can't replay ours.
   *
   * Older daemons that predate the token won't include the field.
   * The renderer fails closed in that case: `injectChord()` no-ops
   * until a token has been latched. There is no unauthenticated
   * fallback wire format — an old daemon would happily inject
   * without auth, which is the exact attack PR B is closing.
   * Upgrading the daemon is the path forward.
   */
  token?: string;
} & DeviceIdentity;

export type DaemonEvent = AxesEvent | ButtonEvent | HelloEvent | DeviceEvent;

/** Type predicate so the renderer can switch over the discriminant safely. */
export function isDaemonEvent(value: unknown): value is DaemonEvent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.event === 'axes' ||
    obj.event === 'button' ||
    obj.event === 'hello' ||
    obj.event === 'device'
  );
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
   * Inject a relative scroll on the daemon's pointer device (#199 desktop
   * mode). `dx`/`dy` are signed wheel deltas (hi-res convention): positive
   * `dy` scrolls up, positive `dx` scrolls right. Token-gated like
   * INJECT_CHORD; the daemon further no-ops it when its scroll device was
   * unavailable at startup (the `scroll` hello flag is false). */
  | { kind: 'inject-scroll'; dx: number; dy: number; token: string }
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
    case 'inject-scroll':
      // Wire form "INJECT_SCROLL <token> <dx> <dy>"; integers only, the daemon
      // parser rejects non-numeric deltas.
      return `INJECT_SCROLL ${cmd.token} ${Math.trunc(cmd.dx)} ${Math.trunc(cmd.dy)}\n`;
    case 'set-led':
      // Wire form is "SET_LED 0" or "SET_LED 1" — the daemon parser
      // refuses anything else, so the boolean→01 narrowing here is
      // load-bearing.
      return `SET_LED ${cmd.on ? 1 : 0}\n`;
  }
}

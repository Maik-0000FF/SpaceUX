// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { Protocol, encodeCommand, isDaemonEvent } from '../src/shared/protocol';

describe('encodeCommand', () => {
  it('emits SUBSCRIBE with comma-separated event names', () => {
    expect(encodeCommand({ kind: 'subscribe', events: ['axes', 'buttons'] })).toBe(
      'SUBSCRIBE axes,buttons\n',
    );
    expect(encodeCommand({ kind: 'subscribe', events: ['axes'] })).toBe('SUBSCRIBE axes\n');
  });

  it('empty subscribe degrades to UNSUBSCRIBE so the daemon never sees an empty list', () => {
    expect(encodeCommand({ kind: 'subscribe', events: [] })).toBe('UNSUBSCRIBE\n');
  });

  it('emits the bare verbs for grab/release/ping/unsubscribe', () => {
    expect(encodeCommand({ kind: 'grab' })).toBe('GRAB\n');
    expect(encodeCommand({ kind: 'release' })).toBe('RELEASE\n');
    expect(encodeCommand({ kind: 'ping' })).toBe('PING\n');
    expect(encodeCommand({ kind: 'unsubscribe' })).toBe('UNSUBSCRIBE\n');
  });

  it('emits INJECT_CHORD with token, modifiers prefix and key suffix', () => {
    const tok = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    // Alt+Tab — KEY_LEFTALT=56, KEY_TAB=15
    expect(encodeCommand({ kind: 'inject-chord', modifiers: [56], key: 15, token: tok })).toBe(
      `INJECT_CHORD ${tok} 56 15\n`,
    );
    // Ctrl+Shift+S — KEY_LEFTCTRL=29, KEY_LEFTSHIFT=42, KEY_S=31
    expect(encodeCommand({ kind: 'inject-chord', modifiers: [29, 42], key: 31, token: tok })).toBe(
      `INJECT_CHORD ${tok} 29 42 31\n`,
    );
  });

  it('emits a bare key chord with no modifiers (token still leads)', () => {
    const tok = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    // KEY_ENTER=28, no modifiers — the wire form must still have
    // the token and the key code so the daemon parser sees at least
    // one token-after-the-token.
    expect(encodeCommand({ kind: 'inject-chord', modifiers: [], key: 28, token: tok })).toBe(
      `INJECT_CHORD ${tok} 28\n`,
    );
  });

  it('emits SET_LED with 0 or 1 (never true/false strings)', () => {
    // The daemon parser is strict about the payload — only the
    // literals 0 and 1 are accepted, anything else (including
    // "true"/"false") is rejected as PROTO_CMD_UNKNOWN. Pin both
    // sides so a stray boolean leak into the encoder fails this
    // test instead of falling through to a silent daemon drop.
    expect(encodeCommand({ kind: 'set-led', on: true })).toBe('SET_LED 1\n');
    expect(encodeCommand({ kind: 'set-led', on: false })).toBe('SET_LED 0\n');
  });

  it('always terminates with a single newline', () => {
    const cmds = [
      { kind: 'grab' as const },
      { kind: 'release' as const },
      { kind: 'ping' as const },
      { kind: 'subscribe' as const, events: ['axes' as const] },
    ];
    for (const cmd of cmds) {
      const encoded = encodeCommand(cmd);
      expect(encoded.endsWith('\n')).toBe(true);
      expect(encoded.endsWith('\n\n')).toBe(false);
    }
  });
});

describe('isDaemonEvent', () => {
  it('accepts known event shapes', () => {
    expect(isDaemonEvent({ event: 'axes', values: [0, 0, 0, 0, 0, 0] })).toBe(true);
    expect(isDaemonEvent({ event: 'button', bnum: 0, pressed: true })).toBe(true);
    expect(isDaemonEvent({ event: 'hello', axes: 6, buttons: 32 })).toBe(true);
  });

  it('accepts the device button-count event (live hotplug push, PR 2b)', () => {
    // The daemon emits this when the connected puck's count changes so a
    // long-lived client re-clamps without reconnecting. 0 = device gone.
    expect(isDaemonEvent({ event: 'device', buttons: 15 })).toBe(true);
    expect(isDaemonEvent({ event: 'device', buttons: 0 })).toBe(true);
  });

  it('still accepts hello/device events that carry the #113 identity fields', () => {
    // isDaemonEvent discriminates only on `event`, so this is a regression
    // guard that the added VID/PID/name fields don't trip the predicate —
    // not a wire-shape pin (that lives daemon-side, no C test harness).
    expect(
      isDaemonEvent({
        event: 'device',
        buttons: 15,
        vendor: 1133,
        product: 50741,
        name: '3Dconnexion SpaceMouse Pro',
      }),
    ).toBe(true);
    expect(
      isDaemonEvent({
        event: 'hello',
        axes: 6,
        buttons: 2,
        vendor: 1133,
        product: 50726,
        name: '',
      }),
    ).toBe(true);
  });

  it('accepts hello with the injection capability flag', () => {
    // New daemons (post-#6) include "inject" in hello so the renderer
    // can show "injection unavailable" instead of silently dropping
    // chords. Pinning both true and false explicitly so a future
    // hello-shape change can't break this without flipping a spec.
    expect(isDaemonEvent({ event: 'hello', axes: 6, buttons: 32, inject: true })).toBe(true);
    expect(isDaemonEvent({ event: 'hello', axes: 6, buttons: 32, inject: false })).toBe(true);
  });

  it('accepts hello with the LED capability flag', () => {
    // Symmetric to the inject flag — added when the daemon learned
    // to drive the SpaceMouse LED. Both signs pinned for the same
    // future-proofing reason.
    expect(isDaemonEvent({ event: 'hello', axes: 6, buttons: 32, inject: true, led: true })).toBe(
      true,
    );
    expect(isDaemonEvent({ event: 'hello', axes: 6, buttons: 32, inject: true, led: false })).toBe(
      true,
    );
  });

  it('rejects malformed inputs', () => {
    expect(isDaemonEvent(null)).toBe(false);
    expect(isDaemonEvent(undefined)).toBe(false);
    expect(isDaemonEvent('axes')).toBe(false);
    expect(isDaemonEvent({})).toBe(false);
    expect(isDaemonEvent({ event: 'unknown' })).toBe(false);
  });
});

describe('Protocol constants', () => {
  it('declares an axis count matching the wire format', () => {
    expect(Protocol.AXIS_COUNT).toBe(6);
  });

  it('exposes a positive version number', () => {
    expect(Protocol.VERSION).toBeGreaterThan(0);
  });
});

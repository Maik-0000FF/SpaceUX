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

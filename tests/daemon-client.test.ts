// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `DaemonClient` only ever talks to the daemon through `net`'s
 * `createConnection`, so mocking that single entry point gives us
 * full control over the wire while leaving every other piece of
 * the class (parsing, token-latching, reconnect bookkeeping) under
 * test. Each `createConnection` hands out a fresh `FakeSocket`
 * which we capture in the module-level `mockSockets` list so a
 * spec can drive its lifecycle and assert against `socket.writes`.
 *
 * Why a homegrown fake instead of a `Duplex` polyfill: the class
 * only uses `write`, `destroy`, `destroyed`, and EventEmitter
 * subscription. A minimal fake keeps the test honest about which
 * surface area we depend on.
 */

class FakeSocket extends EventEmitter {
  public destroyed = false;
  public writes: string[] = [];
  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
}

let mockSockets: FakeSocket[] = [];

vi.mock('node:net', () => ({
  default: {
    createConnection: vi.fn((..._args: unknown[]): FakeSocket => {
      const s = new FakeSocket();
      mockSockets.push(s);
      return s;
    }),
  },
}));

// Must be imported *after* the mock declaration above so the mocked
// `net` module is wired into DaemonClient's `import net from 'node:net'`.
import { DaemonClient } from '../src/main/daemon-client';

const HELLO = (token: string): string =>
  `{"event":"hello","axes":6,"buttons":32,"inject":true,"led":true,"token":"${token}"}\n`;

describe('DaemonClient capability-token fail-closed behaviour', () => {
  let client: DaemonClient;

  beforeEach(() => {
    mockSockets = [];
    client = new DaemonClient('/tmp/test-spaceux.sock');
    client.start();
  });

  afterEach(() => {
    // Cancels the reconnect timer the close handler arms, so tests
    // don't leak setTimeouts into each other.
    client.stop();
  });

  it('drops injectChord before any hello arrives (no auth token yet)', () => {
    // Connection is up but the daemon hasn't yet sent its hello.
    // The renderer fails closed: a chord call in this window must
    // not write to the wire, because the daemon (post-#9-PR-B)
    // would reject an unauthenticated INJECT_CHORD anyway and a
    // pre-#9-PR-B daemon would inject unauthenticated — the exact
    // behaviour this PR closes off.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    client.injectChord([29], 31);
    expect(sock.writes).toEqual([]);
  });

  it('sends INJECT_CHORD with the latched token after hello', () => {
    // Once the hello round-trips, the token is latched and the next
    // chord goes out in the post-#9-PR-B wire format:
    // `INJECT_CHORD <token> <c1> ... <cN>`. The token preceding the
    // codes is the load-bearing part — a future refactor that
    // accidentally drops it (or moves it after the codes) would
    // fail this assertion before regressing real users.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    sock.emit('data', Buffer.from(HELLO('deadbeefcafef00ddeadbeefcafef00d')));

    client.injectChord([29], 31);
    expect(sock.writes).toEqual(['INJECT_CHORD deadbeefcafef00ddeadbeefcafef00d 29 31\n']);
  });

  it('clears the token on socket close so a stale chord cannot leak through', () => {
    // Close-then-reconnect cycle: the token from the previous
    // session must not survive into a window where the renderer
    // could send it before the next hello latches a fresh one.
    // Pinning the clear so a future refactor that drops the
    // close handler (or reorders the lifecycle) regresses here
    // rather than silently in production.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    sock.emit('data', Buffer.from(HELLO('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')));

    // Sanity: send works pre-close.
    client.injectChord([29], 31);
    expect(sock.writes.length).toBe(1);

    // Disconnect — the close handler clears `authToken`.
    sock.emit('close');

    // Post-close, the next chord must no-op. The socket itself is
    // also destroyed by now, but the token-clear is the *primary*
    // guard: even if a reconnect happened right away on a fresh
    // socket, injectChord would still be silent until a new hello.
    client.injectChord([29], 31);
    expect(sock.writes.length).toBe(1);
  });
});

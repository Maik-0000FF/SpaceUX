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
const HELLO_NO_TOKEN_FIELD = '{"event":"hello","axes":6,"buttons":32,"inject":true,"led":true}\n';

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
    // The renderer must fail closed: a chord call in this window
    // must not write anything to the wire — independent of which
    // daemon is on the other side. The threat this guards against
    // is a pre-#9-PR-B daemon that would happily inject without
    // auth; a post-#9-PR-B daemon would reject the line, but the
    // renderer is the one responsible for not producing it.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    client.injectChord([29], 31);
    expect(sock.writes).toEqual([]);
  });

  it('drops injectChord when the hello carries no token field', () => {
    // Older daemons (pre-#9-PR-B) that predate the token will emit
    // a hello without the `token` key at all. `handleLine` falls
    // back to authToken = '' in that case (daemon-client.ts:193),
    // and `injectChord` keeps no-op'ing — there is no implicit
    // unauthenticated wire format. A future refactor that flipped
    // the fallback to something truthy (e.g. the literal string
    // 'undefined' from a sloppy String() coercion) would regress
    // here.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    sock.emit('data', Buffer.from(HELLO_NO_TOKEN_FIELD));

    client.injectChord([29], 31);
    expect(sock.writes).toEqual([]);
  });

  it('drops injectChord when the hello carries an empty token', () => {
    // A daemon that ships the field but with an empty string is
    // the same fail-closed case as "no field" — the guard at
    // daemon-client.ts:100 is `if (!this.authToken) return`,
    // which treats both identically. Pinning that the empty
    // string is intentional and not just incidentally lumped in
    // with the missing-key case.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    sock.emit('data', Buffer.from(HELLO('')));

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
    // The next spec exercises that reconnect path directly.
    client.injectChord([29], 31);
    expect(sock.writes.length).toBe(1);
  });

  it('keeps a fresh post-reconnect socket silent until the next hello', () => {
    // Reconnect-via-auto-timer scenario. The close handler arms a
    // reconnectTimer that opens a brand-new socket on the same
    // client. The previous session's token must not survive into
    // the new connection's pre-hello window — only a hello on the
    // *new* socket can re-arm injection. Pins what the comment on
    // the previous spec already claims: the token-clear, not just
    // the socket-destroy, is what fails the next chord closed.
    vi.useFakeTimers();
    try {
      const sock1 = mockSockets[0]!;
      sock1.emit('connect');
      sock1.emit('data', Buffer.from(HELLO('cccccccccccccccccccccccccccccccc')));
      sock1.emit('close');

      // Flush the reconnectTimer (default reconnectDelayMs = 1000).
      vi.advanceTimersByTime(1000);

      const sock2 = mockSockets[1];
      expect(sock2).toBeDefined();
      sock2!.emit('connect');

      // No hello on sock2 yet — the previous session's token must
      // not leak into a write on the new wire.
      client.injectChord([29], 31);
      expect(sock2!.writes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('DaemonClient grab/release (#327)', () => {
  let client: DaemonClient;

  beforeEach(() => {
    mockSockets = [];
    client = new DaemonClient('/tmp/test-spaceux.sock');
    client.start();
  });

  afterEach(() => {
    client.stop();
  });

  it('writes the bare GRAB / RELEASE verbs once connected', () => {
    // Unlike injectChord, grab/release carry no auth token and don't
    // wait for a hello — they're plain commands. The exact wire verbs
    // are load-bearing: the daemon's parser matches "GRAB"/"RELEASE"
    // literally (protocol.c), so a refactor that renamed or reordered
    // them would silently stop suppressing puck input.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    client.grab();
    client.release();
    expect(sock.writes).toEqual(['GRAB\n', 'RELEASE\n']);
  });

  it('drops grab/release after the socket closes (fail-soft)', () => {
    // send() guards on a live socket, so a release() that races the
    // teardown (daemon gone, socket destroyed) must no-op rather than
    // throw. hideMenuWindow calls release() unconditionally, so this
    // window is reachable if the daemon dies while the pie is open.
    const sock = mockSockets[0]!;
    sock.emit('connect');
    sock.emit('close');
    client.grab();
    client.release();
    expect(sock.writes).toEqual([]);
  });
});

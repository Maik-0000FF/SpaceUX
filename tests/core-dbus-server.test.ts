// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import DBus from 'dbus-next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CORE_INTERFACE, CORE_OBJECT_PATH, CORE_SERVICE } from '../src/shared/core-contract.js';
import {
  claimCoreBusName,
  startCoreServer,
  type CoreServerHandle,
} from '../src/core-host/dbus-server.js';

// Needs a real session bus; CI containers without one skip the suite (the gdbus
// smoke + the contract conformance/sync tests cover those environments). A
// LIVE core also blocks the run: the test claims the real bus name, and the
// app's single-instance semantics make a second owner impossible, so skip
// instead of failing the suite while SpaceUX is running.
const hasBus = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);
const nameFree = hasBus ? await coreNameFree() : false;

async function coreNameFree(): Promise<boolean> {
  const bus = DBus.sessionBus();
  try {
    const obj = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
    const dbus = obj.getInterface('org.freedesktop.DBus') as unknown as {
      NameHasOwner(name: string): Promise<boolean>;
    };
    return !(await dbus.NameHasOwner(CORE_SERVICE));
  } finally {
    bus.disconnect();
  }
}

describe.skipIf(!nameFree)('org.spaceux.Core1 D-Bus server', () => {
  const setThemeCalls: string[] = [];
  // Only the exercised methods need to exist; the dispatcher calls service[name]
  // lazily, so a partial stand-in is enough for the transport round-trip test.
  const mock = {
    GetTheme: () => 'dark',
    SetTheme: (theme: string) => {
      setThemeCalls.push(theme);
    },
    GetAutostart: () => true,
  } as unknown as Parameters<typeof startCoreServer>[0];

  let handle: CoreServerHandle;
  let bus: DBus.MessageBus;
  // dbus-next client interfaces are dynamically shaped (EventEmitter + methods).
  let iface: {
    GetTheme(args: string): Promise<string>;
    SetTheme(args: string): Promise<string>;
    GetAutostart(args: string): Promise<string>;
    once(event: string, cb: (payload: string) => void): void;
  };

  beforeAll(async () => {
    handle = await startCoreServer(mock);
    bus = DBus.sessionBus();
    const obj = await bus.getProxyObject(CORE_SERVICE, CORE_OBJECT_PATH);
    iface = obj.getInterface(CORE_INTERFACE) as unknown as typeof iface;
  });

  afterAll(async () => {
    bus?.disconnect();
    await handle?.stop();
  });

  it('decodes the args array and JSON-encodes the result', async () => {
    expect(JSON.parse(await iface.GetTheme('[]'))).toBe('dark');
    expect(JSON.parse(await iface.GetAutostart('[]'))).toBe(true);
  });

  it('passes decoded args to the service and returns null for a void method', async () => {
    expect(JSON.parse(await iface.SetTheme('["light"]'))).toBeNull();
    expect(setThemeCalls).toContain('light');
  });

  it('refuses a second claim while the name is owned (single instance)', async () => {
    expect(await claimCoreBusName()).toBeNull();
  });

  it('delivers a signal with its JSON payload', async () => {
    const received = new Promise<string>((resolve) => {
      iface.once('PieAppearanceChanged', resolve);
    });
    // once() registers its bus match rule asynchronously; under a loaded
    // suite the emit below could otherwise beat the registration and the
    // signal be dropped (a timeout flake). A round-trip on the same bus
    // orders the registration before the emit.
    await bus.getProxyObject(CORE_SERVICE, CORE_OBJECT_PATH);
    handle.emit('PieAppearanceChanged', { theme: 'dark', opacity: 0.9 });
    expect(JSON.parse(await received)).toEqual({ theme: 'dark', opacity: 0.9 });
  });
});

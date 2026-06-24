// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import DBus from 'dbus-next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CORE_SERVICE } from '../src/shared/core-contract.js';
import { claimCoreBusName } from '../src/core-host/dbus-server.js';

// The single-instance guard (#415, #457 D6): the first core claims the bus name;
// a second launch's claim must defer (return null) so it bails out instead of
// double-owning. Needs a real session bus; CI containers without one skip. A live
// core also blocks the run (it owns the real name), so skip when it's taken
// rather than fail the suite while SpaceUX is running. The full process-level
// second-launch path (the second core exits 0, the editor opens) is covered by
// scripts/second-launch-smoke.sh in the install lane.
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

describe.skipIf(!nameFree)('core single instance (claimCoreBusName)', () => {
  const open: DBus.MessageBus[] = [];

  // D-Bus releases an owned name asynchronously when its connection closes, so
  // wait for the previous test's afterEach disconnect to propagate before the
  // next test claims; otherwise the opening claim could race the release.
  beforeEach(async () => {
    for (let i = 0; i < 40 && !(await coreNameFree()); i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  afterEach(() => {
    for (const bus of open) {
      try {
        bus.disconnect();
      } catch {
        // already gone
      }
    }
    open.length = 0;
  });

  it('the first claim owns the name and a second claim defers', async () => {
    const first = await claimCoreBusName();
    expect(first).not.toBeNull();
    open.push(first as DBus.MessageBus);

    // A second launch, while the first holds the name: must defer, not take over.
    const second = await claimCoreBusName();
    expect(second).toBeNull();
  });

  it('a claim succeeds again once the previous owner is gone', async () => {
    const first = await claimCoreBusName();
    expect(first).not.toBeNull();
    // Disconnecting releases the owned name (what core shutdown does).
    (first as DBus.MessageBus).disconnect();

    // The name frees asynchronously; wait until the bus reports it free.
    for (let i = 0; i < 40 && !(await coreNameFree()); i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }

    const again = await claimCoreBusName();
    expect(again).not.toBeNull();
    open.push(again as DBus.MessageBus);
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import DBus from 'dbus-next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSniTray, type SniTray } from '../src/core-host/sni-tray.js';

// Needs a real session bus; environments without one skip the suite (same
// gate as the core D-Bus server test).
const hasBus = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);

const TEST_WATCHER_NAME = 'org.spaceux.TestStatusNotifierWatcher';

// The tray registers with a StatusNotifierWatcher; the test owns a stub
// under its own bus name (injected into createSniTray) so it never touches a
// real desktop's tray. Registrations are recorded to pin the path-based form.
class StubWatcher extends DBus.interface.Interface {
  registered: string[] = [];

  constructor() {
    super('org.kde.StatusNotifierWatcher');
  }

  RegisterStatusNotifierItem(service: string): void {
    this.registered.push(service);
  }
}
StubWatcher.configureMembers({
  methods: { RegisterStatusNotifierItem: { inSignature: 's' } },
});

// One dbusmenu layout node as the wire delivers it through dbus-next's
// client: (id, properties, children), children already unwrapped from their
// Variants by the client library.
type WireMenuItem = [number, Record<string, DBus.Variant>, DBus.Variant[]];

describe.skipIf(!hasBus)('SNI tray dbusmenu', () => {
  const watcher = new StubWatcher();
  let watcherBus: DBus.MessageBus;
  let clientBus: DBus.MessageBus;
  let tray: SniTray;
  let desktopEnabled = false;
  const clicks: string[] = [];
  // dbus-next client interfaces are dynamically shaped.
  let menu: {
    GetLayout(parentId: number, depth: number, props: string[]): Promise<[number, WireMenuItem]>;
    Event(id: number, eventId: string, data: DBus.Variant, timestamp: number): Promise<void>;
  };

  beforeAll(async () => {
    watcherBus = DBus.sessionBus();
    watcherBus.export('/StatusNotifierWatcher', watcher);
    await watcherBus.requestName(TEST_WATCHER_NAME, 0);

    tray = await createSniTray(
      {
        isDesktopEnabled: () => desktopEnabled,
        toggleDesktop: () => clicks.push('desktop'),
        openEditor: () => clicks.push('editor'),
        quit: () => clicks.push('quit'),
      },
      TEST_WATCHER_NAME,
    );

    clientBus = DBus.sessionBus();
    const obj = await clientBus.getProxyObject(tray.uniqueName, '/MenuBar');
    menu = obj.getInterface('com.canonical.dbusmenu') as unknown as typeof menu;
  });

  afterAll(async () => {
    tray?.stop();
    clientBus?.disconnect();
    watcherBus?.disconnect();
  });

  it('registered with the watcher using the path-based form', () => {
    expect(watcher.registered).toEqual(['/StatusNotifierItem']);
  });

  // The regression this file exists for: every child in the layout's `av`
  // slot must be a Variant of the item struct. A raw tuple fails the reply
  // marshalling, the tray host receives an error instead of a layout, and
  // the menu silently never opens.
  it('GetLayout marshals the full menu (the reply reaches the client)', async () => {
    const [revision, root] = await menu.GetLayout(0, -1, []);
    expect(revision).toBeGreaterThanOrEqual(1);
    const [rootId, , children] = root;
    expect(rootId).toBe(0);
    const items = children.map((v) => v.value as WireMenuItem);
    const labelOf = (item: WireMenuItem): string =>
      (item[1].label?.value as string | undefined) ?? '';
    expect(items.map(labelOf)).toEqual(['Desktop mode', 'Open Editor', '', 'Quit']);
    expect(items[2]?.[1].type?.value).toBe('separator');
  });

  it('reflects the live desktop state in the checkbox item', async () => {
    desktopEnabled = true;
    tray.refreshMenu();
    const [, root] = await menu.GetLayout(0, -1, []);
    const desktopItem = root[2][0]?.value as WireMenuItem;
    expect(desktopItem[1]['toggle-state']?.value).toBe(1);
  });

  it('dispatches clicked events to the wired deps', async () => {
    await menu.Event(1, 'clicked', new DBus.Variant('s', ''), 0);
    await menu.Event(2, 'clicked', new DBus.Variant('s', ''), 0);
    await menu.Event(4, 'clicked', new DBus.Variant('s', ''), 0);
    // A non-click event must not dispatch.
    await menu.Event(4, 'hovered', new DBus.Variant('s', ''), 0);
    expect(clicks).toEqual(['desktop', 'editor', 'quit']);
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * System-tray icon for the standalone core (#457 D4): a StatusNotifierItem +
 * dbusmenu implementation straight over the session bus (the SNI protocol IS
 * D-Bus, so no UI toolkit is needed in the Node process). Provides the
 * desktop-mode checkbox, Open Editor, Quit, the per-state icon + tooltip
 * (#199); left-click opens the editor.
 *
 * Icons resolve through the SNI `IconThemePath` property pointing at the
 * bundled tray icon dir (assets/tray). The host looks the icon name up flat in
 * that path and finds the scalable SVG, so it renders at the exact panel
 * resolution without a pixmap decoder (#498). Hosts without a
 * StatusNotifierWatcher (non-KDE) fail registration; the caller logs and
 * continues without a tray.
 */

import DBus from 'dbus-next';

import type { DesktopState } from '../main/desktop-interpreter.js';
import { resourcePath } from '../main/resources.js';

const { Variant } = DBus;

export type SniTrayDeps = {
  isDesktopEnabled: () => boolean;
  toggleDesktop: () => void;
  openEditor: () => void;
  quit: () => void;
};

export type SniTray = {
  /** Reflect the desktop-mode state: icon + tooltip + menu checkbox. */
  setState: (state: DesktopState) => void;
  /** Rebuild the menu (the checkbox) after an enabled change that didn't
   *  move the icon state. */
  refreshMenu: () => void;
  /** The tray connection's unique bus name; the integration test addresses
   *  GetLayout through it (the SNI registration is path-based, so no
   *  well-known name exists for the item). */
  uniqueName: string;
  /** Close the tray's bus connection. Tests need it so the event loop can
   *  drain; the app itself lets process exit clean up. */
  stop: () => void;
};

const ITEM_PATH = '/StatusNotifierItem';
const MENU_PATH = '/MenuBar';

// Icon names per desktop-mode state (#199, #498); the SVGs live in assets/tray
// and are resolved flat via IconThemePath. `engaged` (both the pie and the
// desktop reachable) shows the diagonally split icon, `active` (desktop engaged
// via the toggle button) the colourful one; off/suspended show the normal logo
// (the open pie is its own cue). All three ship as scalable SVG (the split is
// built from plain shapes, no clipPath, which the host's renderer ignores).
const ICON_NAME: Record<DesktopState, string> = {
  off: 'tray-icon',
  engaged: 'tray-icon-split',
  active: 'tray-icon-active',
  suspended: 'tray-icon',
};

const TOOLTIP: Record<DesktopState, string> = {
  off: 'SpaceUX',
  engaged: 'SpaceUX (desktop mode ready)',
  active: 'SpaceUX (desktop mode active)',
  suspended: 'SpaceUX',
};

// dbusmenu item ids (0 is the protocol's root container).
const ID_ROOT = 0;
const ID_DESKTOP = 1;
const ID_OPEN_EDITOR = 2;
const ID_SEPARATOR = 3;
const ID_QUIT = 4;

// One dbusmenu layout node: (id, properties, children). The children slot is
// `av` on the wire, so every child must be WRAPPED in a Variant of the item
// struct type; a raw tuple fails dbus-next's marshalling and the tray host
// then gets no menu at all (an error reply instead of the layout).
type MenuLayoutItem = [number, Record<string, DBus.Variant>, DBus.Variant[]];

const MENU_ITEM_SIGNATURE = '(ia{sv}av)';
const menuItemVariant = (item: MenuLayoutItem): DBus.Variant =>
  new Variant(MENU_ITEM_SIGNATURE, item);

class StatusNotifierItem extends DBus.interface.Interface {
  state: DesktopState = 'off';

  constructor(private readonly deps: SniTrayDeps) {
    super('org.kde.StatusNotifierItem');
  }

  // Properties (read by the host).
  get Category(): string {
    return 'ApplicationStatus';
  }
  get Id(): string {
    return 'spaceux';
  }
  get Title(): string {
    return 'SpaceUX';
  }
  get Status(): string {
    return 'Active';
  }
  get IconName(): string {
    return ICON_NAME[this.state];
  }
  get IconThemePath(): string {
    return resourcePath('assets', 'tray');
  }
  get ToolTip(): [string, unknown[], string, string] {
    return [ICON_NAME[this.state], [], TOOLTIP[this.state], ''];
  }
  get Menu(): DBus.ObjectPath {
    return MENU_PATH;
  }
  get ItemIsMenu(): boolean {
    return false;
  }

  // Left-click (where the host routes it).
  Activate(): void {
    this.deps.openEditor();
  }
  SecondaryActivate(): void {
    this.deps.openEditor();
  }
  ContextMenu(): void {
    // The host renders the dbusmenu itself; nothing to do.
  }
  Scroll(): void {}

  NewIcon(): void {}
  NewToolTip(): void {}
}

StatusNotifierItem.configureMembers({
  properties: {
    Category: { signature: 's', access: DBus.interface.ACCESS_READ },
    Id: { signature: 's', access: DBus.interface.ACCESS_READ },
    Title: { signature: 's', access: DBus.interface.ACCESS_READ },
    Status: { signature: 's', access: DBus.interface.ACCESS_READ },
    IconName: { signature: 's', access: DBus.interface.ACCESS_READ },
    IconThemePath: { signature: 's', access: DBus.interface.ACCESS_READ },
    ToolTip: { signature: '(sa(iiay)ss)', access: DBus.interface.ACCESS_READ },
    Menu: { signature: 'o', access: DBus.interface.ACCESS_READ },
    ItemIsMenu: { signature: 'b', access: DBus.interface.ACCESS_READ },
  },
  methods: {
    Activate: { inSignature: 'ii', outSignature: '' },
    SecondaryActivate: { inSignature: 'ii', outSignature: '' },
    ContextMenu: { inSignature: 'ii', outSignature: '' },
    Scroll: { inSignature: 'is', outSignature: '' },
  },
  signals: {
    NewIcon: { signature: '' },
    NewToolTip: { signature: '' },
  },
});

class DbusMenu extends DBus.interface.Interface {
  revision = 1;

  constructor(private readonly deps: SniTrayDeps) {
    super('com.canonical.dbusmenu');
  }

  get Version(): number {
    return 3;
  }
  get Status(): string {
    return 'normal';
  }

  private itemProps(id: number): Record<string, DBus.Variant> {
    switch (id) {
      case ID_DESKTOP:
        return {
          label: new Variant('s', 'Desktop mode'),
          'toggle-type': new Variant('s', 'checkmark'),
          'toggle-state': new Variant('i', this.deps.isDesktopEnabled() ? 1 : 0),
        };
      case ID_OPEN_EDITOR:
        return { label: new Variant('s', 'Open Editor') };
      case ID_SEPARATOR:
        return { type: new Variant('s', 'separator') };
      case ID_QUIT:
        return { label: new Variant('s', 'Quit') };
      default:
        return { 'children-display': new Variant('s', 'submenu') };
    }
  }

  GetLayout(
    parentId: number,
    _recursionDepth: number,
    _propertyNames: string[],
  ): [number, MenuLayoutItem] {
    const children: DBus.Variant[] =
      parentId === ID_ROOT
        ? [ID_DESKTOP, ID_OPEN_EDITOR, ID_SEPARATOR, ID_QUIT].map((id) =>
            menuItemVariant([id, this.itemProps(id), []]),
          )
        : [];
    return [this.revision, [parentId, this.itemProps(parentId), children]];
  }

  GetGroupProperties(
    ids: number[],
    _propertyNames: string[],
  ): [number, Record<string, DBus.Variant>][] {
    return ids.map((id) => [id, this.itemProps(id)]);
  }

  GetProperty(id: number, name: string): DBus.Variant {
    return this.itemProps(id)[name] ?? new Variant('s', '');
  }

  Event(id: number, eventId: string, _data: unknown, _timestamp: number): void {
    if (eventId !== 'clicked') return;
    if (id === ID_DESKTOP) this.deps.toggleDesktop();
    else if (id === ID_OPEN_EDITOR) this.deps.openEditor();
    else if (id === ID_QUIT) this.deps.quit();
  }

  EventGroup(events: [number, string, unknown, number][]): number[] {
    for (const [id, eventId, data, ts] of events) this.Event(id, eventId, data, ts);
    return [];
  }

  AboutToShow(_id: number): boolean {
    return false;
  }

  AboutToShowGroup(_ids: number[]): [number[], number[]] {
    return [[], []];
  }

  LayoutUpdated(): [number, number] {
    return [this.revision, ID_ROOT];
  }
}

DbusMenu.configureMembers({
  properties: {
    Version: { signature: 'u', access: DBus.interface.ACCESS_READ },
    Status: { signature: 's', access: DBus.interface.ACCESS_READ },
  },
  methods: {
    GetLayout: { inSignature: 'iias', outSignature: 'u(ia{sv}av)' },
    GetGroupProperties: { inSignature: 'aias', outSignature: 'a(ia{sv})' },
    GetProperty: { inSignature: 'is', outSignature: 'v' },
    Event: { inSignature: 'isvu', outSignature: '' },
    EventGroup: { inSignature: 'a(isvu)', outSignature: 'ai' },
    AboutToShow: { inSignature: 'i', outSignature: 'b' },
    AboutToShowGroup: { inSignature: 'ai', outSignature: 'abab' },
  },
  signals: {
    LayoutUpdated: { signature: 'ui' },
  },
});

/**
 * Export the item + menu and register with the StatusNotifierWatcher. Throws
 * when no watcher is available (no SNI host on this session); the caller
 * decides how loud that is.
 */
/** The desktop's watcher (Plasma). Injectable so the integration test can
 *  register against its own stub without touching the real tray. */
const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';

export async function createSniTray(
  deps: SniTrayDeps,
  watcherName: string = WATCHER_NAME,
): Promise<SniTray> {
  const bus = DBus.sessionBus();
  const item = new StatusNotifierItem(deps);
  const menu = new DbusMenu(deps);
  bus.export(ITEM_PATH, item);
  bus.export(MENU_PATH, menu);

  const watcherObj = await bus.getProxyObject(watcherName, '/StatusNotifierWatcher');
  const watcher = watcherObj.getInterface('org.kde.StatusNotifierWatcher') as unknown as {
    RegisterStatusNotifierItem: (service: string) => Promise<void>;
  };
  // Registering with the object path makes the watcher use the caller's
  // unique bus name for the item (the path-based SNI registration form).
  await watcher.RegisterStatusNotifierItem(ITEM_PATH);

  const bumpMenu = (): void => {
    menu.revision += 1;
    DbusMenu.prototype.LayoutUpdated.call(menu);
  };

  return {
    setState: (state) => {
      item.state = state;
      StatusNotifierItem.prototype.NewIcon.call(item);
      StatusNotifierItem.prototype.NewToolTip.call(item);
      bumpMenu();
    },
    refreshMenu: bumpMenu,
    uniqueName: (bus as unknown as { name: string }).name,
    stop: () => bus.disconnect(),
  };
}

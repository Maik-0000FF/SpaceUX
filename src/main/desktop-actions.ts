// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import DBus from 'dbus-next';

import { describeError } from '../shared/errors.js';

import { IPC_TIMEOUT_MS } from './compositor-ipc.js';

const execFileAsync = promisify(execFile);

/**
 * Desktop-action backends for desktop mode (#199): switch virtual desktop /
 * workspace, toggle the Overview effect, and show/hide the desktop. The backend
 * is chosen per compositor (#507) by {@link createDesktopBackend}: KDE drives
 * KWin + KGlobalAccel over D-Bus; Hyprland drives `hyprctl`; mango drives its
 * IPC (`mmsg`); anything else gets a no-op backend so a desktop action is inert
 * rather than erroring. The CLI backends use tools on PATH, so the same code
 * runs unchanged across distros (Arch, Debian/Ubuntu, NixOS).
 *
 * The KDE dispatch is split from the transport so it can be unit-tested: the
 * factory takes a `DbusCall`, and the real session-bus implementation lives in
 * `createSessionBusCall`.
 */

/** A single D-Bus method call. `args` must match `signature` (omit both for a
 *  no-argument method). */
export type DbusRequest = {
  service: string;
  path: string;
  iface: string;
  member: string;
  signature?: string;
  args?: unknown[];
};

export type DbusCall = (req: DbusRequest) => Promise<void>;

export type DesktopBackend = {
  /** Switch virtual desktop: direction >= 0 goes to the next, < 0 the previous. */
  switchWorkspace: (direction: number) => Promise<void>;
  /** Toggle the Overview effect (the shortcut toggles it on/off itself). */
  toggleOverview: () => Promise<void>;
  /** Show or hide the desktop (minimize all / restore). The caller tracks the
   *  on/off state since KWin's method sets it explicitly rather than toggling. */
  showDesktop: (active: boolean) => Promise<void>;
};

// KWin's scriptable D-Bus surface for desktop navigation.
const KWIN_SERVICE = 'org.kde.KWin';
const KWIN_PATH = '/KWin';
const KWIN_IFACE = 'org.kde.KWin';

// KGlobalAccel component that owns KWin's effect shortcuts; invokeShortcut runs
// one by its unique name. 'Overview' is the Plasma 6 Overview effect; swap to
// 'ExposeAll' for the older Present Windows effect if preferred.
const KGLOBALACCEL_SERVICE = 'org.kde.kglobalaccel';
const KGLOBALACCEL_KWIN_PATH = '/component/kwin';
const KGLOBALACCEL_COMPONENT_IFACE = 'org.kde.kglobalaccel.Component';
const OVERVIEW_SHORTCUT = 'Overview';

export function createKdeDesktopBackend(call: DbusCall): DesktopBackend {
  return {
    switchWorkspace: (direction) =>
      call({
        service: KWIN_SERVICE,
        path: KWIN_PATH,
        iface: KWIN_IFACE,
        member: direction >= 0 ? 'nextDesktop' : 'previousDesktop',
      }),
    toggleOverview: () =>
      call({
        service: KGLOBALACCEL_SERVICE,
        path: KGLOBALACCEL_KWIN_PATH,
        iface: KGLOBALACCEL_COMPONENT_IFACE,
        member: 'invokeShortcut',
        signature: 's',
        args: [OVERVIEW_SHORTCUT],
      }),
    showDesktop: (active) =>
      call({
        service: KWIN_SERVICE,
        path: KWIN_PATH,
        iface: KWIN_IFACE,
        member: 'showDesktop',
        signature: 'b',
        args: [active],
      }),
  };
}

/**
 * The real transport: a lazily-opened session-bus connection (its own handle,
 * never shared with the overlay or cursor connections) that sends each request
 * as a D-Bus method call. Best-effort: a failure (e.g. the method name differs
 * on this Plasma version) is logged, never thrown, mirroring the inject/LED
 * fail-soft behaviour so a desktop action can't crash the app.
 */
// eslint-disable-next-line no-console
export function createSessionBusCall(log: (message: string) => void = console.error): DbusCall {
  let bus: DBus.MessageBus | null = null;
  return async (req) => {
    try {
      bus ??= DBus.sessionBus();
      await bus.call(
        new DBus.Message({
          destination: req.service,
          path: req.path,
          interface: req.iface,
          member: req.member,
          signature: req.signature,
          body: req.args,
        }),
      );
    } catch (err) {
      log(`spaceux: desktop action ${req.member} failed: ${describeError(err)}`);
    }
  };
}

// ── mango (dwl-derived wlroots) ───────────────────────────────────────────────

/** mango ships 9 fixed tags (preset.h), the virtual-desktop equivalent. */
const MANGO_TAG_MIN = 1;
const MANGO_TAG_MAX = 9;

/** The tag to switch to from `current` in `direction` (>= 0 next, < 0 prev),
 *  wrapping within the fixed 1..9 range. Pure, so it is unit-tested without the
 *  compositor. */
export function nextMangoTag(current: number, direction: number): number {
  const step = direction >= 0 ? 1 : -1;
  let target = current + step;
  if (target > MANGO_TAG_MAX) target = MANGO_TAG_MIN;
  if (target < MANGO_TAG_MIN) target = MANGO_TAG_MAX;
  return target;
}

/** The currently-viewed tag on mango's active monitor, via `mmsg get
 *  all-monitors`, or null when it cannot be read. Takes the first active tag if
 *  several are viewed at once (the common case is a single tag). */
async function mangoActiveTag(): Promise<number | null> {
  const { stdout } = await execFileAsync('mmsg', ['get', 'all-monitors'], {
    timeout: IPC_TIMEOUT_MS,
  });
  const data = JSON.parse(stdout) as {
    monitors?: { active?: boolean; active_tags?: number[] }[];
  };
  const monitors = data.monitors ?? [];
  const monitor = monitors.find((m) => m.active) ?? monitors[0];
  const tags = monitor?.active_tags;
  return Array.isArray(tags) && typeof tags[0] === 'number' ? tags[0] : null;
}

/**
 * mango backend: switches tags via `mmsg dispatch view,<tag>,0` (computed
 * relative to the active tag). mango has no Overview effect and no show-desktop,
 * so those degrade to a logged no-op, mirroring the KDE backend's fail-soft,
 * fire-and-forget behaviour.
 */
export function createMangoDesktopBackend(
  // eslint-disable-next-line no-console
  log: (message: string) => void = console.error,
): DesktopBackend {
  return {
    switchWorkspace: async (direction) => {
      try {
        const current = await mangoActiveTag();
        if (current === null) {
          log('spaceux: mango switchWorkspace: no active tag reported');
          return;
        }
        const target = nextMangoTag(current, direction);
        await execFileAsync('mmsg', ['dispatch', `view,${target},0`], { timeout: IPC_TIMEOUT_MS });
      } catch (err) {
        log(`spaceux: mango switchWorkspace failed: ${describeError(err)}`);
      }
    },
    toggleOverview: () => {
      log('spaceux: mango has no overview effect; toggleOverview is a no-op');
      return Promise.resolve();
    },
    showDesktop: () => {
      log('spaceux: mango has no show-desktop; showDesktop is a no-op');
      return Promise.resolve();
    },
  };
}

// ── Hyprland (wlroots) ────────────────────────────────────────────────────────

/**
 * Hyprland backend: switches workspaces via `hyprctl dispatch workspace e+1/e-1`
 * (cycle existing workspaces). Hyprland has no core Overview or show-desktop, so
 * those degrade to a logged no-op (a user may bind a plugin such as hyprexpo,
 * but SpaceUX does not assume one). Fail-soft like the other backends.
 */
export function createHyprlandDesktopBackend(
  // eslint-disable-next-line no-console
  log: (message: string) => void = console.error,
): DesktopBackend {
  const hyprctl = async (...args: string[]): Promise<void> => {
    try {
      await execFileAsync('hyprctl', args, { timeout: IPC_TIMEOUT_MS });
    } catch (err) {
      log(`spaceux: hyprctl ${args.join(' ')} failed: ${describeError(err)}`);
    }
  };
  return {
    switchWorkspace: (direction) =>
      hyprctl('dispatch', 'workspace', direction >= 0 ? 'e+1' : 'e-1'),
    toggleOverview: () => {
      log('spaceux: Hyprland has no core overview; toggleOverview is a no-op');
      return Promise.resolve();
    },
    showDesktop: () => {
      log('spaceux: Hyprland has no show-desktop; showDesktop is a no-op');
      return Promise.resolve();
    },
  };
}

/** A backend for a compositor with no desktop-action support: every action is a
 *  logged no-op, so desktop mode stays inert instead of erroring. */
export function createNoopDesktopBackend(
  // eslint-disable-next-line no-console
  log: (message: string) => void = console.error,
): DesktopBackend {
  const noop = (name: string) => (): Promise<void> => {
    log(`spaceux: no desktop backend for this compositor; ${name} is a no-op`);
    return Promise.resolve();
  };
  return {
    switchWorkspace: noop('switchWorkspace'),
    toggleOverview: noop('toggleOverview'),
    showDesktop: noop('showDesktop'),
  };
}

/**
 * Pick the desktop-action backend for the running desktop (#507): the normalised
 * id from {@link readHostEnvironment} (`kde`, `mango`, ...). KDE keeps its KWin
 * D-Bus path (the `dbusCall` transport is consumed only there); mango uses its
 * IPC; anything else gets the no-op backend.
 */
export function createDesktopBackend(desktop: string, dbusCall: DbusCall): DesktopBackend {
  switch (desktop) {
    case 'kde':
      return createKdeDesktopBackend(dbusCall);
    case 'hyprland':
      return createHyprlandDesktopBackend();
    case 'mango':
      return createMangoDesktopBackend();
    default:
      return createNoopDesktopBackend();
  }
}

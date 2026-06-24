// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Core entrypoint (#457): bring up the service state, assemble the full
 * CoreService over it, and export it as `org.spaceux.Core` on the session
 * bus. This is the app's long-running process: it owns the daemon-driven
 * runtime (pie + desktop mode) and serves the editor client.
 *
 * Process model (D6): this core is the long-running owner, launched on login
 * (the autostart entry) or by the launcher. It owns the daemon connection,
 * the pie runtime, desktop mode and the tray. The Qt editor is a separate
 * client process the tray (or a second launch) spawns on demand.
 */

import { spawn } from 'node:child_process';

import { ensureAutostartSeeded, migrateAutostartExecFlag } from '../main/autostart.js';
import { EDITOR_INTERFACE, EDITOR_OBJECT_PATH, EDITOR_SERVICE } from '../shared/core-contract.js';
import { BACKGROUND_FLAG } from '../shared/launch.js';
import { withTimeout } from '../shared/with-timeout.js';
import { resourcePath } from '../main/resources.js';
import { describeError } from '../shared/errors.js';

import { buildCoreService } from './core-service-builder.js';
import { loadCoreState } from './core-state.js';
import { claimCoreBusName, exportCoreService, type CoreServerHandle } from './dbus-server.js';
import { createSniTray } from './sni-tray.js';

/** Spawn the Qt editor, detached. Unrefs only once the spawn succeeded, so a
 *  caller that exits right after (the second-instance path) still lives long
 *  enough to log a missing binary instead of dying before the error event. */
function openEditor(): void {
  const bin = resourcePath('build', 'spaceux-editor');
  const child = spawn(bin, [], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn(`[core] failed to launch the editor (${bin}): ${describeError(err)}`);
  });
  child.on('spawn', () => child.unref());
}

async function main(): Promise<void> {
  // The login autostart entry starts the core silently; an interactive launch
  // (app menu, terminal) opens the editor as well, so the first run is visible
  // instead of just dropping a tray icon (#497). The flag gates the editor in
  // both single-instance branches below.
  const interactive = !process.argv.includes(BACKGROUND_FLAG);

  // Single instance (#415): the first core owns the bus name. Probe it before
  // anything else exists (no daemon, watchers or runtime yet). A relaunch that
  // finds a running core just opens the editor (when interactive), then exits.
  const bus = await claimCoreBusName();
  if (bus === null) {
    // eslint-disable-next-line no-console
    console.error(
      `[core] another instance owns org.spaceux.Core${interactive ? ', opening the editor' : ''}`,
    );
    if (interactive) openEditor();
    return;
  }

  const state = await loadCoreState();

  // Deferred emit: the service's effects reference `handle`, which only exists
  // after the server is exported. Methods (and therefore any signal emit) run
  // after startup, so the optional chain only no-ops during the brief bring-up.
  let handle: CoreServerHandle | null = null;
  const {
    service,
    pieRuntime,
    desktop,
    shutdown: teardownRuntime,
  } = buildCoreService(state, (signal, payload) => handle?.emit(signal, payload));
  handle = exportCoreService(bus, service);

  // A stopped core must not leave an open pie behind (overlay child process,
  // the exclusive grab, the LED) nor desktop mode's grab: tear both down on
  // the usual signals. The overlay child also dies with us via PDEATHSIG.
  const shutdown = (): void => {
    pieRuntime.hide();
    teardownRuntime();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // The tray's Quit ends the whole app, the editor included (it is a separate
  // process, so it must be asked over the bus). Best-effort with a budget that
  // covers the editor's own close-time window-size flush; a missing or
  // unresponsive editor never blocks the core's exit. The editor deliberately
  // stays open when the core dies WITHOUT this call (crash / restart): its
  // service watcher reconnects when a core returns.
  const EDITOR_QUIT_TIMEOUT_MS = 3000;
  const quitApp = (): void => {
    void (async () => {
      try {
        const obj = await withTimeout(
          bus.getProxyObject(EDITOR_SERVICE, EDITOR_OBJECT_PATH),
          EDITOR_QUIT_TIMEOUT_MS,
          'editor quit',
        );
        const editor = obj.getInterface(EDITOR_INTERFACE) as unknown as {
          Quit(): Promise<void>;
        };
        await withTimeout(editor.Quit(), EDITOR_QUIT_TIMEOUT_MS, 'editor quit');
      } catch {
        // No editor running, or it did not answer in time: quit anyway.
      }
      shutdown();
    })();
  };

  // System tray (D4): SNI directly over the bus. The tray is the primary
  // entry to the editor and shows the desktop-mode state; a session without
  // an SNI host just runs without one.
  try {
    const tray = await createSniTray({
      isDesktopEnabled: desktop.isEnabled,
      toggleDesktop: desktop.toggle,
      openEditor,
      quit: quitApp,
    });
    // Seed the startup state: onState only fires on CHANGES, so a boot with
    // persisted always-on would otherwise show the inactive icon until the
    // state next moves.
    tray.setState(desktop.getState());
    desktop.onState((st) => tray.setState(st));
    desktop.onSettingsApplied(() => tray.refreshMenu());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[tray] StatusNotifier unavailable: ${describeError(err)}`);
  }

  // Seed launch-on-login ON once per install (only when the launcher exists,
  // so a dev run from source doesn't drop a dead autostart entry). Best-effort
  // and off the critical startup path; afterwards the .desktop file's presence
  // alone is the toggle state (see autostart.ts). The migration brings an
  // already-seeded entry up to the silent BACKGROUND_FLAG form (#497) so it
  // does not start opening the editor at every login.
  void ensureAutostartSeeded(resourcePath('assets', 'icon.png'));
  void migrateAutostartExecFlag();

  // An interactive launch opens the editor even on this first start (we are the
  // core), so the app-menu click is not a silent no-op. Done after the service
  // is exported, so the editor connects to a ready core; a redundant open is
  // safe (the editor's single instance just raises its window).
  if (interactive) openEditor();

  // eslint-disable-next-line no-console
  console.error('[core] org.spaceux.Core ready on the session bus');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[core] fatal:', err);
  process.exit(1);
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import DBus from 'dbus-next';
import { app } from 'electron';

import { describeError } from '../shared/errors.js';

/**
 * KDE Wayland helper that fetches the global cursor position via a
 * KWin script over DBus. Same technique Kando uses on KDE — Electron's
 * screen.getCursorScreenPoint() returns a stale value on Wayland
 * (clients are not allowed to query the global cursor), so we round-
 * trip through KWin's scripting engine which has compositor-level
 * access.
 *
 * Wire:
 *   1. write get-cursor.js to disk (KWin can only load scripts from
 *      file paths, not inline source)
 *   2. claim our DBus name and export the receiving interface
 *   3. on each getCursor() call: ask KWin to load+run the script via
 *      org.kde.KWin /Scripting; the script's callDBus() lands in
 *      sendCursor() back here
 *   4. resolve with the position, or reject on timeout
 *
 * Init/getCursor failures throw — the caller should fall back to
 * screen.getCursorScreenPoint() so the app still works (just with
 * the stale Wayland coordinate) when KWin isn't reachable.
 */

const SERVICE_NAME = 'app.spaceux.SpaceUX';
const OBJECT_PATH = '/app/spaceux/SpaceUX';
const INTERFACE_NAME = 'app.spaceux.SpaceUX';
const SCRIPT_FILENAME = 'get-cursor.js';
const SCRIPT_TIMEOUT_MS = 1000;

// The script runs inside KWin's QtScript engine, reads
// `workspace.cursorPos`, then callDBus()s back to our service. It
// has to be a single statement / no semicolons in unexpected places
// because KWin's parser is picky about line endings.
const SCRIPT_BODY = `callDBus('${SERVICE_NAME}', '${OBJECT_PATH}', '${INTERFACE_NAME}', 'sendCursor', workspace.cursorPos.x, workspace.cursorPos.y, () => { console.log('SpaceUX: cursor sent'); });
`;

class CursorInterface extends DBus.interface.Interface {
  public callback: ((x: number, y: number) => void) | null = null;

  /** Called by the KWin script with the live cursor coordinates. */
  public sendCursor(x: number, y: number): void {
    if (this.callback) this.callback(x, y);
  }
}

CursorInterface.configureMembers({
  methods: {
    sendCursor: { inSignature: 'ii', outSignature: '', noReply: false },
  },
});

type ScriptingProxy = DBus.ClientInterface & {
  loadScript(scriptPath: string): Promise<number>;
};

export class KWinCursorService {
  private cursorIface: CursorInterface;
  private bus: DBus.MessageBus | null = null;
  private scriptingIface: ScriptingProxy | null = null;
  private scriptPath: string;
  // KWin 6 introduced /Scripting/Script<id> as the per-script DBus
  // path. Plasma 5 used /<id>. Default to 6 — that's where Plasma
  // has lived since 2024.
  private kwinMajor = 6;

  constructor() {
    this.cursorIface = new CursorInterface(INTERFACE_NAME);
    this.scriptPath = path.join(app.getPath('sessionData'), 'kwin_scripts', SCRIPT_FILENAME);
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.scriptPath), { recursive: true });
    fs.writeFileSync(this.scriptPath, SCRIPT_BODY);

    this.bus = DBus.sessionBus();
    await this.bus.requestName(SERVICE_NAME, 0);
    this.bus.export(OBJECT_PATH, this.cursorIface);

    const proxy = await this.bus.getProxyObject('org.kde.KWin', '/Scripting');
    this.scriptingIface = proxy.getInterface('org.kde.kwin.Scripting') as ScriptingProxy;
    this.kwinMajor = await this.detectKWinMajor();
  }

  async getCursor(): Promise<{ x: number; y: number }> {
    if (!this.scriptingIface || !this.bus) {
      throw new Error('KWinCursorService not initialised');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cursorIface.callback = null;
        reject(new Error('KWin cursor script did not reply in time'));
      }, SCRIPT_TIMEOUT_MS);

      this.cursorIface.callback = (x, y) => {
        clearTimeout(timer);
        this.cursorIface.callback = null;
        resolve({ x, y });
      };

      this.runScript().catch((err: unknown) => {
        clearTimeout(timer);
        this.cursorIface.callback = null;
        reject(new Error(`failed to run KWin script: ${describeError(err)}`));
      });
    });
  }

  private async runScript(): Promise<void> {
    if (!this.scriptingIface || !this.bus) throw new Error('Not initialised');
    const id = await this.scriptingIface.loadScript(this.scriptPath);
    const dbusPath = (this.kwinMajor >= 6 ? '/Scripting/Script' : '/') + id;
    await this.bus.call(
      new DBus.Message({
        destination: 'org.kde.KWin',
        path: dbusPath,
        interface: 'org.kde.kwin.Script',
        member: 'run',
      }),
    );
    await this.bus.call(
      new DBus.Message({
        destination: 'org.kde.KWin',
        path: dbusPath,
        interface: 'org.kde.kwin.Script',
        member: 'stop',
      }),
    );
  }

  private detectKWinMajor(): Promise<number> {
    return new Promise((resolve) => {
      exec('kwin_wayland --version', (err, stdout) => {
        if (err) {
          resolve(6);
          return;
        }
        const parts = stdout.split(' ')[1]?.split('.') ?? [];
        const major = parseInt(parts[0] ?? '', 10);
        resolve(Number.isFinite(major) && major > 0 ? major : 6);
      });
    });
  }
}

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';

import { openEditorWindow } from './editor-window.js';

// Held at module scope so V8 doesn't garbage-collect the Tray — a
// collected tray icon silently vanishes from the system tray.
let tray: Tray | null = null;

/** Create the system-tray icon and its context menu. The tray is the
 *  primary entry point to the editor window (the pie overlay has no
 *  chrome of its own). Icon is resolved from the repo `assets/` dir;
 *  nativeImage auto-selects `tray-icon@2x.png` on HiDPI displays. */
export function createTray(repoRoot: string): void {
  // TODO(packaging): repoRoot is `__dirname/../..`, which points at the
  // real assets/ only while running unpackaged. Once app.isPackaged,
  // __dirname lives inside the asar and this path won't resolve — the
  // tray icon (and plugin/asset loading, which share this assumption)
  // need an extraResource/files bundling strategy.
  const icon = nativeImage.createFromPath(path.join(repoRoot, 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('SpaceUX');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Editor', click: () => void openEditorWindow() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(contextMenu);
  // Left-click is inconsistent across Linux tray hosts (many route
  // everything through the context menu), but where it fires it's the
  // expected "open the app" gesture.
  tray.on('click', () => void openEditorWindow());
}

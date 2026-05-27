// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { Menu, nativeImage, Tray } from 'electron';

import { openEditorWindow } from './editor-window.js';
import { resourcePath } from './resources.js';

// Held at module scope so V8 doesn't garbage-collect the Tray — a
// collected tray icon silently vanishes from the system tray.
let tray: Tray | null = null;

/** Create the system-tray icon and its context menu. The tray is the
 *  primary entry point to the editor window (the pie overlay has no
 *  chrome of its own). Icon is resolved via resourcePath (repo `assets/`
 *  unpackaged, process.resourcesPath packaged); nativeImage auto-selects
 *  `tray-icon@2x.png` on HiDPI displays. */
export function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('assets', 'tray-icon.png'));
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

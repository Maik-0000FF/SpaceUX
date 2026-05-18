// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';

import { dedupPreserveOrder } from '../shared/util.js';

import { loadMenuConfig, type MenuLoadResult } from './menu-loader.js';

/**
 * Watch the XDG search paths for changes to menu.json and call
 * `onChange` with a freshly-loaded MenuLoadResult on every edit.
 *
 * We watch the *containing directories* (not the files themselves)
 * so that a fresh menu.json appearing in a previously-empty config
 * directory still triggers a reload. fs.watch on a non-existent path
 * throws synchronously, so those directories are skipped — creating
 * the XDG dir itself after app start needs an app restart to start
 * watching it. Acceptable for Phase 2.
 *
 * Editor saves often produce a burst of events (atomic rename, swap
 * files, separate inode for the temp write). A short debounce
 * coalesces those into one reload.
 */

const MENU_FILENAME = 'menu.json';
const DEBOUNCE_MS = 150;

export function watchMenuConfig(
  searchPaths: string[],
  onChange: (result: MenuLoadResult) => void,
): () => void {
  const dirs = dedupPreserveOrder<string>(searchPaths.map((p) => path.dirname(p))).filter((d) =>
    fs.existsSync(d),
  );

  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void loadMenuConfig(searchPaths).then(onChange);
    }, DEBOUNCE_MS);
  };

  const watchers = dirs.map((dir) => {
    const w = fs.watch(dir, (_event, filename) => {
      // filename can be null on some Linux configurations; treat
      // that as a conservative "something changed in this dir" and
      // reload anyway. When we do know the filename, only menu.json
      // is interesting.
      if (filename !== null && filename !== MENU_FILENAME) return;
      schedule();
    });
    // A watcher can emit 'error' (e.g. the directory was deleted
    // under us). Swallow it so one bad watcher can't crash main —
    // the file's gone, the next reload will fall back to defaults.
    w.on('error', () => {});
    return w;
  });

  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

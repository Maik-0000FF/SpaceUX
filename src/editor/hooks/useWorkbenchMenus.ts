// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

/**
 * The ids of curated per-workbench pies that exist on disk (#193): pulled on
 * mount, then kept live via EDITOR_WORKBENCH_MENUS_CHANGED so the FreeCAD
 * workbench dropdown's "already curated" markers stay in sync as pies are
 * seeded / deleted (from this editor or externally).
 */
export function useWorkbenchMenus(): string[] {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.editor
      .getWorkbenchMenus()
      .then((s) => {
        if (!cancelled) setIds(s.ids);
      })
      .catch(() => {
        // Pull failed → keep empty (no curated pies known).
      });
    const off = window.editor.onWorkbenchMenusChanged((s) => setIds(s.ids));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return ids;
}

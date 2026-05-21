// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import type { PieAppearance } from '@/shared/ipc';

/**
 * Applies the pie appearance to the live overlay: pulls the persisted value
 * on mount and subscribes to changes pushed from main (editor edits), writing
 * `data-pie-theme`, `--pie-opacity` and `--pie-blur` onto <html>. The shared
 * pie-theme.css resolves the theme; `--pie-opacity` scales the pie's overall
 * translucency and `--pie-blur` softens the wedge fills. `--pie-blur` holds a
 * ready `filter` value (`none` when off) so the default applies no filter at
 * all — a constant `blur(0px)` would still force a composited layer. Read-only
 * here — the editor owns the writes.
 */
export function usePieAppearance(): void {
  useEffect(() => {
    let cancelled = false;
    const apply = (a: PieAppearance): void => {
      const root = document.documentElement;
      root.dataset.pieTheme = a.theme;
      root.style.setProperty('--pie-opacity', String(a.opacity));
      root.style.setProperty('--pie-blur', a.blur > 0 ? `blur(${a.blur}px)` : 'none');
    };
    void window.spaceux.getPieAppearance().then((a) => {
      if (!cancelled) apply(a);
    });
    const off = window.spaceux.onPieAppearanceChanged(apply);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
}

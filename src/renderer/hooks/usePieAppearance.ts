// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import type { PieAppearance } from '@/shared/ipc';

/**
 * Applies the pie appearance to the live overlay: pulls the persisted value
 * on mount and subscribes to changes pushed from main (editor edits), writing
 * `data-pie-theme` and the `--pie-opacity` custom property onto <html>. The
 * shared pie-theme.css resolves the theme; `--pie-opacity` scales the pie's
 * overall translucency. Read-only here — the editor owns the writes.
 */
export function usePieAppearance(): void {
  useEffect(() => {
    let cancelled = false;
    const apply = (a: PieAppearance): void => {
      const root = document.documentElement;
      root.dataset.pieTheme = a.theme;
      root.style.setProperty('--pie-opacity', String(a.opacity));
      root.style.setProperty('--pie-label-scale', String(a.labelScale));
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

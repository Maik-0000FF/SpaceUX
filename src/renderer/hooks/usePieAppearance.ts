// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { PieAppearance } from '@/shared/ipc';
import { DEFAULT_PIE_APPEARANCE } from '@/shared/pie-appearance';

/**
 * Set a pie font CSS variable from an override value, or clear it so the
 * variable falls back to its default (`var(--font-ui/mono)` in
 * typography.css). An empty string means "use the bundled default".
 */
function applyFontOverride(root: HTMLElement, prop: string, value: string): void {
  if (value) root.style.setProperty(prop, value);
  else root.style.removeProperty(prop);
}

/**
 * Applies the pie appearance to the live overlay: pulls the persisted value
 * on mount and subscribes to changes pushed from main (editor edits), writing
 * `data-pie-theme` and the `--pie-opacity` custom property onto <html>. The
 * shared pie-theme.css resolves the theme; `--pie-opacity` scales the pie's
 * overall translucency. The theme/opacity/label-size are CSS-driven, but the
 * icon size is an SVG `<image>` dimension computed in TSX, so the appearance
 * is also returned for PieMenu to read `iconScale`. Read-only here — the
 * editor owns the writes.
 */
export function usePieAppearance(): PieAppearance {
  const [appearance, setAppearance] = useState<PieAppearance>(DEFAULT_PIE_APPEARANCE);

  useEffect(() => {
    let cancelled = false;
    const apply = (a: PieAppearance): void => {
      const root = document.documentElement;
      root.dataset.pieTheme = a.theme;
      root.style.setProperty('--pie-opacity', String(a.opacity));
      root.style.setProperty('--pie-label-scale', String(a.labelScale));
      applyFontOverride(root, '--pie-font-ui', a.fontUi);
      applyFontOverride(root, '--pie-font-mono', a.fontMono);
      setAppearance(a);
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

  return appearance;
}

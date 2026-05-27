// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';

import type { PieAppearance, PieThemeChoice } from '@/shared/ipc';
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
 * Owns the pie appearance in the editor: loads the persisted value on mount,
 * applies it to <html> (so MenuPreview, which reads the shared --pie-* tokens
 * and --pie-opacity, tracks it), subscribes to changes from main, and exposes
 * setters for the toolbar controls. Changes are optimistic — the local state
 * updates at once, and main's re-broadcast confirms it (idempotent).
 */
export function usePieAppearance(): {
  appearance: PieAppearance;
  setTheme: (theme: PieThemeChoice) => void;
  setOpacity: (opacity: number) => void;
  setLabelScale: (labelScale: number) => void;
  setIconScale: (iconScale: number) => void;
  setScale: (scale: number) => void;
  setRingBalance: (ringBalance: number) => void;
  setCenterBalance: (centerBalance: number) => void;
  setFontUi: (fontUi: string) => void;
  setFontMono: (fontMono: string) => void;
} {
  const [appearance, setAppearance] = useState<PieAppearance>(DEFAULT_PIE_APPEARANCE);

  useEffect(() => {
    let cancelled = false;
    void window.editor.getPieAppearance().then((a) => {
      if (!cancelled) setAppearance(a);
    });
    const off = window.editor.onPieAppearanceChanged((a) => setAppearance(a));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.pieTheme = appearance.theme;
    root.style.setProperty('--pie-opacity', String(appearance.opacity));
    root.style.setProperty('--pie-label-scale', String(appearance.labelScale));
    applyFontOverride(root, '--pie-font-ui', appearance.fontUi);
    applyFontOverride(root, '--pie-font-mono', appearance.fontMono);
  }, [appearance]);

  const setTheme = useCallback((theme: PieThemeChoice) => {
    setAppearance((a) => ({ ...a, theme }));
    window.editor.setPieAppearance({ theme });
  }, []);

  const setOpacity = useCallback((opacity: number) => {
    setAppearance((a) => ({ ...a, opacity }));
    window.editor.setPieAppearance({ opacity });
  }, []);

  const setLabelScale = useCallback((labelScale: number) => {
    setAppearance((a) => ({ ...a, labelScale }));
    window.editor.setPieAppearance({ labelScale });
  }, []);

  const setIconScale = useCallback((iconScale: number) => {
    setAppearance((a) => ({ ...a, iconScale }));
    window.editor.setPieAppearance({ iconScale });
  }, []);

  const setScale = useCallback((scale: number) => {
    setAppearance((a) => ({ ...a, scale }));
    window.editor.setPieAppearance({ scale });
  }, []);

  const setRingBalance = useCallback((ringBalance: number) => {
    setAppearance((a) => ({ ...a, ringBalance }));
    window.editor.setPieAppearance({ ringBalance });
  }, []);

  const setCenterBalance = useCallback((centerBalance: number) => {
    setAppearance((a) => ({ ...a, centerBalance }));
    window.editor.setPieAppearance({ centerBalance });
  }, []);

  const setFontUi = useCallback((fontUi: string) => {
    setAppearance((a) => ({ ...a, fontUi }));
    window.editor.setPieAppearance({ fontUi });
  }, []);

  const setFontMono = useCallback((fontMono: string) => {
    setAppearance((a) => ({ ...a, fontMono }));
    window.editor.setPieAppearance({ fontMono });
  }, []);

  return {
    appearance,
    setTheme,
    setOpacity,
    setLabelScale,
    setIconScale,
    setScale,
    setRingBalance,
    setCenterBalance,
    setFontUi,
    setFontMono,
  };
}

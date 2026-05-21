// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';

import type { PieAppearance, PieThemeChoice } from '@/shared/ipc';
import { DEFAULT_PIE_APPEARANCE } from '@/shared/pie-appearance';

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
  setBlur: (blur: number) => void;
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
    // A ready filter value (`none` when off) — see the renderer hook: a
    // constant blur(0px) would still force a composited layer at the default.
    root.style.setProperty(
      '--pie-blur',
      appearance.blur > 0 ? `blur(${appearance.blur}px)` : 'none',
    );
  }, [appearance]);

  const setTheme = useCallback((theme: PieThemeChoice) => {
    setAppearance((a) => ({ ...a, theme }));
    window.editor.setPieAppearance({ theme });
  }, []);

  const setOpacity = useCallback((opacity: number) => {
    setAppearance((a) => ({ ...a, opacity }));
    window.editor.setPieAppearance({ opacity });
  }, []);

  const setBlur = useCallback((blur: number) => {
    setAppearance((a) => ({ ...a, blur }));
    window.editor.setPieAppearance({ blur });
  }, []);

  return { appearance, setTheme, setOpacity, setBlur };
}

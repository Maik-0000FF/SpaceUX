// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { ThemeChoice } from '@/shared/ipc';

/**
 * Owns the editor's theme choice: loads the persisted value on mount,
 * applies it to <html> (resolving 'system' via prefers-color-scheme and
 * tracking OS changes), and persists changes. Returns the current choice
 * and a setter for the toolbar control.
 */
export function useThemePreference(): {
  theme: ThemeChoice;
  changeTheme: (next: ThemeChoice) => void;
} {
  const [theme, setTheme] = useState<ThemeChoice>('system');

  // Load the persisted theme on mount.
  useEffect(() => {
    void window.editor.getTheme().then((t) => setTheme(t));
  }, []);

  // Apply the theme to <html>: 'system' resolves to light/dark via
  // prefers-color-scheme and tracks OS changes; the others map directly.
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      root.dataset.theme =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme;
    };
    apply();
    if (theme !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const changeTheme = (next: ThemeChoice): void => {
    setTheme(next);
    window.editor.setTheme(next); // persist (best-effort)
  };

  return { theme, changeTheme };
}

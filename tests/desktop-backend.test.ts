// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createDesktopBackend, nextMangoTag } from '../src/main/desktop-actions';

/**
 * Unit-tests the per-compositor desktop-action backend selection (#199/#507):
 * the pure mango tag-wrap and the factory. The KDE/Hyprland/mango backends do
 * I/O (D-Bus / `mmsg` / `hyprctl`), so only the selection shape is exercised
 * here, not a live dispatch.
 */
describe('nextMangoTag', () => {
  it('advances to the next tag', () => {
    expect(nextMangoTag(1, 1)).toBe(2);
  });

  it('goes back to the previous tag', () => {
    expect(nextMangoTag(3, -1)).toBe(2);
  });

  it('wraps forward from the last tag to the first', () => {
    expect(nextMangoTag(9, 1)).toBe(1);
  });

  it('wraps backward from the first tag to the last', () => {
    expect(nextMangoTag(1, -1)).toBe(9);
  });

  it('treats direction 0 as forward', () => {
    expect(nextMangoTag(5, 0)).toBe(6);
  });
});

describe('createDesktopBackend', () => {
  // The DbusCall transport is only consumed by the KDE backend; a stub suffices.
  const noCall = async (): Promise<void> => {};

  it('returns a backend exposing the three desktop actions for every compositor', () => {
    for (const desktop of ['kde', 'hyprland', 'mango', 'xfce', '']) {
      const backend = createDesktopBackend(desktop, noCall);
      expect(typeof backend.switchWorkspace).toBe('function');
      expect(typeof backend.toggleOverview).toBe('function');
      expect(typeof backend.showDesktop).toBe('function');
    }
  });
});

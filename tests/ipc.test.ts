// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { IpcChannel } from '@/shared/ipc';

/**
 * The IPC channel registry is the single source of truth for both
 * sides of every Electron bridge. Two failure modes are cheap to
 * guard against and expensive to debug at runtime:
 *
 *  1. A copy-paste collision (two keys sharing one string) silently
 *     cross-wires two channels — the symptom shows up far from the
 *     typo. PR Editor-1 doubled the channel count, which is exactly
 *     when such a collision is most likely to slip in.
 *  2. An un-namespaced value would clash with channels from other
 *     libraries on the same ipcMain.
 */
describe('IpcChannel registry', () => {
  const values = Object.values(IpcChannel);

  it('has no duplicate channel strings', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('namespaces every channel under "spaceux:"', () => {
    for (const value of values) {
      expect(value.startsWith('spaceux:')).toBe(true);
    }
  });

  it('exposes the editor channels added in PR Editor-1', () => {
    expect(IpcChannel.EDITOR_READY).toBe('spaceux:editor:ready');
    expect(IpcChannel.EDITOR_GET_MENU_CONFIG).toBe('spaceux:editor:menu-settings:get');
  });
});

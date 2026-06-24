// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createKdeDesktopBackend } from '../src/main/desktop-actions';

/**
 * Unit-tests the KDE desktop-action dispatch (#199): each action maps to the
 * right D-Bus service/path/interface/member (and args). The transport is
 * injected, so these pin the wire contract without a real bus.
 */
describe('createKdeDesktopBackend', () => {
  it('switches to the next desktop on a forward direction', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    await createKdeDesktopBackend(call).switchWorkspace(1);
    expect(call).toHaveBeenCalledWith({
      service: 'org.kde.KWin',
      path: '/KWin',
      iface: 'org.kde.KWin',
      member: 'nextDesktop',
    });
  });

  it('switches to the previous desktop on a backward direction', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    await createKdeDesktopBackend(call).switchWorkspace(-1);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ member: 'previousDesktop' }));
  });

  it('toggles overview via the kwin global shortcut', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    await createKdeDesktopBackend(call).toggleOverview();
    expect(call).toHaveBeenCalledWith({
      service: 'org.kde.kglobalaccel',
      path: '/component/kwin',
      iface: 'org.kde.kglobalaccel.Component',
      member: 'invokeShortcut',
      signature: 's',
      args: ['Overview'],
    });
  });

  it('shows the desktop with an explicit boolean argument', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    await createKdeDesktopBackend(call).showDesktop(true);
    expect(call).toHaveBeenCalledWith({
      service: 'org.kde.KWin',
      path: '/KWin',
      iface: 'org.kde.KWin',
      member: 'showDesktop',
      signature: 'b',
      args: [true],
    });
  });

  it('hides the desktop with false', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    await createKdeDesktopBackend(call).showDesktop(false);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ member: 'showDesktop', args: [false] }),
    );
  });
});

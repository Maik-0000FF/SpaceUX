// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  detectEnvironment,
  detectSessionType,
  normaliseDesktop,
  parseOsRelease,
} from '../src/main/desktop-env';

describe('normaliseDesktop', () => {
  it('returns "" for empty / missing input', () => {
    expect(normaliseDesktop(undefined)).toBe('');
    expect(normaliseDesktop('')).toBe('');
    expect(normaliseDesktop(':')).toBe('');
  });

  it('collapses known aliases case-insensitively', () => {
    expect(normaliseDesktop('KDE')).toBe('kde');
    expect(normaliseDesktop('plasma')).toBe('kde');
    expect(normaliseDesktop('X-Cinnamon')).toBe('cinnamon');
    expect(normaliseDesktop('GNOME')).toBe('gnome');
  });

  it('picks the recognised token out of a vendor-prefixed list', () => {
    expect(normaliseDesktop('ubuntu:GNOME')).toBe('gnome');
    expect(normaliseDesktop('ubuntu:Budgie')).toBe('budgie');
  });

  it('reports an unrecognised desktop by its own name (not a sentinel)', () => {
    expect(normaliseDesktop('Hyprland')).toBe('hyprland');
    expect(normaliseDesktop('sway')).toBe('sway');
    expect(normaliseDesktop('enlightenment')).toBe('enlightenment');
  });

  it('falls back to the last token when none is recognised (vendor prefix is first)', () => {
    expect(normaliseDesktop('pop:cosmic')).toBe('cosmic');
    expect(normaliseDesktop('vendor:somede')).toBe('somede');
  });
});

describe('detectSessionType', () => {
  it('maps the known protocols and defaults to unknown', () => {
    expect(detectSessionType({ XDG_SESSION_TYPE: 'wayland' })).toBe('wayland');
    expect(detectSessionType({ XDG_SESSION_TYPE: 'X11' })).toBe('x11');
    expect(detectSessionType({ XDG_SESSION_TYPE: 'tty' })).toBe('unknown');
    expect(detectSessionType({})).toBe('unknown');
  });
});

describe('parseOsRelease', () => {
  it('reads ID and ID_LIKE, stripping quotes and lowercasing', () => {
    expect(parseOsRelease('ID=arch\nPRETTY_NAME="Arch Linux"')).toEqual({
      id: 'arch',
      idLike: [],
    });
    expect(parseOsRelease('ID="ubuntu"\nID_LIKE="ubuntu debian"')).toEqual({
      id: 'ubuntu',
      idLike: ['ubuntu', 'debian'],
    });
    expect(parseOsRelease('ID=Fedora\nID_LIKE=rhel')).toEqual({ id: 'fedora', idLike: ['rhel'] });
  });

  it('degrades to empty on missing fields or malformed content', () => {
    expect(parseOsRelease('')).toEqual({ id: '', idLike: [] });
    expect(parseOsRelease('NAME=Whatever\n# a comment\ngarbage line')).toEqual({
      id: '',
      idLike: [],
    });
  });
});

describe('detectEnvironment', () => {
  it('prefers XDG_CURRENT_DESKTOP over the fallback vars and keeps the raw value', () => {
    const env = {
      XDG_CURRENT_DESKTOP: 'ubuntu:GNOME',
      XDG_SESSION_DESKTOP: 'ubuntu',
      DESKTOP_SESSION: 'ubuntu',
      XDG_SESSION_TYPE: 'wayland',
    };
    expect(detectEnvironment(env, 'ID=ubuntu\nID_LIKE=debian')).toEqual({
      desktop: 'gnome',
      desktopRaw: 'ubuntu:GNOME',
      sessionType: 'wayland',
      distro: { id: 'ubuntu', idLike: ['debian'] },
    });
  });

  it('falls back through XDG_SESSION_DESKTOP then DESKTOP_SESSION', () => {
    expect(detectEnvironment({ XDG_SESSION_DESKTOP: 'KDE' }, null).desktop).toBe('kde');
    expect(detectEnvironment({ DESKTOP_SESSION: 'plasma' }, null).desktop).toBe('kde');
  });

  it('leaves the distro unknown when os-release is unavailable', () => {
    expect(detectEnvironment({ XDG_CURRENT_DESKTOP: 'Hyprland' }, null)).toEqual({
      desktop: 'hyprland',
      desktopRaw: 'Hyprland',
      sessionType: 'unknown',
      distro: { id: '', idLike: [] },
    });
  });
});

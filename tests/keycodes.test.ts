// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { KEY_CODES, parseChord } from '../src/main/builtins/keycodes';

describe('parseChord', () => {
  it('splits a simple modifier+key chord', () => {
    // Alt = 56, Tab = 15 (from <linux/input-event-codes.h>).
    expect(parseChord('alt+Tab')).toEqual({ modifiers: [56], key: 15 });
  });

  it('handles multiple modifiers in order', () => {
    expect(parseChord('Ctrl+Shift+S')).toEqual({ modifiers: [29, 42], key: 31 });
  });

  it('is case-insensitive', () => {
    expect(parseChord('ALT+TAB')).toEqual({ modifiers: [56], key: 15 });
    expect(parseChord('alt+tab')).toEqual({ modifiers: [56], key: 15 });
    expect(parseChord('Alt+TaB')).toEqual({ modifiers: [56], key: 15 });
  });

  it('treats single-key specs as no-modifier chords', () => {
    expect(parseChord('Enter')).toEqual({ modifiers: [], key: 28 });
    expect(parseChord('XF86AudioRaiseVolume')).toEqual({ modifiers: [], key: 115 });
  });

  it('accepts the modifier-name aliases', () => {
    // ctrl == control, super == meta == win == cmd.
    expect(parseChord('control+a')).toEqual({ modifiers: [29], key: 30 });
    expect(parseChord('super+d')).toEqual({ modifiers: [125], key: 32 });
    expect(parseChord('meta+d')).toEqual({ modifiers: [125], key: 32 });
    expect(parseChord('win+d')).toEqual({ modifiers: [125], key: 32 });
    expect(parseChord('cmd+d')).toEqual({ modifiers: [125], key: 32 });
  });

  it('returns null for unknown keys', () => {
    expect(parseChord('Alt+Banana')).toBeNull();
    expect(parseChord('NotAKey')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseChord('')).toBeNull();
    expect(parseChord('   ')).toBeNull();
    expect(parseChord('+')).toBeNull();
    expect(parseChord('++')).toBeNull();
  });

  it('tolerates whitespace around tokens', () => {
    expect(parseChord(' ctrl + c ')).toEqual({ modifiers: [29], key: 46 });
  });
});

describe('KEY_CODES coverage', () => {
  it('covers every key referenced by the default config', () => {
    // These are the symbolic specs used in shared/menu.ts's
    // DEFAULT_MENU_CONFIG. A miss here means the default install
    // would silently fail on the first user trigger.
    const required = [
      'alt+Tab',
      'XF86AudioRaiseVolume',
      'XF86AudioLowerVolume',
      'XF86AudioMute',
      'super+d',
    ];
    for (const chord of required) {
      const parsed = parseChord(chord);
      expect(parsed, `chord "${chord}" failed to parse`).not.toBeNull();
    }
  });

  it('exposes letter keys with the kernel ordering', () => {
    // Sanity check the table — a regression that scrambled the
    // letter row would be subtle otherwise. q starts at 16; a at 30;
    // z at 44.
    expect(KEY_CODES.q).toBe(16);
    expect(KEY_CODES.a).toBe(30);
    expect(KEY_CODES.z).toBe(44);
  });
});

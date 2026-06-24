// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { actionFillKind } from '../src/core/menu-edit';
import { keyComboFill } from '../src/main/keysym-icons';
import { BUILTIN_ACTION, builtinAction } from '../src/shared/menu';

describe('keyComboFill (#511)', () => {
  it('maps a known media keysym to its icon name and short label', () => {
    expect(keyComboFill('XF86AudioMute')).toEqual({ icon: 'audio-volume-muted', label: 'Mute' });
    expect(keyComboFill('XF86AudioRaiseVolume')).toEqual({
      icon: 'audio-volume-high',
      label: 'Volume up',
    });
    expect(keyComboFill('XF86AudioLowerVolume')).toEqual({
      icon: 'audio-volume-low',
      label: 'Volume down',
    });
  });

  it('is case-insensitive, like the chord parser', () => {
    expect(keyComboFill('xf86audiomute')?.label).toBe('Mute');
    expect(keyComboFill('XF86AUDIOMUTE')?.label).toBe('Mute');
  });

  it('finds the media keysym even with modifier prefixes', () => {
    expect(keyComboFill('ctrl+XF86AudioMute')?.icon).toBe('audio-volume-muted');
    expect(keyComboFill('super+shift+XF86AudioPlay')).toEqual({
      icon: 'media-playback-start',
      label: 'Play',
    });
  });

  it('returns null for a plain shortcut or an unmapped keysym', () => {
    expect(keyComboFill('alt+Tab')).toBeNull();
    expect(keyComboFill('ctrl+s')).toBeNull();
    expect(keyComboFill('')).toBeNull();
    expect(keyComboFill('XF86Calculator')).toBeNull();
  });
});

describe('actionFillKind (#511)', () => {
  it('reports key-combo as a fillable kind, alongside the path actions', () => {
    expect(actionFillKind(builtinAction(BUILTIN_ACTION.KEY_COMBO))).toBe('key-combo');
    expect(actionFillKind(builtinAction(BUILTIN_ACTION.EXEC))).toBe('exec');
    expect(actionFillKind(builtinAction(BUILTIN_ACTION.OPEN_FILE))).toBe('open-file');
  });

  it('is null for an action with no auto-resolvable target (Cancel)', () => {
    expect(actionFillKind(builtinAction(BUILTIN_ACTION.CANCEL))).toBeNull();
  });
});

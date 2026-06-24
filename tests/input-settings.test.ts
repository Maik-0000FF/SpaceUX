// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_INPUT_SETTINGS, sanitizeInputSettingsPatch } from '../src/shared/input-settings';

describe('input settings defaults (#327)', () => {
  it('defaults grab-while-pie-open to on', () => {
    // The grab is the desired behaviour for the SpaceMouse + 3D-app workflow,
    // so it ships on; users who don't run such apps can turn it off.
    expect(DEFAULT_INPUT_SETTINGS.grabWhilePieOpen).toBe(true);
  });
});

describe('sanitizeInputSettingsPatch (#327)', () => {
  it('passes the grab toggle through, drops a non-boolean', () => {
    expect(sanitizeInputSettingsPatch({ grabWhilePieOpen: true })).toEqual({
      grabWhilePieOpen: true,
    });
    expect(sanitizeInputSettingsPatch({ grabWhilePieOpen: false })).toEqual({
      grabWhilePieOpen: false,
    });
    // A non-boolean (incl. truthy/falsy values) is dropped, not coerced, so a
    // malformed message can't flip the behaviour.
    expect(sanitizeInputSettingsPatch({ grabWhilePieOpen: 1 })).toEqual({});
    expect(sanitizeInputSettingsPatch({ grabWhilePieOpen: 'yes' })).toEqual({});
  });

  it('drops unknown keys and non-object input', () => {
    expect(sanitizeInputSettingsPatch({ somethingElse: true })).toEqual({});
    expect(sanitizeInputSettingsPatch(null)).toEqual({});
    expect(sanitizeInputSettingsPatch('nope')).toEqual({});
    expect(sanitizeInputSettingsPatch(42)).toEqual({});
  });
});

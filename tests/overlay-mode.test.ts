// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { parseOverlayMode } from '../src/main/overlay-mode';

describe('parseOverlayMode', () => {
  it('reads no overlay when unset', () => {
    expect(parseOverlayMode(undefined)).toEqual({ requested: false, debug: false });
  });

  it('treats the empty string and whitespace-only as off', () => {
    expect(parseOverlayMode('')).toEqual({ requested: false, debug: false });
    expect(parseOverlayMode('   ')).toEqual({ requested: false, debug: false });
  });

  // The whole point of the fix: these non-empty strings are truthy, so a
  // Boolean() coercion would wrongly enable the overlay.
  it.each(['0', 'false', 'off', 'no'])('treats %j as off', (value) => {
    expect(parseOverlayMode(value)).toEqual({ requested: false, debug: false });
  });

  it.each(['1', 'true', 'yes', 'on'])('treats %j as on without debug', (value) => {
    expect(parseOverlayMode(value)).toEqual({ requested: true, debug: false });
  });

  it('enables the debug overlay variant for "debug"', () => {
    expect(parseOverlayMode('debug')).toEqual({ requested: true, debug: true });
  });

  it('is case-insensitive and trims', () => {
    expect(parseOverlayMode(' DEBUG ')).toEqual({ requested: true, debug: true });
    expect(parseOverlayMode(' 1 ')).toEqual({ requested: true, debug: false });
    expect(parseOverlayMode('OFF')).toEqual({ requested: false, debug: false });
  });
});

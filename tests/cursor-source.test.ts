// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createCursorSource, parseXyJson } from '../src/main/cursor-source';

/**
 * Unit-tests the compositor-agnostic cursor source (#507): the pure mango
 * payload parser and the per-desktop backend selection. The KWin and mango
 * backends do I/O (D-Bus / `mmsg`), so the tests only exercise the logic that
 * is reachable without a live compositor: the parse and the null backend.
 */
describe('parseXyJson', () => {
  it('parses integer coordinates', () => {
    expect(parseXyJson('{"x":1200,"y":340,"monitor":"HDMI-A-1"}')).toEqual({
      x: 1200,
      y: 340,
    });
  });

  it('rounds fractional coordinates', () => {
    expect(parseXyJson('{"x":4397.59,"y":860.24,"monitor":"HDMI-A-1"}')).toEqual({
      x: 4398,
      y: 860,
    });
  });

  it('returns null for malformed JSON', () => {
    expect(parseXyJson('not json')).toBeNull();
  });

  it('returns null when a coordinate is missing', () => {
    expect(parseXyJson('{"x":10,"monitor":"DP-1"}')).toBeNull();
  });

  it('returns null for non-numeric coordinates', () => {
    expect(parseXyJson('{"x":null,"y":5}')).toBeNull();
    expect(parseXyJson('{"x":"10","y":5}')).toBeNull();
  });

  it('returns null for non-finite coordinates', () => {
    // 1e999 parses to Infinity, the case only the Number.isFinite guard rejects
    // (the typeof check passes, since Infinity is a number).
    expect(parseXyJson('{"x":1e999,"y":5}')).toBeNull();
  });
});

describe('createCursorSource', () => {
  it('returns a null backend for an unsupported desktop (skips the open)', async () => {
    const src = createCursorSource('xfce', { kwinScriptDir: '/tmp/spaceux-test' });
    await expect(src.getCursor()).resolves.toBeNull();
  });

  it('treats an empty desktop id as unsupported', async () => {
    const src = createCursorSource('', { kwinScriptDir: '/tmp/spaceux-test' });
    await expect(src.getCursor()).resolves.toBeNull();
  });

  it('returns a backend exposing getCursor for kde, hyprland and mango', () => {
    for (const desktop of ['kde', 'hyprland', 'mango']) {
      expect(
        typeof createCursorSource(desktop, { kwinScriptDir: '/tmp/spaceux-test' }).getCursor,
      ).toBe('function');
    }
  });
});

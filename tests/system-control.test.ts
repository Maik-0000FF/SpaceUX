// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createSystemControlBackend, percentStepArg } from '../src/main/system-control';

/**
 * Unit-tests the per-compositor system controls (#199): the pure relative-step
 * argument builder (shared by wpctl and brightnessctl) and the KDE inject path
 * (driven through a mock injector). The wlroots path shells out, so only its
 * argument shape is exercised here.
 */
describe('percentStepArg', () => {
  it('returns null for a zero step', () => {
    expect(percentStepArg(0, 5)).toBeNull();
  });

  it('builds a raise argument from the step count and percent', () => {
    expect(percentStepArg(2, 5)).toBe('10%+');
  });

  it('builds a lower argument for a negative step', () => {
    expect(percentStepArg(-1, 5)).toBe('5%-');
  });
});

describe('createSystemControlBackend on KDE (inject path)', () => {
  function injector() {
    const chords: [number[], number][] = [];
    return {
      chords,
      deps: {
        injectChord: (modifiers: number[], key: number) => chords.push([modifiers, key]),
        injectAvailable: () => true,
      },
    };
  }

  it('injects one volume-up media key per step', async () => {
    const { chords, deps } = injector();
    await createSystemControlBackend('kde', deps).adjustVolume(2);
    expect(chords).toEqual([
      [[], 115],
      [[], 115],
    ]);
  });

  it('injects the volume-down key for a negative step', async () => {
    const { chords, deps } = injector();
    await createSystemControlBackend('kde', deps).adjustVolume(-1);
    expect(chords).toEqual([[[], 114]]);
  });

  it('injects the mute key on toggleMute', async () => {
    const { chords, deps } = injector();
    await createSystemControlBackend('kde', deps).toggleMute();
    expect(chords).toEqual([[[], 113]]);
  });

  it('injects one brightness-up media key per step', async () => {
    const { chords, deps } = injector();
    await createSystemControlBackend('kde', deps).adjustBrightness(2);
    expect(chords).toEqual([
      [[], 225],
      [[], 225],
    ]);
  });

  it('injects the brightness-down key for a negative step', async () => {
    const { chords, deps } = injector();
    await createSystemControlBackend('kde', deps).adjustBrightness(-1);
    expect(chords).toEqual([[[], 224]]);
  });

  it('drops the key when injection is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chords: [number[], number][] = [];
    await createSystemControlBackend('kde', {
      injectChord: (modifiers, key) => chords.push([modifiers, key]),
      injectAvailable: () => false,
    }).adjustVolume(1);
    expect(chords).toEqual([]);
    warn.mockRestore();
  });
});

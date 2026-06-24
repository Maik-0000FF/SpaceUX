// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_DESKTOP_SETTINGS } from '../src/shared/desktop-settings';
import type { DesktopSettings } from '../src/shared/ipc';
import { desktopButtonConflicts, desktopConflictMessage } from '../src/core/desktop-conflicts';

function clone(): DesktopSettings {
  return structuredClone(DEFAULT_DESKTOP_SETTINGS);
}

describe('desktopButtonConflicts', () => {
  it('reports no conflict when buttons are unbound (the default)', () => {
    expect(desktopButtonConflicts(clone(), 5).size).toBe(0);
  });

  it('flags a function-button on the trigger as HARD in always mode (pie unreachable)', () => {
    const s = clone();
    s.buttons = { 0: 'overview' }; // overview on button 0 = trigger, always on
    expect(desktopButtonConflicts(s, 0).get(0)).toEqual({
      withTrigger: true,
      others: [],
      hard: true,
    });
  });

  it('flags a function-button on the trigger as SOFT in toggle mode (dual function)', () => {
    const s = clone();
    s.activationMode = 'toggle';
    s.buttons = { 0: 'overview' };
    expect(desktopButtonConflicts(s, 0).get(0)).toEqual({
      withTrigger: true,
      others: [],
      hard: false,
    });
  });

  it('flags the toggle button on the trigger as HARD (the pie wins)', () => {
    const s = clone();
    s.activationMode = 'toggle';
    s.toggleButton = 0;
    expect(desktopButtonConflicts(s, 0).get('toggle')).toEqual({
      withTrigger: true,
      others: [],
      hard: true,
    });
  });

  it('flags the toggle button colliding with a bound function (soft)', () => {
    const s = clone();
    s.activationMode = 'toggle';
    s.toggleButton = 1;
    s.buttons = { 1: 'showDesktop' };
    const conflicts = desktopButtonConflicts(s, 5);
    expect(conflicts.get('toggle')).toEqual({
      withTrigger: false,
      others: ['Show desktop'],
      hard: false,
    });
    expect(conflicts.get(1)).toEqual({
      withTrigger: false,
      others: ['Toggle desktop mode'],
      hard: false,
    });
  });

  it('ignores the toggle button when activation mode is always', () => {
    const s = clone();
    s.toggleButton = 1; // set, but mode is 'always' so it's not in play
    expect(desktopButtonConflicts(s, 5).has('toggle')).toBe(false);
  });

  it('ignores a button bound to none', () => {
    const s = clone();
    s.buttons = { 0: 'none', 1: 'showDesktop' };
    const conflicts = desktopButtonConflicts(s, 1); // showDesktop on 1 = trigger, always → hard
    expect(conflicts.has(0)).toBe(false);
    expect(conflicts.get(1)).toEqual({ withTrigger: true, others: [], hard: true });
  });

  it('has no conflict when no trigger is set and buttons are distinct', () => {
    const s = clone();
    s.buttons = { 0: 'overview', 1: 'showDesktop' };
    expect(desktopButtonConflicts(s, null).size).toBe(0);
  });
});

describe('desktopConflictMessage', () => {
  it('warns the pie is unreachable for a hard conflict', () => {
    expect(desktopConflictMessage({ withTrigger: true, others: [], hard: true })).toContain(
      'unreachable',
    );
  });

  it('frames a soft trigger overlap as the toggle dual-function', () => {
    const msg = desktopConflictMessage({ withTrigger: true, others: [], hard: false });
    expect(msg).toContain('also the pie trigger');
    expect(msg).toContain('toggle mode');
  });

  it('names just the other bindings when the trigger is not involved', () => {
    expect(
      desktopConflictMessage({ withTrigger: false, others: ['Show desktop'], hard: false }),
    ).toBe('Shares this button with Show desktop; they may fight.');
  });
});

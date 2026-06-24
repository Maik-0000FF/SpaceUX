// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { actionPathHint } from '../src/core/action-path';
import type { ActionPathCheck } from '../src/shared/ipc';

const check = (over: Partial<ActionPathCheck>): ActionPathCheck => ({
  resolved: '/usr/bin/firefox',
  fromPath: false,
  exists: true,
  directory: false,
  executable: true,
  program: false,
  ...over,
});

describe('actionPathHint', () => {
  it('stays quiet when nothing parseable is entered', () => {
    expect(actionPathHint('exec', check({ resolved: null }))).toBeNull();
    expect(actionPathHint('open-file', check({ resolved: null }))).toBeNull();
  });

  describe('exec (Launch program)', () => {
    it('is quiet for an existing executable', () => {
      expect(actionPathHint('exec', check({}))).toBeNull();
    });

    it('flags a literal path that does not exist', () => {
      const r = actionPathHint('exec', check({ exists: false, executable: false }));
      expect(r).toMatch(/^Not found:/);
      expect(r).not.toMatch(/PATH/);
    });

    it('flags a bare name missing from PATH', () => {
      const r = actionPathHint(
        'exec',
        check({ resolved: 'frefox', fromPath: true, exists: false, executable: false }),
      );
      expect(r).toMatch(/Not found on PATH/);
    });

    it('flags a folder', () => {
      expect(actionPathHint('exec', check({ directory: true, executable: false }))).toMatch(
        /folder, not a program/,
      );
    });

    it('flags a file that exists but is not executable, nudging toward Open file', () => {
      const r = actionPathHint('exec', check({ resolved: '/home/u/a.pdf', executable: false }));
      expect(r).toMatch(/Not executable/);
      expect(r).toMatch(/Open file/);
    });
  });

  describe('open-file (Open file)', () => {
    it('is quiet for an existing non-program file', () => {
      expect(actionPathHint('open-file', check({ resolved: '/home/u/a.pdf' }))).toBeNull();
    });

    it('flags a path that does not exist', () => {
      expect(
        actionPathHint('open-file', check({ resolved: '/home/u/gone.pdf', exists: false })),
      ).toMatch(/^Not found:/);
    });

    it('flags a program, nudging toward Launch program', () => {
      const r = actionPathHint('open-file', check({ resolved: '/usr/bin/firefox', program: true }));
      expect(r).toMatch(/is a program/);
      expect(r).toMatch(/Launch program/);
    });

    it('ignores the exec-only executable bit (FAT/NTFS +x must not misfire)', () => {
      // executable true but program false: a document on a mount that marks
      // everything +x must stay quiet (open-file keys off MIME, not the bit).
      expect(
        actionPathHint('open-file', check({ resolved: '/mnt/x/a.pdf', executable: true })),
      ).toBeNull();
    });
  });
});

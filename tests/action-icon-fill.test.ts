// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveActionFill } from '../src/main/action-icon';
import type { HostEnvironment } from '../src/shared/plugin-types';

// The label path needs no real icon theme; a bare host is enough (the icon
// resolves to null in the test env, the label still resolves).
const host = { desktop: '', desktopRaw: '', sessionType: 'wayland' } as unknown as HostEnvironment;

// resolveActionFill scans the XDG application dirs once (cached); this file gets
// a fresh module instance, so pointing XDG at a temp dir of crafted .desktop
// entries before the first call isolates it from the real system.
describe('resolveActionFill label (#419)', () => {
  let dir: string;
  let prevHome: string | undefined;
  let prevDirs: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'spaceux-actionfill-'));
    const apps = join(dir, 'applications');
    mkdirSync(apps, { recursive: true });
    writeFileSync(
      join(apps, 'foo.desktop'),
      '[Desktop Entry]\nExec=foo --x\nName=Foo App\nIcon=foo\n',
    );
    // Two entries for the same Exec binary, the first without Name: the per-field
    // index merge must still pick up Name from the second (regression guard).
    writeFileSync(join(apps, 'a-bar.desktop'), '[Desktop Entry]\nExec=bar\nIcon=baricon\n');
    writeFileSync(join(apps, 'b-bar.desktop'), '[Desktop Entry]\nExec=bar\nName=Bar Tool\n');
    prevHome = process.env.XDG_DATA_HOME;
    prevDirs = process.env.XDG_DATA_DIRS;
    process.env.XDG_DATA_HOME = dir;
    process.env.XDG_DATA_DIRS = dir; // only the temp dir, so no system entry interferes
  });

  afterAll(() => {
    if (prevHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevHome;
    if (prevDirs === undefined) delete process.env.XDG_DATA_DIRS;
    else process.env.XDG_DATA_DIRS = prevDirs;
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses the program .desktop Name as the exec label', async () => {
    expect((await resolveActionFill('exec', 'foo --x', host)).label).toBe('Foo App');
  });

  it('backfills a missing Name from another .desktop with the same Exec binary', async () => {
    expect((await resolveActionFill('exec', 'bar', host)).label).toBe('Bar Tool');
  });

  it('falls back to the binary name when no .desktop matches', async () => {
    expect((await resolveActionFill('exec', 'no-such-prog-xyz', host)).label).toBe(
      'no-such-prog-xyz',
    );
  });

  it('uses the file name as the open-file label', async () => {
    expect((await resolveActionFill('open-file', '/home/you/Docs/drawing.FCStd', host)).label).toBe(
      'drawing.FCStd',
    );
  });
});

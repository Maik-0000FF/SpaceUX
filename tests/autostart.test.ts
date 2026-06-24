// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureAutostartSeeded,
  isAutostartEnabled,
  migrateAutostartExecFlag,
  setAutostartEnabled,
} from '../src/main/autostart';
import { BACKGROUND_FLAG } from '../src/shared/launch';

let dir: string;
let prevXdg: string | undefined;
let prevHome: string | undefined;

const entryPath = () => path.join(dir, 'autostart', 'spaceux.desktop');
// The launcher install.sh writes; os.homedir() honours $HOME (overridden to the
// temp dir below), so this is where the seed gate looks for it.
const launcherFile = () => path.join(dir, '.local', 'bin', 'spaceux');

async function createLauncher(): Promise<void> {
  await fs.mkdir(path.dirname(launcherFile()), { recursive: true });
  await fs.writeFile(launcherFile(), '#!/bin/sh\n', 'utf8');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-autostart-'));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevHome = process.env.HOME;
  process.env.XDG_CONFIG_HOME = dir;
  process.env.HOME = dir; // redirect os.homedir() so the launcher path is in dir
});

afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('autostart', () => {
  it('reports disabled when no entry exists', async () => {
    expect(await isAutostartEnabled()).toBe(false);
  });

  it('writes the entry on enable and reports enabled', async () => {
    expect(await setAutostartEnabled(true)).toBe(true);
    expect(await isAutostartEnabled()).toBe(true);
    const content = await fs.readFile(entryPath(), 'utf8');
    expect(content).toContain('[Desktop Entry]');
    expect(content).toContain('Name=SpaceUX');
    // Exec points at the installed launcher, not at this process, and carries
    // the background flag so login stays silent (no editor).
    expect(content).toContain(
      `Exec=${path.join(os.homedir(), '.local', 'bin', 'spaceux')} ${BACKGROUND_FLAG}`,
    );
    expect(content).toContain('X-GNOME-Autostart-enabled=true');
  });

  it('includes the icon line only when an icon path is given', async () => {
    await setAutostartEnabled(true);
    expect(await fs.readFile(entryPath(), 'utf8')).not.toContain('Icon=');

    await setAutostartEnabled(true, '/some/where/icon.png');
    expect(await fs.readFile(entryPath(), 'utf8')).toContain('Icon=/some/where/icon.png');
  });

  it('removes the entry on disable and reports disabled', async () => {
    await setAutostartEnabled(true);
    expect(await setAutostartEnabled(false)).toBe(false);
    expect(await isAutostartEnabled()).toBe(false);
  });

  it('disabling when already absent is a no-op (idempotent)', async () => {
    expect(await setAutostartEnabled(false)).toBe(false);
  });
});

describe('autostart seeding (default on)', () => {
  beforeEach(async () => {
    await createLauncher(); // installed app: the seed gate passes
  });

  it('enables autostart on the first run', async () => {
    expect(await isAutostartEnabled()).toBe(false);
    await ensureAutostartSeeded();
    expect(await isAutostartEnabled()).toBe(true);
  });

  it('does not re-enable after the user turns it off', async () => {
    await ensureAutostartSeeded(); // first run: on
    expect(await setAutostartEnabled(false)).toBe(false); // user turns it off

    await ensureAutostartSeeded(); // a later launch must respect that
    expect(await isAutostartEnabled()).toBe(false);
  });

  it('is a no-op once seeded, even if the entry is still present', async () => {
    await ensureAutostartSeeded();
    // Remove only the entry but keep the seeded flag, then re-seed: the flag
    // wins, so a user who deletes the entry out-of-band isn't overridden.
    await fs.rm(entryPath(), { force: true });
    await ensureAutostartSeeded();
    expect(await isAutostartEnabled()).toBe(false);
  });

  it('does not seed (and does not mark seeded) when the launcher is absent', async () => {
    await fs.rm(launcherFile(), { force: true }); // simulate a dev run, no install.sh
    await ensureAutostartSeeded();
    expect(await isAutostartEnabled()).toBe(false);

    // The flag stayed unset, so a later real install still seeds on first launch.
    await createLauncher();
    await ensureAutostartSeeded();
    expect(await isAutostartEnabled()).toBe(true);
  });
});

describe('autostart exec-flag migration (#497)', () => {
  beforeEach(async () => {
    await createLauncher();
  });

  // Mimic a pre-#497 entry: enabled but Exec without the flag.
  async function writeFlaglessEntry(): Promise<void> {
    const launcher = path.join(os.homedir(), '.local', 'bin', 'spaceux');
    const entry = ['[Desktop Entry]', 'Type=Application', 'Name=SpaceUX', `Exec=${launcher}`, ''];
    await fs.mkdir(path.dirname(entryPath()), { recursive: true });
    await fs.writeFile(entryPath(), entry.join('\n'), 'utf8');
  }

  it('adds the background flag to an entry seeded before the flag existed', async () => {
    await writeFlaglessEntry();
    await migrateAutostartExecFlag();
    const content = await fs.readFile(entryPath(), 'utf8');
    expect(content).toContain(`spaceux ${BACKGROUND_FLAG}`);
    expect(await isAutostartEnabled()).toBe(true); // still enabled
  });

  it('preserves a disabled-out-of-band entry, only appending the flag', async () => {
    // The desktop's autostart settings disable by flipping a key, not deleting
    // the file. The migration must add the flag without re-enabling.
    const launcher = path.join(os.homedir(), '.local', 'bin', 'spaceux');
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=SpaceUX',
      `Exec=${launcher}`,
      'X-GNOME-Autostart-enabled=false',
      '',
    ];
    await fs.mkdir(path.dirname(entryPath()), { recursive: true });
    await fs.writeFile(entryPath(), entry.join('\n'), 'utf8');

    await migrateAutostartExecFlag();
    const content = await fs.readFile(entryPath(), 'utf8');
    expect(content).toContain(`Exec=${launcher} ${BACKGROUND_FLAG}`);
    expect(content).toContain('X-GNOME-Autostart-enabled=false'); // still disabled
  });

  it('keeps out-of-band customizations (custom Name/Icon) intact', async () => {
    const launcher = path.join(os.homedir(), '.local', 'bin', 'spaceux');
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=My SpaceUX',
      'Icon=/custom/icon.png',
      `Exec=${launcher}`,
      '',
    ];
    await fs.mkdir(path.dirname(entryPath()), { recursive: true });
    await fs.writeFile(entryPath(), entry.join('\n'), 'utf8');

    await migrateAutostartExecFlag();
    const content = await fs.readFile(entryPath(), 'utf8');
    expect(content).toContain('Name=My SpaceUX');
    expect(content).toContain('Icon=/custom/icon.png');
    expect(content).toContain(`Exec=${launcher} ${BACKGROUND_FLAG}`);
  });

  it('is a no-op when the entry already carries the flag', async () => {
    await setAutostartEnabled(true); // already the flagged form
    const before = await fs.readFile(entryPath(), 'utf8');
    await migrateAutostartExecFlag();
    expect(await fs.readFile(entryPath(), 'utf8')).toBe(before);
  });

  it('does nothing when autostart is off (no entry to migrate)', async () => {
    await migrateAutostartExecFlag();
    expect(await isAutostartEnabled()).toBe(false);
  });

  it('does nothing on a dev run with no launcher, even if a flagless entry exists', async () => {
    await writeFlaglessEntry();
    await fs.rm(launcherFile(), { force: true });
    await migrateAutostartExecFlag();
    expect(await fs.readFile(entryPath(), 'utf8')).not.toContain(BACKGROUND_FLAG);
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

// install.sh's `--print-distro` runs only the os-release -> package-manager
// mapping and exits, reading the file named by $OS_RELEASE_FILE. Feeding it
// synthetic os-release contents pins the mapping (including derivatives that
// only match via ID_LIKE) without needing a live distro or a container.
const INSTALL_SH = path.resolve(__dirname, '../scripts/install.sh');
const workdir = mkdtempSync(path.join(tmpdir(), 'spaceux-distro-'));

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

function detect(osRelease: string): string {
  const file = path.join(workdir, 'os-release');
  writeFileSync(file, osRelease);
  return execFileSync('bash', [INSTALL_SH, '--print-distro'], {
    env: { ...process.env, OS_RELEASE_FILE: file },
    encoding: 'utf8',
  }).trim();
}

describe('install.sh distro detection', () => {
  const cases = [
    { name: 'Arch', osRelease: 'ID=arch\n', expected: 'arch' },
    { name: 'CachyOS (ID_LIKE=arch)', osRelease: 'ID=cachyos\nID_LIKE=arch\n', expected: 'arch' },
    { name: 'Debian', osRelease: 'ID=debian\n', expected: 'debian' },
    {
      name: 'Ubuntu (ID_LIKE=debian)',
      osRelease: 'ID=ubuntu\nID_LIKE=debian\n',
      expected: 'debian',
    },
    {
      name: 'Linux Mint (ID_LIKE="ubuntu debian")',
      osRelease: 'ID=linuxmint\nID_LIKE="ubuntu debian"\n',
      expected: 'debian',
    },
    { name: 'Fedora', osRelease: 'ID=fedora\n', expected: 'fedora' },
    {
      name: 'Nobara (ID_LIKE=fedora)',
      osRelease: 'ID=nobara\nID_LIKE=fedora\n',
      expected: 'fedora',
    },
    {
      name: 'Bazzite (ID_LIKE="fedora")',
      osRelease: 'ID=bazzite\nID_LIKE="fedora"\n',
      expected: 'fedora',
    },
    { name: 'unrelated distro', osRelease: 'ID=void\n', expected: 'unknown' },
    { name: 'empty os-release', osRelease: '\n', expected: 'unknown' },
  ];

  it.each(cases)('maps $name to $expected', ({ osRelease, expected }) => {
    expect(detect(osRelease)).toBe(expected);
  });
});

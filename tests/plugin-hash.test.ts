// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashPluginDir, pluginTrust } from '../src/main/plugin-hash';

// Locks the hashing behaviour the embedded official-plugin hashes rely on: if
// any of these change, the shipped hashes silently stop matching genuine
// plugins, so pin the contract rather than a single magic digest.
describe('hashPluginDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plugin-hash-'));
    writeFileSync(join(dir, 'manifest.json'), '{"id":"x"}');
    writeFileSync(join(dir, 'index.js'), 'export const x = 1;\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is deterministic', () => {
    expect(hashPluginDir(dir)).toBe(hashPluginDir(dir));
  });

  it('ignores __pycache__ and bytecode files', () => {
    const before = hashPluginDir(dir);
    mkdirSync(join(dir, '__pycache__'));
    writeFileSync(join(dir, '__pycache__', 'mod.pyc'), 'bytecode');
    writeFileSync(join(dir, 'mod.pyc'), 'bytecode');
    expect(hashPluginDir(dir)).toBe(before);
  });

  it("changes when a file's content changes", () => {
    const before = hashPluginDir(dir);
    writeFileSync(join(dir, 'index.js'), 'export const x = 2;\n');
    expect(hashPluginDir(dir)).not.toBe(before);
  });

  it('changes when an authored file is added', () => {
    const before = hashPluginDir(dir);
    writeFileSync(join(dir, 'extra.js'), '// payload\n');
    expect(hashPluginDir(dir)).not.toBe(before);
  });
});

describe('pluginTrust', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plugin-trust-'));
    writeFileSync(join(dir, 'manifest.json'), '{"id":"x"}');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is community for a non-official id', () => {
    expect(pluginTrust('org.example.unknown', dir)).toBe('community');
  });

  it('is mismatch for an official id whose content does not match', () => {
    expect(pluginTrust('org.spaceux.planets', dir)).toBe('mismatch');
  });

  it('is unknown for an official id whose directory cannot be read', () => {
    expect(pluginTrust('org.spaceux.planets', join(dir, 'does-not-exist'))).toBe('unknown');
  });
});

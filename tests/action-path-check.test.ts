// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import { checkActionPath } from '../src/main/action-path-check';

// The core is a long-running daemon and a GUI / autostart launch can hand it an
// almost-empty PATH, which used to make an installed command read as "not found".
// The check now searches the standard system bin dirs on top of the inherited
// PATH, so resolution doesn't depend on how the core was started.
describe('checkActionPath PATH resolution', () => {
  const realPath = process.env.PATH;
  afterEach(() => {
    process.env.PATH = realPath;
  });

  it('resolves a standard command via the baseline dirs even with an empty PATH', () => {
    process.env.PATH = '';
    const r = checkActionPath('exec', 'sh');
    expect(r.exists).toBe(true);
    expect(r.fromPath).toBe(true);
    expect(r.resolved).toMatch(/\/sh$/);
  });

  it('still flags a genuinely absent command', () => {
    const r = checkActionPath('exec', 'definitely-not-a-real-binary-xyz123');
    expect(r.exists).toBe(false);
    expect(r.fromPath).toBe(true);
  });

  it('checks a literal path directly, not via PATH', () => {
    const r = checkActionPath('exec', '/bin/sh');
    expect(r.fromPath).toBe(false);
    expect(r.exists).toBe(true);
    expect(r.executable).toBe(true);
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLaunchInvocation,
  hasUserSystemd,
  launchCommand,
} from '../src/main/builtins/launch-detached';
import { makeActionContext } from '../src/main/plugin-loader';
import type { DaemonClient } from '../src/main/daemon-client';
import type { PluginHostCapabilities } from '../src/shared/plugin-types';

describe('buildLaunchInvocation', () => {
  it('runs the binary directly when no systemd user session is present', () => {
    expect(buildLaunchInvocation('neovide', [], false)).toEqual({
      command: 'neovide',
      argv: [],
    });
    expect(buildLaunchInvocation('xdg-open', ['/tmp/a.pdf'], false)).toEqual({
      command: 'xdg-open',
      argv: ['/tmp/a.pdf'],
    });
  });

  it('wraps the binary in a transient app.slice scope under systemd', () => {
    expect(buildLaunchInvocation('wezterm', [], true)).toEqual({
      command: 'systemd-run',
      argv: ['--user', '--scope', '--collect', '--quiet', '--slice=app.slice', '--', 'wezterm'],
    });
  });

  it('passes the target argv 1:1 after the "--" separator', () => {
    const { argv } = buildLaunchInvocation('xdg-open', ['My Drawing.FCStd'], true);
    const sep = argv.indexOf('--');
    expect(sep).toBeGreaterThan(0);
    // The program and its arguments follow the separator unchanged; a single
    // entry with spaces stays one argument (no re-splitting / re-quoting).
    expect(argv.slice(sep + 1)).toEqual(['xdg-open', 'My Drawing.FCStd']);
  });

  it('does not let target arguments be mistaken for systemd-run flags', () => {
    // A target flag like "--version" sits after "--", so systemd-run treats it
    // as the program's argument, not its own.
    const { argv } = buildLaunchInvocation('someapp', ['--version'], true);
    expect(argv.slice(argv.indexOf('--') + 1)).toEqual(['someapp', '--version']);
  });
});

describe('hasUserSystemd', () => {
  let runtimeDir: string;
  let savedXdg: string | undefined;

  beforeEach(() => {
    runtimeDir = mkdtempSync(join(tmpdir(), 'spaceux-runtime-'));
    savedXdg = process.env.XDG_RUNTIME_DIR;
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    rmSync(runtimeDir, { recursive: true, force: true });
  });

  it('is true when $XDG_RUNTIME_DIR/systemd exists', () => {
    mkdirSync(join(runtimeDir, 'systemd'));
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    expect(hasUserSystemd()).toBe(true);
  });

  it('is false when the systemd marker is absent', () => {
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    expect(hasUserSystemd()).toBe(false);
  });

  it('is false when $XDG_RUNTIME_DIR is unset', () => {
    delete process.env.XDG_RUNTIME_DIR;
    expect(hasUserSystemd()).toBe(false);
  });
});

describe('launchCommand', () => {
  // The guard paths log and return without spawning, so they are safe to
  // assert directly; the actual launch path is covered by buildLaunchInvocation.
  it('rejects a command that tokenises to no binary, without spawning', () => {
    const logs: string[] = [];
    for (const command of ['', '   ', '""', "'' rest"]) {
      logs.length = 0;
      launchCommand(command, (m) => logs.push(m));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('parsed to no binary');
      expect(logs[0]).toContain(JSON.stringify(command));
    }
  });
});

describe('makeActionContext launch wiring', () => {
  const daemon = {
    injectChord: () => {},
    isInjectAvailable: () => false,
  } as unknown as DaemonClient;
  const host = {} as unknown as PluginHostCapabilities;

  it('exposes launch as a function', () => {
    const ctx = makeActionContext('org.example.test', daemon, host);
    expect(typeof ctx.launch).toBe('function');
  });

  it('routes through launchCommand and logs with the plugin prefix', () => {
    const ctx = makeActionContext('org.example.test', daemon, host);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      // Empty command hits launchCommand's no-binary guard: a prefixed log,
      // no spawn.
      ctx.launch('');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(
        '[plugin org.example.test] launch: command "" parsed to no binary, refusing to spawn',
      );
    } finally {
      spy.mockRestore();
    }
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { describeError } from '../../shared/errors.js';

import { tokenize } from './tokenize.js';

/**
 * Shared launcher for the `exec` and `open-file` built-ins.
 *
 * Both actions start an external program detached from the core process.
 * On a systemd user session the program must run in its OWN transient
 * scope, not inside SpaceUX's app scope. A plain `spawn(..., { detached:
 * true })` only calls setsid() (a new POSIX session); under cgroup v2 the
 * child still inherits SpaceUX's scope cgroup. KDE/systemd then treats the
 * launched app as part of the SpaceUX scope and, on logout, waits
 * DefaultTimeoutStopSec (90s) for it to honour SIGTERM before SIGKILL, so a
 * long-running launched app (editor, terminal) stalls the whole session
 * teardown (#521).
 *
 * Launching via `systemd-run --user --scope` places the program in its own
 * scope under app.slice, exactly how KDE (KIO::CommandLauncherJob) and
 * GNOME start desktop apps, decoupling its lifecycle from SpaceUX. Without
 * a systemd user session we fall back to the plain detached spawn.
 *
 * Known limitations of the systemd path: a failed launch surfaces only as a
 * non-zero scope exit, not a precise error. `systemd-run --scope` returns
 * exit 1 both when the inner binary is missing and when the user bus is
 * unreachable, which is indistinguishable from a program that genuinely
 * exits 1, and its own diagnostic goes to a stderr stream this detached
 * launch discards. The ENOENT retry below therefore covers only a missing
 * `systemd-run` itself, not a missing inner program or a dead bus.
 */

/** systemd-run binary, resolved on PATH. */
const SYSTEMD_RUN = 'systemd-run';

/** Slice the launched scope is placed under, matching the desktop's own app
 *  scopes (application launchers all park transient app scopes here). */
const APP_SLICE = 'app.slice';

/** Transient-scope flags:
 *  --user    target the per-user systemd manager, not the system one
 *  --scope   run the program in a scope (foreground, exec's into the target)
 *            rather than a forking service unit
 *  --collect garbage-collect the unit once it exits, so dead scopes don't
 *            accumulate
 *  --quiet   suppress the "Running as unit: ..." status line
 *  --slice   park the scope under app.slice */
const SCOPE_FLAGS = ['--user', '--scope', '--collect', '--quiet', `--slice=${APP_SLICE}`];

/** The concrete (command, argv) pair to hand to spawn(). */
export type LaunchInvocation = { command: string; argv: string[] };

/**
 * True when a systemd user manager is reachable. The runtime marker
 * `$XDG_RUNTIME_DIR/systemd` is the authoritative signal; systemd-run ships
 * with that same systemd, so the marker implies the binary too in normal
 * installs. The spawn-error path in launchDetached() still degrades
 * gracefully if the binary is somehow absent.
 */
export function hasUserSystemd(): boolean {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  return !!runtimeDir && existsSync(`${runtimeDir}/systemd`);
}

/**
 * Pure mapping from the logical (bin, args) to the command actually spawned:
 * wrapped in `systemd-run --scope` when a user session is available, run
 * directly otherwise. Kept side-effect free so the routing decision and argv
 * layout are unit-testable without spawning a process. The tokenised argv
 * maps 1:1 after `--`, so an entry with spaces stays a single argument.
 */
export function buildLaunchInvocation(
  bin: string,
  args: string[],
  useSystemd: boolean,
): LaunchInvocation {
  if (useSystemd) {
    return { command: SYSTEMD_RUN, argv: [...SCOPE_FLAGS, '--', bin, ...args] };
  }
  return { command: bin, argv: args };
}

export type LaunchOptions = {
  /** Human-readable label for log lines (defaults to the binary name). */
  label?: string;
  /**
   * Invoked with the exit code when the launched program (or, in systemd
   * mode, the scope) exits. `systemd-run --scope` propagates the target's
   * exit code, so this still reflects the real program. Lets `open-file`
   * report xdg-open's exit code. When omitted, a non-zero exit is logged as
   * a launch failure; this is what surfaces a missing target binary in
   * systemd mode, where node's ENOENT 'error' event does not fire (systemd-run
   * itself exists and starts; only the inner program is missing).
   */
  onExit?: (code: number | null) => void;
};

/**
 * Launch `bin args...` detached from the core process. Outcomes are reported
 * through `log`; never throws.
 */
export function launchDetached(
  bin: string,
  args: string[],
  log: (message: string) => void,
  opts: LaunchOptions = {},
): void {
  spawnDetached(bin, args, hasUserSystemd(), log, opts.label ?? bin, opts);
}

/**
 * Tokenise a shlex-style command line and launch the result detached (own
 * systemd scope when available, see {@link launchDetached}). Whitespace splits
 * tokens and single/double quotes group, so a path with spaces must be quoted
 * (`xdg-open "My File.pdf"`). Shared by the `exec` built-in and the plugin-facing
 * `ctx.launch` capability so both reject an empty command identically and route
 * through the same scope-decoupled path.
 */
export function launchCommand(command: string, log: (message: string) => void): void {
  const tokens = tokenize(command);
  const bin = tokens[0];
  if (!bin) {
    // The tokenizer yielded no binary, typically an empty quoted segment at the
    // start (e.g. `""` or `"" foo`). JSON.stringify keeps the log readable when
    // the command itself contains quotes.
    log(`launch: command ${JSON.stringify(command)} parsed to no binary, refusing to spawn`);
    return;
  }
  launchDetached(bin, tokens.slice(1), log);
}

function spawnDetached(
  bin: string,
  args: string[],
  useSystemd: boolean,
  log: (message: string) => void,
  label: string,
  opts: LaunchOptions,
): void {
  const { command, argv } = buildLaunchInvocation(bin, args, useSystemd);
  try {
    const child = spawn(command, argv, { detached: true, stdio: 'ignore' });
    // spawn() resolves asynchronously: 'spawn' = live (pid set), 'error' =
    // could not start (e.g. ENOENT). In systemd mode the pid is systemd-run's,
    // which exec's into the target so it stays the real app's pid.
    child.on('spawn', () => {
      log(`launch: ${label} (pid ${child.pid ?? 'unknown'})`);
    });
    child.on('error', (err) => {
      // Marker said systemd is present but systemd-run is missing: launch
      // directly so the action still fires rather than silently failing.
      if (useSystemd && isEnoent(err)) {
        log(`launch: ${SYSTEMD_RUN} unavailable, launching ${label} directly`);
        spawnDetached(bin, args, false, log, label, opts);
        return;
      }
      log(`launch: ${label} failed: ${describeError(err)}`);
    });
    if (opts.onExit) {
      const { onExit } = opts;
      child.on('close', (code) => onExit(code));
    } else {
      // No caller-supplied handler: a non-zero exit is the only signal of a
      // missing target binary in systemd mode (see LaunchOptions.onExit).
      child.on('close', (code) => {
        if (code) log(`launch: ${label} exited with code ${code}`);
      });
    }
    child.unref();
  } catch (err) {
    // Synchronous failure modes (e.g. invalid spawn arguments); ENOENT and
    // friends arrive through the 'error' handler above.
    log(`launch: ${label} spawn failed: ${describeError(err)}`);
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

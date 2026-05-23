// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILTIN_ACTION, BUILTIN_PLUGIN_ID } from '../../shared/menu.js';
import { PLUGIN_API_VERSION } from '../../shared/plugin-types.js';

import type { LoadedPlugin } from '../plugin-loader.js';
import { cancelAction } from './cancel.js';
import { execAction } from './exec.js';
import { keyCombo } from './key-combo.js';

/**
 * Built-in actions, shipped with the app.
 *
 * Exposed as a synthetic :type:`LoadedPlugin` so the plugin-loader's
 * dispatch path treats them identically to user-installed plugins.
 * Adding a new built-in is two lines: import its handler, register
 * it in BUILTIN_PLUGIN.handlers (and a matching descriptor in
 * BUILTIN_PLUGIN.manifest.actions). The shared :data:`BUILTIN_ACTION`
 * constants in `@/shared/menu` are the single source of truth for
 * action names; mistyping one is a compile error rather than a
 * runtime "unknown action".
 */
export const BUILTIN_PLUGIN: LoadedPlugin = {
  manifest: {
    // Built-in plugin is bundled with the host and intentionally
    // tracks PLUGIN_API_VERSION — it can never be out of date because
    // it ships in the same release. If a future refactor pipes the
    // built-in manifest through validateManifest(), this pin keeps
    // the check trivially satisfied; bumps stay synchronous with the
    // host on purpose.
    apiVersion: PLUGIN_API_VERSION,
    // Built-ins contribute actions, so they're a `function`-kind plugin —
    // they're never installed/scanned, but the manifest must satisfy the
    // PluginManifest shape.
    kind: 'function',
    id: BUILTIN_PLUGIN_ID,
    name: 'Built-in Actions',
    version: '0.0.1',
    license: 'GPL-3.0-or-later',
    actions: [
      {
        name: BUILTIN_ACTION.KEY_COMBO,
        label: 'Send key combination',
        description: 'Press a keyboard chord on the active window (xdotool-style spec).',
        config: {
          keys: {
            kind: 'string',
            label: 'Key combination',
            placeholder: 'alt+Tab',
          },
        },
      },
      {
        name: BUILTIN_ACTION.EXEC,
        label: 'Launch program',
        description: 'Spawn a desktop application as a fire-and-forget subprocess.',
        config: {
          command: {
            kind: 'string',
            label: 'Command',
            placeholder: 'firefox --new-window https://example.com',
          },
        },
      },
      {
        name: BUILTIN_ACTION.CANCEL,
        label: 'Cancel',
        description: 'Dismiss the menu without performing any action.',
      },
    ],
  },
  dir: '<built-in>',
  handlers: {
    [BUILTIN_ACTION.KEY_COMBO]: keyCombo,
    [BUILTIN_ACTION.EXEC]: execAction,
    [BUILTIN_ACTION.CANCEL]: cancelAction,
  },
};

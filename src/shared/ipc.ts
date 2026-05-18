// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * IPC channel identifiers shared between Electron main and renderer.
 *
 * Centralising the channel names here means refactoring renames in one
 * place. Both sides import the same constants so a typo doesn't
 * silently break a channel only one side knows about.
 */

export const IpcChannel = {
  /** Renderer subscribes; main pushes every axes snapshot. */
  AXES: 'spaceux:axes',
  /** Renderer subscribes; main pushes button press/release transitions. */
  BUTTON: 'spaceux:button',
  /** Main pushes connection-state changes (connected / disconnected / hello). */
  DAEMON_STATUS: 'spaceux:daemon-status',
  /** Renderer pushes user-action invocations toward main (which dispatches
   *  to the matching plugin handler). */
  INVOKE_ACTION: 'spaceux:invoke-action',
} as const;

export type DaemonStatusPayload =
  | { state: 'connected'; axes: number; buttons: number }
  | { state: 'disconnected'; reason: string };

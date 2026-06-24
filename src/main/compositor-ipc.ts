// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared constants for the per-compositor / system CLI calls (#507): the cursor
 * read, the desktop-action dispatch, and the volume/brightness controls all
 * shell out to a small tool (mango `mmsg`, Hyprland `hyprctl`, `wpctl`,
 * `brightnessctl`). Centralised here so the timeout is defined once and consumed
 * by every backend, a single source of truth rather than a per-file copy.
 */

/** Timeout for a one-shot compositor/system IPC command. These run on the input
 *  path (cursor read, desktop action), so it stays short: a hung or absent tool
 *  falls through to a null/no-op rather than stalling the pie. */
export const IPC_TIMEOUT_MS = 500;

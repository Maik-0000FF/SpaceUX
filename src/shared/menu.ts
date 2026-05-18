// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Menu-related defaults shared between Electron main and renderer.
 *
 * Today this file holds just the factory-default trigger binding.
 * Phase 2 of the roadmap moves the binding into a user-editable config
 * loaded from ~/.config/spaceux/menu.json — at which point this module
 * grows to define the on-disk schema and migration helpers.
 */

/** Zero-based button index that opens the pie menu when no user
 *  config overrides it. SpaceNavigator's primary button is bnum 0;
 *  pucks with more buttons inherit the same default so a fresh
 *  install always has *something* to react to. */
export const DEFAULT_TRIGGER_BUTTON = 0;

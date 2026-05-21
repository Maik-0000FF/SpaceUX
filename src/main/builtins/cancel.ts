// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ActionHandler } from '../../shared/plugin-types.js';

/**
 * Built-in cancel action.
 *
 * A deliberate no-op. The renderer already hides the menu on commit
 * (see App.tsx) *before* it dispatches the bound action, so "cancel"
 * is the act of dismissing with nothing else happening — the handler
 * has nothing left to do once it runs.
 *
 * It exists as a named, assignable action so the user can place an
 * explicit Cancel on a sector or the center field, with its own label
 * and icon, instead of relying on the implicit "leave the puck
 * centered and commit" gesture. Routing it through the normal dispatch
 * path (rather than special-casing the action key in the renderer)
 * keeps the commit logic uniform: every binding is invoked the same
 * way; this one simply does nothing.
 */
export const cancelAction: ActionHandler = () => {
  // Intentionally empty — see module docstring.
};

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { createShapeModulesStore } from '../../renderer/state/shape-modules-factory';

/**
 * Shape-plugin runtime store for the editor window (#107). Thin
 * wrapper around the shared factory in
 * `src/renderer/state/shape-modules-factory.ts`; the only thing
 * that differs from the live overlay's store is which bridge the
 * IPC pull goes through (`window.editor.getShapeSource` here vs
 * `window.spaceux.getShapeSource` on the overlay side).
 *
 * Two stores rather than one because each renderer window has its
 * own JS realm and its own bridge name. The store logic itself
 * (coalescing, blob-URL dynamic import, module-export validation,
 * error caching) lives in the factory exactly once.
 */
// The factory invokes `subscribePluginInvalidated` eagerly at construction.
// Guard the window access so a renderer reload / test environment without
// a fully populated bridge doesn't throw on module load; the real bridge is
// always present in the editor window at runtime.
const store = createShapeModulesStore(
  (pluginId) => window.editor.getShapeSource(pluginId),
  (handler) =>
    typeof window !== 'undefined' && typeof window.editor?.onPluginInvalidated === 'function'
      ? window.editor.onPluginInvalidated(handler)
      : () => {},
);

export const useShapeModules = store.useShapeModules;
export const _setShapeImporterForTests = store._setShapeImporterForTests;
export type { ShapeSourceImporter } from '../../renderer/state/shape-modules-factory';

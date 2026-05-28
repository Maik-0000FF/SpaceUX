// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { createShapeModulesStore } from './shape-modules-factory';

/**
 * Shape-plugin runtime store for the live overlay window (#107).
 * Thin wrapper around the shared factory in
 * `shape-modules-factory.ts`; the only thing that differs from the
 * editor's store is which bridge the IPC pull goes through
 * (`window.spaceux.getShapeSource` here vs
 * `window.editor.getShapeSource` on the editor side).
 *
 * Two stores rather than one because each renderer window has its
 * own JS realm and its own bridge name. The store logic itself —
 * coalescing, blob-URL dynamic import, module-export validation,
 * error caching — lives in the factory exactly once.
 */
const store = createShapeModulesStore((pluginId) => window.spaceux.getShapeSource(pluginId));

export const useShapeModules = store.useShapeModules;
export const _setShapeImporterForTests = store._setShapeImporterForTests;
export type { ShapeSourceImporter } from './shape-modules-factory';

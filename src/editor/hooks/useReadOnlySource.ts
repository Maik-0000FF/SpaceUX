// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { isPluginMenuId } from '@/shared/plugin-types';

import { useDeviceInfo } from './useDeviceInfo';

/**
 * True when the active config source is a plugin-provided menu (e.g. the
 * dynamic FreeCAD pie, #77): main returns no writable target for it
 * (index.ts:1051), so the editor's config is a read-only overlay — saving an
 * edit would fail. Mirrors main's `getWriteTarget` condition exactly (both via
 * `isPluginMenuId`), so the editor and main can't drift on what's writable.
 *
 * Drives the read-only affordance: the banner (App) and disabled edit
 * controls, plus the menu-settings store's mutation guard, so an edit on a
 * read-only source is prevented up front instead of failing the write-back
 * with a cryptic "no writable config path available".
 */
export function useReadOnlySource(): boolean {
  return isPluginMenuId(useDeviceInfo().profileId);
}

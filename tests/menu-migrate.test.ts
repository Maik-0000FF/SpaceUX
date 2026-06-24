// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { MENU_CONFIG_VERSION, migrateMenuConfig } from '@/shared/menu';

// The migration framework is a stub today (MENU_CONFIG_VERSION === 1, no
// step migrations), so these pin its contract: a future version bump can
// register migrations without changing how the loader calls this.
describe('migrateMenuConfig', () => {
  it('is a no-op at the current version, returning the same object', () => {
    const raw = { version: MENU_CONFIG_VERSION, root: { branches: [] } };
    const result = migrateMenuConfig(raw, MENU_CONFIG_VERSION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.raw).toBe(raw);
  });

  it('rejects a version newer than supported', () => {
    const result = migrateMenuConfig({ version: MENU_CONFIG_VERSION + 1 }, MENU_CONFIG_VERSION + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/newer than supported/);
  });

  it('rejects when no migration is registered for an older version', () => {
    const result = migrateMenuConfig({ version: MENU_CONFIG_VERSION - 1 }, MENU_CONFIG_VERSION - 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no migration registered/);
  });
});

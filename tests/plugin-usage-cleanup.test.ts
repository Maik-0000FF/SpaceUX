// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { stripShapeModel } from '../src/main/plugin-usage';
import { DEFAULT_MENU_CONFIG, type MenuConfig } from '../src/shared/menu';

describe('stripShapeModel (shape-plugin uninstall cleanup)', () => {
  const base: MenuConfig = {
    ...DEFAULT_MENU_CONFIG,
    root: { label: 'C', branches: [{ label: 'A' }] },
  };

  it('drops an override referencing the removed plugin (back to inherit)', () => {
    const cfg: MenuConfig = { ...base, shapeModel: 'org.x.planets/planets' };
    const next = stripShapeModel(cfg, 'org.x.planets');
    expect(next).not.toBeNull();
    expect('shapeModel' in next!).toBe(false);
    expect(cfg.shapeModel).toBe('org.x.planets/planets');
  });

  it('leaves other values untouched (null = no write needed)', () => {
    expect(stripShapeModel(base, 'org.x.planets')).toBeNull();
    expect(stripShapeModel({ ...base, shapeModel: null }, 'org.x.planets')).toBeNull();
    expect(stripShapeModel({ ...base, shapeModel: 'org.other/ring' }, 'org.x.planets')).toBeNull();
  });
});

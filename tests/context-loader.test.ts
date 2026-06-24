// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MENU_CONFIG, MENU_CONFIG_VERSION } from '@/shared/menu';
import {
  isContextMenuId,
  makeContextMenuId,
  parseContextMenuId,
  contextKeyToLabel,
} from '@/shared/plugin-types';

import {
  deleteContextMenu,
  listContextMenus,
  loadContextMenu,
  migrateContextMenusDir,
  resolveContextMenuConfig,
  seedContextConfig,
  contextMenuPath,
  writeContextMenu,
} from '../src/main/context-loader';

const PLUGIN = 'org.spaceux.freecad';
const ID = makeContextMenuId(PLUGIN, 'PartDesignWorkbench');

describe('context-menu id helpers', () => {
  it('builds and parses an id (single ":" separator after the prefix)', () => {
    expect(ID).toBe('ctx:org.spaceux.freecad:PartDesignWorkbench');
    expect(isContextMenuId(ID)).toBe(true);
    expect(parseContextMenuId(ID)).toEqual({
      pluginId: PLUGIN,
      contextKey: 'PartDesignWorkbench',
    });
  });

  it('keeps an underscored workbench key intact through id + filename', () => {
    // The plugin id has no underscore, so the first "__" in the filename is the
    // separator even when the key itself contains "__".
    const id = makeContextMenuId(PLUGIN, 'Foo__Bar');
    expect(parseContextMenuId(id)).toEqual({ pluginId: PLUGIN, contextKey: 'Foo__Bar' });
    expect(path.basename(contextMenuPath(id, '/tmp')!)).toBe('org.spaceux.freecad__Foo__Bar.json');
  });

  it('rejects non-workbench / malformed ids', () => {
    expect(isContextMenuId('plugin:org.spaceux.freecad')).toBe(false);
    expect(isContextMenuId(null)).toBe(false);
    expect(parseContextMenuId('ctx:')).toBeNull(); // no body
    expect(parseContextMenuId('ctx:onlyplugin')).toBeNull(); // no separator
    expect(parseContextMenuId('ctx::Key')).toBeNull(); // empty plugin id
    expect(parseContextMenuId('ctx:plugin:')).toBeNull(); // empty key
  });

  it('returns null path for a malformed id (guards stray IPC)', () => {
    expect(contextMenuPath('plugin:x', '/tmp')).toBeNull();
    expect(contextMenuPath('ctx:bad/plugin:Key', '/tmp')).toBeNull(); // slash in plugin id
    expect(contextMenuPath('ctx:org.spaceux.freecad:Bad Key', '/tmp')).toBeNull(); // space in key
  });

  it('derives a readable offline label from a workbench class key', () => {
    expect(contextKeyToLabel('PartDesignWorkbench')).toBe('Part Design');
    expect(contextKeyToLabel('MeshWorkbench')).toBe('Mesh');
    expect(contextKeyToLabel('PartWorkbench')).toBe('Part');
    expect(contextKeyToLabel('TechDrawWorkbench')).toBe('Tech Draw');
    expect(contextKeyToLabel('OpenSCADWorkbench')).toBe('Open SCAD');
    // No "Workbench" suffix / pure acronym: left intact.
    expect(contextKeyToLabel('BIM')).toBe('BIM');
    // Degenerate key collapses to empty → fall back to the raw key.
    expect(contextKeyToLabel('Workbench')).toBe('Workbench');
  });
});

describe('context-menu storage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-wb-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports absent when no file exists (un-curated workbench)', async () => {
    expect((await loadContextMenu(ID, dir)).status).toBe('absent');
  });

  it('reports invalid for a malformed id', async () => {
    expect((await loadContextMenu('plugin:x', dir)).status).toBe('invalid');
  });

  it('writes a bare MenuConfig and loads it back (migrated + validated)', async () => {
    const written = await writeContextMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    expect(written.ok).toBe(true);

    const loaded = await loadContextMenu(ID, dir);
    expect(loaded.status).toBe('loaded');
    if (loaded.status === 'loaded') {
      expect(loaded.config).toEqual(DEFAULT_MENU_CONFIG);
      expect(loaded.path).toBe(contextMenuPath(ID, dir));
      expect(typeof loaded.mtime).toBe('number');
    }
  });

  it('conflict-checks the write against the expected mtime', async () => {
    await writeContextMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    // expectedMtime=null means "no file existed when I loaded" — but one does
    // now, so a second write with null is a conflict, not a silent overwrite.
    const conflict = await writeContextMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    expect(conflict.ok).toBe('conflict');
  });

  it('reports invalid for present-but-broken JSON', async () => {
    await fs.writeFile(contextMenuPath(ID, dir)!, '{ not json', 'utf8');
    expect((await loadContextMenu(ID, dir)).status).toBe('invalid');
  });

  it('lists curated ids, ignoring junk; missing dir is empty', async () => {
    expect(await listContextMenus(path.join(dir, 'nope'))).toEqual([]);

    const a = makeContextMenuId(PLUGIN, 'PartWorkbench');
    const b = makeContextMenuId(PLUGIN, 'SketcherWorkbench');
    await writeContextMenu(a, DEFAULT_MENU_CONFIG, null, dir);
    await writeContextMenu(b, DEFAULT_MENU_CONFIG, null, dir);
    await fs.writeFile(path.join(dir, 'not-a-workbench.txt'), 'x', 'utf8');
    await fs.writeFile(path.join(dir, 'nounderscore.json'), '{}', 'utf8');

    expect(await listContextMenus(dir)).toEqual([a, b].sort());
  });

  it('deletes a curated pie; missing file and malformed id are success', async () => {
    await writeContextMenu(ID, DEFAULT_MENU_CONFIG, null, dir);
    expect(await deleteContextMenu(ID, dir)).toEqual({ ok: true });
    expect((await loadContextMenu(ID, dir)).status).toBe('absent');
    expect(await deleteContextMenu(ID, dir)).toEqual({ ok: true }); // already gone
    expect(await deleteContextMenu('plugin:x', dir)).toEqual({ ok: true }); // malformed
  });
});

describe('resolveContextMenuConfig', () => {
  it('resolves a loaded pie to a WRITABLE active config (source = file, no appearance)', () => {
    const resolved = resolveContextMenuConfig(ID, {
      status: 'loaded',
      config: DEFAULT_MENU_CONFIG,
      mtime: 42,
      path: '/cfg/context-menus/org.spaceux.freecad__PartDesignWorkbench.json',
    });
    expect(resolved).toEqual({
      config: DEFAULT_MENU_CONFIG,
      mtime: 42,
      // source non-null → main's write target points at the file (writable),
      // unlike a read-only plugin menu whose source is null.
      source: '/cfg/context-menus/org.spaceux.freecad__PartDesignWorkbench.json',
      profileId: ID,
      appearance: null, // curated pies inherit the global appearance
    });
  });

  it('returns null when there is no usable file (caller drops the override)', () => {
    expect(resolveContextMenuConfig(ID, { status: 'absent' })).toBeNull();
    expect(resolveContextMenuConfig(ID, { status: 'invalid', reason: 'bad' })).toBeNull();
  });
});

describe('seedContextConfig', () => {
  const group = {
    key: 'PartDesignWorkbench',
    name: 'Part Design',
    toolbars: [
      {
        name: 'PartDesign',
        commands: [
          { command: 'PartDesign_Pad', label: 'Pad', icon: 'data:image/png;base64,AAA' },
          { command: 'PartDesign_Pocket', label: 'Pocket' },
        ],
      },
      {
        name: 'Sketch',
        commands: [{ command: 'PartDesign_X', label: 'X', icon: 'mdi:not-a-data-uri' }],
      },
    ],
  };

  it('seeds one submenu per toolbar, keeping only renderable icons', () => {
    const seeded = seedContextConfig(group, DEFAULT_MENU_CONFIG, 'org.spaceux.freecad');
    expect(seeded.version).toBe(MENU_CONFIG_VERSION);
    expect(seeded.root.label).toBe(''); // empty centre, like the dynamic pie
    // Toolbar → submenu; commands → run-action leaves (mirrors the dynamic pie).
    expect(seeded.root.branches).toEqual([
      {
        label: 'PartDesign',
        branches: [
          {
            label: 'Pad',
            icon: 'data:image/png;base64,AAA',
            action: { id: 'org.spaceux.freecad/run', config: { command: 'PartDesign_Pad' } },
          },
          {
            label: 'Pocket',
            action: { id: 'org.spaceux.freecad/run', config: { command: 'PartDesign_Pocket' } },
          },
        ],
      },
      {
        label: 'Sketch',
        branches: [
          {
            // non-renderable icon dropped
            label: 'X',
            action: { id: 'org.spaceux.freecad/run', config: { command: 'PartDesign_X' } },
          },
        ],
      },
    ]);
    // The base's trigger / navigation carry over for consistency.
    expect(seeded.triggerButton).toBe(DEFAULT_MENU_CONFIG.triggerButton);
  });

  it('drops name/label-less commands, and a toolbar left empty by that', () => {
    const seeded = seedContextConfig(
      {
        key: 'W',
        name: 'W',
        toolbars: [
          {
            name: 'Good',
            commands: [
              { command: 'Good', label: 'Good' },
              { command: 'NoLabel', label: '' }, // unsavable label-less, icon-less leaf
              { command: '', label: 'NoCommand' },
            ],
          },
          // Every command invalid → the whole toolbar (empty submenu) is omitted.
          { name: 'AllBad', commands: [{ command: 'NoLabel', label: '' }] },
          // Empty-named toolbar → omitted (an empty submenu label is unsavable).
          { name: '  ', commands: [{ command: 'Y', label: 'Y' }] },
        ],
      },
      DEFAULT_MENU_CONFIG,
      'p',
    );
    expect(seeded.root.branches!.map((b) => b.label)).toEqual(['Good']);
    expect(seeded.root.branches![0]!.branches!.map((b) => b.label)).toEqual(['Good']);
  });

  it('seeds an empty ring for a context with no toolbars', () => {
    const seeded = seedContextConfig(
      { key: 'Empty', name: 'Empty', toolbars: [] },
      DEFAULT_MENU_CONFIG,
      'p',
    );
    expect(seeded.root.branches).toEqual([]);
  });

  it('expands a command group into a third level, dropping empty/label-less groups (#208)', () => {
    const seeded = seedContextConfig(
      {
        key: 'W',
        name: 'W',
        toolbars: [
          {
            name: 'Tools',
            commands: [
              { command: 'Plain', label: 'Plain' },
              // A group → submenu over its members; the group's own command is
              // not run (it has none). Members are leaves; label-less ones drop.
              {
                command: '',
                label: 'Primitives',
                icon: 'data:image/png;base64,GGG',
                members: [
                  { command: 'Box', label: 'Box', icon: 'data:image/png;base64,BBB' },
                  { command: 'Cyl', label: 'Cyl', icon: 'mdi:not-a-data-uri' },
                  { command: 'NoLabel', label: '' },
                ],
              },
              // A group with no usable members → dropped entirely.
              { command: '', label: 'Empty', members: [{ command: 'X', label: '' }] },
            ],
          },
        ],
      },
      DEFAULT_MENU_CONFIG,
      'org.spaceux.freecad',
    );
    expect(seeded.root.branches).toEqual([
      {
        label: 'Tools',
        branches: [
          {
            label: 'Plain',
            action: { id: 'org.spaceux.freecad/run', config: { command: 'Plain' } },
          },
          {
            label: 'Primitives',
            icon: 'data:image/png;base64,GGG',
            branches: [
              {
                label: 'Box',
                icon: 'data:image/png;base64,BBB',
                action: { id: 'org.spaceux.freecad/run', config: { command: 'Box' } },
              },
              {
                // non-renderable icon dropped
                label: 'Cyl',
                action: { id: 'org.spaceux.freecad/run', config: { command: 'Cyl' } },
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe('migrateContextMenusDir (#288)', () => {
  let cfg: string;
  beforeEach(async () => {
    cfg = await fs.mkdtemp(path.join(os.tmpdir(), 'spaceux-mig-'));
  });
  afterEach(async () => {
    await fs.rm(cfg, { recursive: true, force: true });
  });

  const sample = JSON.stringify({ version: 1, root: { label: '', branches: [] } });

  it('renames the legacy dir when only it exists, keeping files', async () => {
    const legacy = path.join(cfg, 'workbench-menus');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'org.example__PartWorkbench.json'), sample, 'utf8');

    await migrateContextMenusDir(cfg);

    expect(await fs.readdir(path.join(cfg, 'context-menus'))).toEqual([
      'org.example__PartWorkbench.json',
    ]);
    await expect(fs.readdir(legacy)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves both dirs untouched when both already exist', async () => {
    const legacy = path.join(cfg, 'workbench-menus');
    const next = path.join(cfg, 'context-menus');
    await fs.mkdir(legacy, { recursive: true });
    await fs.mkdir(next, { recursive: true });
    await fs.writeFile(path.join(legacy, 'a__OldWorkbench.json'), sample, 'utf8');
    await fs.writeFile(path.join(next, 'b__NewWorkbench.json'), sample, 'utf8');

    await migrateContextMenusDir(cfg);

    expect(await fs.readdir(legacy)).toEqual(['a__OldWorkbench.json']);
    expect(await fs.readdir(next)).toEqual(['b__NewWorkbench.json']);
  });

  it('is a no-op when neither dir exists, and is idempotent', async () => {
    await migrateContextMenusDir(cfg); // neither dir -> no throw, nothing created
    await expect(fs.readdir(path.join(cfg, 'context-menus'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const legacy = path.join(cfg, 'workbench-menus');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'x__SketcherWorkbench.json'), sample, 'utf8');
    await migrateContextMenusDir(cfg);
    await migrateContextMenusDir(cfg); // second call: new exists, legacy gone -> no-op
    expect(await fs.readdir(path.join(cfg, 'context-menus'))).toEqual([
      'x__SketcherWorkbench.json',
    ]);
  });
});

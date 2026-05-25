// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { flattenCatalogCommands } from '../src/editor/state/catalog-filter';
import type { PluginCatalogGroup } from '@/shared/plugin-types';

// A small two-workbench catalog: one plain command, one group (#208) with a
// mix of enabled/disabled/undefined-enabled members, a non-renderable icon, and
// an unusable (no-command) entry.
const groups: PluginCatalogGroup[] = [
  {
    key: 'PartWorkbench',
    name: 'Part',
    toolbars: [
      {
        name: 'Tools',
        commands: [
          { command: 'Part_Box', label: 'Box', icon: 'data:image/png;base64,AAA', enabled: true },
          { command: '', label: 'NoCommand' }, // unusable → dropped
          {
            command: 'Part_Prim', // group node — itself not added, expanded to members
            label: 'Primitives',
            members: [
              { command: 'Part_Cyl', label: 'Cylinder', enabled: true },
              { command: 'Part_Cone', label: 'Cone', enabled: false }, // disabled
              { command: 'Part_Torus', label: 'Torus' }, // enabled undefined → usable
              { command: 'Part_Bad', label: 'Bad', icon: 'mdi:not-a-data-uri' }, // bad icon dropped
            ],
          },
        ],
      },
    ],
  },
  {
    key: 'SketcherWorkbench',
    name: 'Sketcher',
    toolbars: [{ name: 'Sketch', commands: [{ command: 'Sketcher_New', label: 'New Sketch' }] }],
  },
];

const cmds = (gs: ReturnType<typeof flattenCatalogCommands>, key: string): string[] =>
  gs.find((g) => g.key === key)?.commands.map((c) => c.command) ?? [];

describe('flattenCatalogCommands', () => {
  it('flattens toolbars, expands groups into members, drops command/label-less entries', () => {
    const out = flattenCatalogCommands(groups, { scopeKey: null, query: '', enabledOnly: false });
    // Both workbenches present; the group node ("Part_Prim") is replaced by its
    // members, and the no-command entry is gone.
    expect(cmds(out, 'PartWorkbench')).toEqual([
      'Part_Box',
      'Part_Cyl',
      'Part_Cone',
      'Part_Torus',
      'Part_Bad',
    ]);
    expect(cmds(out, 'SketcherWorkbench')).toEqual(['Sketcher_New']);
  });

  it('scopes to a single workbench when scopeKey is set', () => {
    const out = flattenCatalogCommands(groups, {
      scopeKey: 'SketcherWorkbench',
      query: '',
      enabledOnly: false,
    });
    expect(out.map((g) => g.key)).toEqual(['SketcherWorkbench']);
  });

  it('enabledOnly drops enabled===false but keeps undefined-enabled (fail-open, #217)', () => {
    const out = flattenCatalogCommands(groups, {
      scopeKey: 'PartWorkbench',
      query: '',
      enabledOnly: true,
    });
    // Part_Cone (enabled:false) dropped; Part_Torus (enabled undefined) and the
    // explicitly-enabled ones kept.
    expect(cmds(out, 'PartWorkbench')).toEqual(['Part_Box', 'Part_Cyl', 'Part_Torus', 'Part_Bad']);
  });

  it('keeps only renderable (data:) icons', () => {
    const out = flattenCatalogCommands(groups, { scopeKey: null, query: '', enabledOnly: false });
    const part = out.find((g) => g.key === 'PartWorkbench')!.commands;
    expect(part.find((c) => c.command === 'Part_Box')!.icon).toBe('data:image/png;base64,AAA');
    expect(part.find((c) => c.command === 'Part_Bad')!.icon).toBeUndefined(); // mdi: dropped
  });

  it('matches the query against the label (case-insensitive) and drops emptied groups', () => {
    const out = flattenCatalogCommands(groups, {
      scopeKey: null,
      query: 'cyl',
      enabledOnly: false,
    });
    // Only "Cylinder" matches → Sketcher group has no matches and is dropped.
    expect(out.map((g) => g.key)).toEqual(['PartWorkbench']);
    expect(cmds(out, 'PartWorkbench')).toEqual(['Part_Cyl']);
  });
});

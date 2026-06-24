// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HostEnvironment } from '../src/shared/plugin-types';

/**
 * buildDefaultMenu attaches theme icons to the structural default via the same
 * resolver the editor's auto-icon uses (resolveIconFile -> encodeIconFile).
 * Mock both so the test asserts the wiring (which node gets which icon name,
 * and the graceful no-icon path) without touching a real icon theme. The mock
 * bakes the resolved file path into the data URI so each node's icon can be
 * traced back to the name it was resolved from.
 */
type Encoded = { ok: true; dataUri: string } | { ok: false; reason: string };
const { resolveIconFileMock, encodeIconFileMock } = vi.hoisted(() => ({
  resolveIconFileMock: vi.fn((name: string): string | null => `/fake/${name}.png`),
  encodeIconFileMock: vi.fn(
    (file: string): Encoded => ({ ok: true, dataUri: `data:image/png;base64,${file}` }),
  ),
}));

vi.mock('../src/main/icon-theme', () => ({
  resolveIconFile: (name: string) => resolveIconFileMock(name),
}));
vi.mock('../src/main/icon-encode', () => ({
  encodeIconFile: async (file: string) => encodeIconFileMock(file),
}));

import { buildDefaultMenu } from '../src/main/default-menu';

const host = {} as HostEnvironment; // resolveIconFile is mocked, so its shape is irrelevant
const WAVE = '/fake/assets/emoji/1f44b.svg';

afterEach(() => {
  resolveIconFileMock.mockReset();
  resolveIconFileMock.mockImplementation((name: string) => `/fake/${name}.png`);
  encodeIconFileMock.mockReset();
  encodeIconFileMock.mockImplementation((file: string) => ({
    ok: true,
    dataUri: `data:image/png;base64,${file}`,
  }));
});

describe('buildDefaultMenu (#327 follow-up)', () => {
  it('resolves a theme icon for each mapped node and traces it to the right name', async () => {
    const menu = await buildDefaultMenu(host);
    const top = menu.root.branches ?? [];
    const byLabel = (label: string) => top.find((n) => n.label === label);

    // With no centre-icon file passed, the centre keeps its emoji label.
    expect(menu.root.label).toBe('👋');
    expect(menu.root.icon).toBeUndefined();

    expect(byLabel('Switch Window')?.icon).toContain('preferences-system-windows');
    expect(byLabel('Show Desktop')?.icon).toContain('user-desktop');

    const sound = byLabel('Sound');
    expect(sound?.icon).toContain('multimedia-volume-control');
    const soundChildren = sound?.branches ?? [];
    const child = (label: string) => soundChildren.find((n) => n.label === label);
    expect(child('Volume +')?.icon).toContain('audio-volume-high');
    expect(child('Mute')?.icon).toContain('audio-volume-muted');
    // Guards the U+2212 minus matching between the menu and the icon-name map.
    expect(child('Volume −')?.icon).toContain('audio-volume-low');
  });

  it('every resolved icon is a renderable data URI', async () => {
    const menu = await buildDefaultMenu(host);
    const icons: string[] = [];
    const collect = (nodes: { icon?: string; branches?: unknown[] }[]) => {
      for (const n of nodes) {
        if (n.icon) icons.push(n.icon);
        if (n.branches) collect(n.branches as never[]);
      }
    };
    collect((menu.root.branches ?? []) as never[]);
    expect(icons.length).toBe(6); // every mapped node resolved
    expect(icons.every((i) => i.startsWith('data:image/'))).toBe(true);
  });

  it('shows the bundled wave centre icon and clears the emoji label when given one', async () => {
    const menu = await buildDefaultMenu(host, WAVE);
    expect(menu.root.icon).toBe(`data:image/png;base64,${WAVE}`);
    expect(menu.root.label).toBe(''); // icon alone, no stacked emoji text
  });

  it('degrades to the emoji label when the centre icon file cannot be encoded', async () => {
    encodeIconFileMock.mockImplementation((file: string) =>
      file === WAVE ? { ok: false, reason: 'missing' } : { ok: true, dataUri: `data:x,${file}` },
    );
    const menu = await buildDefaultMenu(host, WAVE);
    expect(menu.root.icon).toBeUndefined();
    expect(menu.root.label).toBe('👋');
  });

  it('leaves nodes icon-less (no error) when the theme lacks the name', async () => {
    resolveIconFileMock.mockReturnValue(null);
    const menu = await buildDefaultMenu(host);
    const top = menu.root.branches ?? [];
    expect(top.every((n) => n.icon === undefined)).toBe(true);
    // Structure is otherwise intact (labels + the submenu still there).
    expect(top.map((n) => n.label)).toEqual(['Switch Window', 'Sound', 'Show Desktop', 'Custom']);
    expect(top.find((n) => n.label === 'Sound')?.branches).toHaveLength(3);
  });
});

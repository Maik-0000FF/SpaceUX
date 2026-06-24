// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { collectButtonBindings, conflictsOn, severityOf } from '../src/core/button-conflicts';
import type { MenuConfig, MenuNavigation, MenuNode } from '../src/shared/menu';

const button = (b: number) => ({ inputs: [{ kind: 'button' as const, button: b }] });

function cfg(partial: {
  triggerButton?: number;
  triggerMode?: 'toggle' | 'open';
  navigation?: Partial<MenuNavigation>;
  root?: MenuNode;
}): MenuConfig {
  return {
    version: 1,
    root: partial.root ?? { id: 'root', label: '', branches: [] },
    triggerButton: partial.triggerButton,
    triggerMode: partial.triggerMode,
    navigation: partial.navigation as MenuNavigation | undefined,
  } as MenuConfig;
}

describe('collectButtonBindings', () => {
  it('collects the trigger button as a hard source in toggle mode', () => {
    const b = collectButtonBindings(cfg({ triggerButton: 2, triggerMode: 'toggle' }));
    expect(b).toContainEqual({ button: 2, source: 'Trigger button', weight: 'hard' });
  });

  it('omits the trigger button in open-only mode (free to bind as an input)', () => {
    const b = collectButtonBindings(cfg({ triggerButton: 2, triggerMode: 'open' }));
    expect(b.find((x) => x.source === 'Trigger button')).toBeUndefined();
  });

  it('collects global navigation gesture buttons as hard sources', () => {
    const b = collectButtonBindings(
      cfg({ triggerMode: 'open', navigation: { drillIn: button(3), back: button(4) } }),
    );
    expect(b).toContainEqual({ button: 3, source: 'Open submenu', weight: 'hard' });
    expect(b).toContainEqual({ button: 4, source: 'Go back', weight: 'hard' });
  });

  it('collects per-item activation/exit as soft sources, named by label', () => {
    const root: MenuNode = {
      label: '',
      branches: [{ label: 'Cut', activation: button(5), exit: button(6) }],
    };
    const b = collectButtonBindings(cfg({ triggerMode: 'open', root }));
    expect(b).toContainEqual({ button: 5, source: '"Cut" activation', weight: 'soft' });
    expect(b).toContainEqual({ button: 6, source: '"Cut" exit', weight: 'soft' });
  });
});

describe('conflictsOn + severityOf', () => {
  it('flags a hard conflict between the toggle trigger and a gesture on the same button', () => {
    const bindings = collectButtonBindings(
      cfg({ triggerButton: 0, triggerMode: 'toggle', navigation: { back: button(0) } }),
    );
    // From the trigger picker's view, the gesture is the conflict.
    const fromTrigger = conflictsOn(bindings, 0, 'Trigger button');
    expect(fromTrigger.map((c) => c.source)).toEqual(['Go back']);
    expect(severityOf(fromTrigger)).toBe('hard');
    // From the gesture picker's view, the trigger is the conflict.
    expect(severityOf(conflictsOn(bindings, 0, 'Go back'))).toBe('hard');
  });

  it('is soft when only a per-item gesture shares the button', () => {
    const root: MenuNode = {
      label: '',
      branches: [{ label: 'Cut', activation: button(1) }],
    };
    const bindings = collectButtonBindings(
      cfg({ triggerMode: 'open', navigation: { drillIn: button(1) }, root }),
    );
    expect(severityOf(conflictsOn(bindings, 1, 'Open submenu'))).toBe('soft');
  });

  it('is free for an unused button, and excludes the binding itself', () => {
    const bindings = collectButtonBindings(cfg({ triggerButton: 0, triggerMode: 'toggle' }));
    expect(severityOf(conflictsOn(bindings, 7))).toBe('free');
    // The trigger on button 0 does not flag against itself.
    expect(severityOf(conflictsOn(bindings, 0, 'Trigger button'))).toBe('free');
  });
});

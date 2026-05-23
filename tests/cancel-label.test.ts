// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { cancelLabelFor } from '../src/editor/state/cancel-label';
import { BUILTIN_ACTION, builtinAction } from '../src/shared/menu';

const CANCEL = builtinAction(BUILTIN_ACTION.CANCEL);

describe('cancelLabelFor', () => {
  it('suggests "Cancel" when cancel is picked onto an empty label', () => {
    expect(cancelLabelFor(CANCEL, '')).toBe('Cancel');
  });

  it('suggests "Cancel" when cancel is picked onto the generic "New item" default', () => {
    expect(cancelLabelFor(CANCEL, 'New item')).toBe('Cancel');
  });

  it('suggests "Cancel" onto an auto-generated path label ("Item 1.2")', () => {
    expect(cancelLabelFor(CANCEL, 'Item 1.2')).toBe('Cancel');
  });

  it('leaves a custom label alone', () => {
    expect(cancelLabelFor(CANCEL, 'Abbrechen')).toBeNull();
  });

  it('does nothing for a non-cancel action', () => {
    expect(cancelLabelFor(builtinAction(BUILTIN_ACTION.EXEC), '')).toBeNull();
    expect(cancelLabelFor('some.plugin.action', 'New item')).toBeNull();
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';

import {
  confirmDeleteNode,
  confirmDiscardChildren,
  countDescendants,
} from '../src/editor/confirm-delete-node';
import { useConfirm } from '../src/editor/state/confirm';

afterEach(() => {
  // Drop any dialog a test left pending so the next one starts clean.
  useConfirm.setState({ pending: null });
});

describe('countDescendants', () => {
  it('is 0 for a leaf or an empty submenu', () => {
    expect(countDescendants({})).toBe(0);
    expect(countDescendants({ branches: [] })).toBe(0);
  });

  it('counts the whole subtree, not just direct children', () => {
    const node = {
      branches: [{ label: 'a' }, { label: 'b', branches: [{ label: 'b1' }, { label: 'b2' }] }],
    };
    // a, b, b1, b2
    expect(countDescendants(node)).toBe(4);
  });
});

describe('confirmDeleteNode', () => {
  it('resolves true without prompting for a leaf', async () => {
    expect(await confirmDeleteNode({ label: 'Open' })).toBe(true);
    expect(useConfirm.getState().pending).toBeNull();
  });

  it('resolves true without prompting for an empty submenu', async () => {
    expect(await confirmDeleteNode({ label: 'Empty', branches: [] })).toBe(true);
    expect(useConfirm.getState().pending).toBeNull();
  });

  it('prompts naming the node + item count and forwards a confirm', async () => {
    const node = { label: 'Edit', branches: [{ label: 'a' }, { label: 'b' }] };
    const result = confirmDeleteNode(node);
    expect(useConfirm.getState().pending?.message).toBe('Delete "Edit" and its 2 items?');
    useConfirm.getState().settle(true);
    expect(await result).toBe(true);
  });

  it('forwards a cancel as false', async () => {
    const node = { label: 'Edit', branches: [{ label: 'a' }] };
    const result = confirmDeleteNode(node);
    // singular item count
    expect(useConfirm.getState().pending?.message).toBe('Delete "Edit" and its 1 item?');
    useConfirm.getState().settle(false);
    expect(await result).toBe(false);
  });

  it('falls back to a generic name when the label is empty', async () => {
    const node = { label: '', branches: [{ label: 'a' }] };
    confirmDeleteNode(node);
    expect(useConfirm.getState().pending?.message).toBe('Delete this submenu and its 1 item?');
  });
});

describe('confirmDiscardChildren', () => {
  it('resolves true without prompting for a leaf', async () => {
    expect(await confirmDiscardChildren({ label: 'Open' })).toBe(true);
    expect(useConfirm.getState().pending).toBeNull();
  });

  it('prompts with the discard wording and forwards the choice', async () => {
    const node = { label: 'Edit', branches: [{ label: 'a' }, { label: 'b' }] };
    const result = confirmDiscardChildren(node);
    expect(useConfirm.getState().pending?.message).toBe('Discard "Edit" and its 2 items?');
    expect(useConfirm.getState().pending?.confirmLabel).toBe('Discard');
    useConfirm.getState().settle(false);
    expect(await result).toBe(false);
  });
});

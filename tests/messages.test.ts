// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirm, useConfirm } from '../src/editor/state/confirm';
import { notify, useToasts } from '../src/editor/state/toasts';

// The confirm + toast stores are pure logic (no window/DOM), so they're testable
// like the other editor stores. Reset between tests.
beforeEach(() => {
  useConfirm.setState({ pending: null });
  useToasts.setState({ toasts: [] });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('confirm store', () => {
  it('opens a pending request and resolves true on confirm', async () => {
    const p = confirm({ message: 'Sure?' });
    expect(useConfirm.getState().pending?.message).toBe('Sure?');
    useConfirm.getState().settle(true);
    await expect(p).resolves.toBe(true);
    expect(useConfirm.getState().pending).toBeNull(); // closed
  });

  it('resolves false on cancel/dismiss', async () => {
    const p = confirm({ message: 'Sure?' });
    useConfirm.getState().settle(false);
    await expect(p).resolves.toBe(false);
  });

  it('supersedes an unanswered request, resolving the old one false', async () => {
    const first = confirm({ message: 'first' });
    const second = confirm({ message: 'second' });
    await expect(first).resolves.toBe(false); // superseded
    expect(useConfirm.getState().pending?.message).toBe('second');
    useConfirm.getState().settle(true);
    await expect(second).resolves.toBe(true);
  });

  it('settle with nothing pending is a no-op', () => {
    expect(() => useConfirm.getState().settle(true)).not.toThrow();
    expect(useConfirm.getState().pending).toBeNull();
  });
});

describe('toasts store', () => {
  it('adds a toast and auto-dismisses it after its TTL', () => {
    const id = notify('success', 'Saved');
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(useToasts.getState().toasts[0]).toMatchObject({ id, kind: 'success', text: 'Saved' });
    vi.advanceTimersByTime(4000);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('keeps an error toast longer than a success toast', () => {
    notify('success', 's');
    notify('error', 'e');
    vi.advanceTimersByTime(4000); // success TTL
    expect(useToasts.getState().toasts.map((t) => t.kind)).toEqual(['error']);
    vi.advanceTimersByTime(4000); // remaining error TTL (8000 total)
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it('dismiss removes a specific toast immediately', () => {
    const a = notify('info', 'a');
    notify('info', 'b');
    useToasts.getState().dismiss(a);
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(['b']);
  });
});

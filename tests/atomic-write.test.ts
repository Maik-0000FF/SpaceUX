// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { atomicWriteFile, atomicWriteFileSync } from '../src/main/atomic-write';

describe('atomicWriteFile (#457 collision-proof temp)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'spaceux-aw-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tempLeftovers = async (): Promise<string[]> =>
    (await readdir(dir)).filter((f) => f.endsWith('.tmp'));

  it('writes the content atomically and leaves no temp file', async () => {
    const target = path.join(dir, 'x.json');
    await atomicWriteFile(target, 'hello');
    expect(await readFile(target, 'utf8')).toBe('hello');
    expect(await tempLeftovers()).toEqual([]);
  });

  it('many concurrent writes to one target all succeed (the same-ms burst)', async () => {
    // Before the monotonic counter, writes landing in the same millisecond minted
    // the SAME temp name, so a second rename hit ENOENT and rejected — the slider
    // drag that surfaced this. All must resolve now, with no temp left behind.
    const target = path.join(dir, 'y.json');
    await Promise.all(Array.from({ length: 50 }, (_, i) => atomicWriteFile(target, `v${i}`)));
    expect((await readFile(target, 'utf8')).startsWith('v')).toBe(true);
    expect(await tempLeftovers()).toEqual([]);
  });

  it('the sync variant writes + cleans up', async () => {
    const target = path.join(dir, 'z.json');
    atomicWriteFileSync(target, 'sync');
    expect(await readFile(target, 'utf8')).toBe('sync');
    expect(await tempLeftovers()).toEqual([]);
  });
});

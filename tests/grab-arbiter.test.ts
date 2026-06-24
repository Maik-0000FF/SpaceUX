// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { createGrabArbiter } from '../src/main/grab-intent';

/**
 * Unit-tests the grab arbiter (#199): a single grab() on the first owner, a
 * single release() only on the last, and reapply() re-issuing the grab after a
 * reconnect when intent is still held. This is the contract that lets the pie
 * and desktop mode share the device grab without one dropping the other's.
 */
function makeDevice() {
  return { grab: vi.fn(), release: vi.fn() };
}

describe('createGrabArbiter', () => {
  it('grabs once on the first owner and not again for a second', () => {
    const device = makeDevice();
    const arbiter = createGrabArbiter(device);

    arbiter.acquire('pie');
    arbiter.acquire('desktop');

    expect(device.grab).toHaveBeenCalledTimes(1);
    expect(device.release).not.toHaveBeenCalled();
  });

  it('releases only once the last owner releases', () => {
    const device = makeDevice();
    const arbiter = createGrabArbiter(device);
    arbiter.acquire('pie');
    arbiter.acquire('desktop');

    arbiter.release('pie');
    expect(device.release).not.toHaveBeenCalled(); // desktop still holds it

    arbiter.release('desktop');
    expect(device.release).toHaveBeenCalledTimes(1);
  });

  it('ignores releasing an owner that never acquired', () => {
    const device = makeDevice();
    const arbiter = createGrabArbiter(device);
    arbiter.acquire('desktop');

    arbiter.release('pie'); // stray release must not drop desktop's grab

    expect(device.release).not.toHaveBeenCalled();
  });

  it('re-acquiring the same owner does not grab twice', () => {
    const device = makeDevice();
    const arbiter = createGrabArbiter(device);

    arbiter.acquire('pie');
    arbiter.acquire('pie');

    expect(device.grab).toHaveBeenCalledTimes(1);
  });

  it('grabs again after a full release cycle (release to zero, then re-acquire)', () => {
    const device = makeDevice();
    const arbiter = createGrabArbiter(device);

    arbiter.acquire('pie'); // grab #1
    arbiter.release('pie'); // release #1 (owners empty)
    arbiter.acquire('pie'); // grab #2 — a fresh open after a real close

    expect(device.grab).toHaveBeenCalledTimes(2);
    expect(device.release).toHaveBeenCalledTimes(1);
  });

  it('reapply re-issues the grab when an owner is held, and is a no-op otherwise', () => {
    const device = makeDevice();
    const arbiter = createGrabArbiter(device);

    arbiter.reapply(); // nothing held
    expect(device.grab).not.toHaveBeenCalled();

    arbiter.acquire('desktop'); // grab #1
    arbiter.reapply(); // grab #2 (post-reconnect re-issue)
    expect(device.grab).toHaveBeenCalledTimes(2);
  });
});

// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Owner-tracked arbitration for the daemon's exclusive device grab.
 *
 * The daemon grabs the SpaceMouse (EVIOCGRAB) whenever the app holds a GRAB
 * (#327), but app-side the grab is a single boolean per connection and RELEASE
 * is absolute, not a decrement. With only the pie holding it that is fine, but
 * desktop mode (#199) needs a *persistent* grab that outlives an open/close of
 * the pie. If the pie and desktop control both called grab()/release()
 * directly, the pie closing would drop the grab desktop mode still needs.
 *
 * This arbiter tracks the set of intent owners (e.g. 'pie', 'desktop'): it
 * issues a single grab() when the first owner acquires and a single release()
 * only when the last owner releases. So the device stays continuously grabbed
 * across the pie opening and closing while desktop mode is active, and only
 * really releases once nothing wants it.
 */
export type GrabArbiter = {
  /** Register intent for `owner`. Grabs the device when it was the first. */
  acquire: (owner: string) => void;
  /** Drop `owner`'s intent. Releases the device when it was the last. */
  release: (owner: string) => void;
  /** Re-issue the grab after a daemon reconnect: the daemon drops the kernel
   *  grab when the client socket disconnects, so if any owner still holds
   *  intent the grab must be taken again. No-op when nothing is held. */
  reapply: () => void;
};

export function createGrabArbiter(device: { grab: () => void; release: () => void }): GrabArbiter {
  const owners = new Set<string>();
  return {
    acquire(owner) {
      const wasEmpty = owners.size === 0;
      owners.add(owner);
      if (wasEmpty) device.grab();
    },
    release(owner) {
      // Only act on an owner that was actually held, so a stray release can't
      // drop a grab another owner still wants.
      if (!owners.delete(owner)) return;
      if (owners.size === 0) device.release();
    },
    reapply() {
      if (owners.size > 0) device.grab();
    },
  };
}

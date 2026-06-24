/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * inject - virtual keyboard for injecting modifier+key chords.
 *
 * The daemon owns one virtual input device for its lifetime. Clients
 * send `INJECT_CHORD` commands over the IPC socket and the daemon
 * relays the chord through this layer; on Linux that means /dev/uinput,
 * which sits below the compositor in the kernel input plumbing so the
 * compositor routes our events exactly like physical hardware.
 *
 * Why this instead of xdotool / ydotool / per-DE D-Bus bindings:
 *   - Wayland clients are not allowed to inject keys into other
 *     windows. Going through the kernel via uinput is the only
 *     portable Wayland path that also delivers compositor-level
 *     shortcuts (Alt+Tab, Super, media keys).
 *   - We already need /dev/input/eventN read access for the puck;
 *     /dev/uinput uses the same permission class (input group +
 *     uaccess udev rule), so this adds no new user-side setup.
 *   - Removing the ydotool dependency drops an external daemon
 *     (ydotoold) and a per-action subprocess spawn (~5-20ms saved
 *     per chord; not huge but cumulative under a chord-stream).
 *
 * Failure semantics:
 *   inject_open returns -1 when /dev/uinput is unavailable (no kernel
 *   module, no permission). The daemon stays up — input reading and
 *   broadcast still work — and inject_chord is a no-op when called
 *   with a negative fd. The daemon's hello message exposes an
 *   "inject" capability flag so a client can show "key injection
 *   unavailable" instead of failing silently.
 *
 * Linux-only today. Windows will use SendInput and macOS CGEventPost
 * in their own inject_<platform>.c file; the header contract stays the
 * same so the dispatch layer never needs to know which backend ran.
 */
#ifndef SPACEUX_INJECT_H
#define SPACEUX_INJECT_H

/* Open and register the virtual keyboard. Returns the backing fd
 * (>= 0) on success or -1 if uinput is unavailable for any reason
 * (errno is logged; the daemon continues without injection). The
 * caller owns the fd for the daemon's lifetime and passes it to
 * inject_chord. Never share the fd across a fork without re-opening. */
int inject_open(void);

/* Open and register a second virtual device, a relative pointer, used
 * for analog scroll (and future pointer actions) in desktop mode (#199).
 * Kept separate from the keyboard so the compositor classifies each
 * device cleanly. Returns the backing fd (>= 0) or -1 if uinput is
 * unavailable (errno logged; the daemon continues without scrolling).
 * The caller owns the fd for the daemon's lifetime and passes it to
 * inject_scroll; tear it down with inject_close like the keyboard fd. */
int inject_pointer_open(void);

/* Tear down a virtual device (keyboard or pointer) and close its fd.
 * Safe to call with a negative fd (no-op), which matches the open-failed
 * case of either device. */
void inject_close(int fd);

/* Send one modifier+key chord. The implementation issues three
 * SYN_REPORT phases so the compositor sees "all modifiers held →
 * key pressed while held → modifiers released", which is what
 * triggers cycling shortcuts like Alt+Tab. Folding the whole
 * sequence into one SYN would deliver every event in one input frame
 * and the switcher would never enter cycle state.
 *
 * Pass a negative `fd` to no-op (the open-failed case). `n_mods` may
 * be 0, meaning "tap key alone, no modifiers". */
void inject_chord(int fd, const int *mods, int n_mods, int key);

/* Emit a relative scroll on the pointer device. `dx`/`dy` are
 * high-resolution wheel units (120 per traditional wheel notch, the
 * REL_WHEEL_HI_RES convention): positive dy scrolls up, positive dx
 * scrolls right. Both a hi-res event and the accumulated whole-notch
 * REL_WHEEL/REL_HWHEEL are emitted, so smooth-scroll consumers get the
 * fine value while classic-wheel consumers still step once per notch;
 * the sub-notch remainder is carried across calls. A zero axis emits
 * nothing for that axis. Pass a negative `fd` to no-op. */
void inject_scroll(int fd, int dx, int dy);

#endif /* SPACEUX_INJECT_H */

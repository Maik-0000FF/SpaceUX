/*
 * SPDX-FileCopyrightText: Maik-0000FF
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * led - status LED control for the SpaceMouse puck.
 *
 * SpaceMouse pucks light their status LED constantly once the device
 * enumerates on USB. SpaceUX uses the LED as a visual cue: bright
 * while the pie menu is open and the user is making a selection, dark
 * otherwise. The light then becomes a calm "I am selecting" indicator
 * instead of an always-on glow.
 *
 * Control path: a 2-byte report written directly to /dev/hidrawN.
 * The first byte is the report ID (0x04), the second is the state
 * (0x01 = on, 0x00 = off). This bypasses libspnav and spacenavd —
 * libspnav's spnav_cfg_set_led has long been broken against newer
 * spacenavd protocol versions, and the direct write works regardless
 * of whether spacenavd is installed at all. Same trick the reference
 * project Maik-0000FF/SpaceMouse_3dconnexion uses in its GUI for the
 * same reason (gui/spacemouse_config/helpers.py).
 *
 * Permission story: the same install-time udev rule that grants
 * uaccess to /dev/input/event* for the puck also covers /dev/hidraw*
 * for the matching VID/PID. No extra user setup is required beyond
 * what the daemon already needs to read the puck.
 *
 * Failure semantics: led_open returns -1 when no SpaceMouse hidraw
 * node is present or hidraw permissions deny access. The daemon
 * keeps running; led_set is a no-op on a negative fd, the same
 * fail-soft pattern as inject.h.
 */
#ifndef SPACEUX_LED_H
#define SPACEUX_LED_H

/* Locate the SpaceMouse hidraw node and open it write-only. Returns
 * the fd on success or -1 if no matching device is present or hidraw
 * permissions deny access. The caller owns the fd for the daemon's
 * lifetime and passes it to led_set. */
int led_open(void);

/* Close the hidraw fd. Safe to call with a negative fd (no-op). */
void led_close(int fd);

/* Drive the LED: on != 0 lights it up, on == 0 turns it dark. No-op
 * when fd is negative (open failed at startup). Write errors are
 * silently dropped — the LED is a status hint, not a load-bearing
 * dependency, and a stuck LED never breaks the puck's actual input. */
void led_set(int fd, int on);

#endif /* SPACEUX_LED_H */

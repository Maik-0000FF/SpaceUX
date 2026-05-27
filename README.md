<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# SpaceUX

A radial pie-menu UI for 3Dconnexion SpaceMouse devices on Linux. Push, tilt or
twist the puck to open a menu at the cursor and fire actions, navigate, or drive
your desktop, without reaching for the keyboard.

The current screencast shows the FreeCAD plugin (a work in progress):

<video src="https://github.com/user-attachments/assets/9940790f-f1c7-4471-9a02-329c09f6a30f" controls width="100%"></video>

## The idea

SpaceUX is built to become an **ecosystem around the SpaceMouse**, not a single
fixed tool. A small core (the input daemon, the pie overlay, and the editor)
does the plumbing; everything on top is meant to be extensible through a plugin
API:

- **Function plugins** add actions and whole menus, so a plugin can teach the
  pie new things to do (launch apps, run commands, control an application).
- **Theme plugins** restyle the pie: colours, shape, typography.
- **Navigation-style plugins** package how you move through the menu (drill,
  cycle, twist, tilt) into shareable presets.
- **Application bridges** connect the pie to a specific program (the FreeCAD
  bridge, for example, surfaces the active workbench's commands).
- **Desktop and system plugins** drive the desktop itself (windows, workspaces,
  media, and more), tailored to your Linux distribution and desktop
  environment, and can act on a SpaceMouse gesture even without opening the pie.

The goal: one device, one input layer, and a growing catalogue of plugins that
adapt it to whatever you do, from a single application to your whole desktop,
instead of every program reinventing SpaceMouse support on its own.

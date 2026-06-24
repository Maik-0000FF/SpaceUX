<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Using SpaceUX

SpaceUX turns a 3Dconnexion SpaceMouse into a radial pie menu. A small background
daemon reads the device, the app draws the pie at the cursor and fires actions,
and an editor lets you build your own menus. This guide covers day-to-day use.

## Table of contents

- [Starting SpaceUX](#starting-spaceux)
- [Opening the pie](#opening-the-pie)
- [Navigating with "Tilt to aim"](#navigating-with-tilt-to-aim)
- [The editor](#the-editor)
  - [Action examples](#action-examples)
- [Settings](#settings)
- [Desktop mode](#desktop-mode)
- [Plugins](#plugins)
- [Troubleshooting](#troubleshooting)

## Starting SpaceUX

After [installing](install.md), launch **SpaceUX** from your application menu, or
run `spaceux` in a terminal. It starts the input daemon and the app in the
background (a tray icon) and opens the editor. The tray menu offers a **Desktop
mode** checkbox, **Open Editor**, and **Quit** (which closes everything, the
editor included); launching SpaceUX again while it runs reopens the editor. The
login autostart entry starts SpaceUX in the background (a tray icon, no editor).
The first start has no saved menu, so it shows a built-in showcase pie you can
try right away and then edit.

## Opening the pie

Press the **trigger button** on the puck. By default this is **button 0** (the
first/left button); the pie appears at the mouse cursor. You can change which
button opens the pie in the editor (Properties, "Trigger button").

The default ships in **open** trigger mode: the trigger button only _opens_ the
pie. Committing and leaving are done with the navigation gestures below, so the
same button 0 opens the pie when it's closed and fires-or-leaves when it's open,
depending on what you are pointing at. (The other mode, **toggle**, instead
commits the highlighted item on a second press of the trigger.)

## Navigating with "Tilt to aim"

"Tilt to aim" is the default navigation style. The pie opens centred on the
cursor; the **centre is your resting position** (it shows a 👋 = leave). From
there:

- **Highlight an item**: gently push or tilt the puck toward it. "Tilt to aim"
  reads both: slide the cap sideways/forward, _or_ tilt it in that direction. The
  item under your aim lights up. Once one item is highlighted, moving to a
  neighbour needs only a light deflection (it is lighter to move between items
  than to first leave the centre).
- **Open a submenu**: push or tilt **firmly** toward it, past the lighter
  highlight point. It opens (drills in). Ease the puck back toward the centre
  before the next firm aim, so you open one level at a time instead of cascading
  through stacked submenus.
- **Fire an item**: with a leaf highlighted, **press the button** (button 0).
  Its action runs. A _keep-open_ item (the default Sound controls are keep-open)
  fires without closing, so you can repeat it, for example nudge the volume
  several times.
- **Go back / up a level**: **press the puck cap straight down** (a firm press
  down, TZ−). Drilled into a submenu, this pops one level back toward the centre.
- **Leave / cancel**: at the centre (nothing highlighted), **press the button**
  to dismiss, or press the cap down. The centre is bound to cancel ("leave").

You can rebind any of these gestures, or pick a different navigation style, in
the editor (Properties, "Navigation"). Plugins can also contribute navigation
styles.

## The editor

Open the editor from the tray menu (or launch SpaceUX again while it runs). It
has three panes: a **tree** of your menu on the left, a **live preview** of the
pie in the middle that mirrors what the overlay draws, and the **properties** of
the selected item on the right.

- **Nodes**: each item is a node. The centre is the tree root. A node is either
  a **leaf** (fires an action) or a **submenu** (holds child nodes). Give a node
  a label and/or an icon.
- **Actions**: a leaf's action is one of the built-ins: **Key combination**
  (send keys, e.g. `XF86AudioMute` or `alt+Tab`), **Launch program** (run a
  command), **Open file** (open a path), or **Cancel** (dismiss). Plugins can add
  more actions.
- **Keep open**: turn this on for a leaf you want to re-fire without the pie
  closing (volume, brightness, and the like).
- **Icons and labels**: pick an icon and a label for a node. For a **Launch
  program** or **Open file** action the editor auto-fills both from the target:
  enter a command or path (or use **Browse for file…**) and the program's or
  file's icon and name become the node's icon and label. Pointing the item at a
  different program or file replaces them with the new target's icon and name; an
  icon or label you set yourself is kept as long as the target stays the same.
- **Per-device profiles**: save a menu and appearance per SpaceMouse model, so a
  different device automatically loads its own setup when plugged in.

Edits save to `menu.json` under your config directory and hot-reload into the
running pie.

### Action examples

After you pick the action type in the **Action** dropdown, the editor shows the
fields that action needs, one labelled box per option, and you type the value
straight in (no JSON). A plugin action that declares no fields falls back to a
raw-JSON config box instead.

**Launch program** runs a program. Type it in the **Command** box, e.g. `kitty`.

In most cases just the program's **name** works (`kitty`, `blender`, `firefox`),
because these programs live in `/usr/bin`, which is on your `PATH`. That is the
same on Arch and on Ubuntu when the program comes from the distro packages
(`apt`), so a name-only command is portable between the two. You can add
arguments, e.g. `kitty --hold htop`.

For a program that is _not_ on your `PATH` (a downloaded AppImage, or a script in
your home folder), use **Browse for file…**, which fills the box in for you with
the full path. To find a program's path by hand, run `which blender` in a
terminal. On Ubuntu, a **Snap** app uses `snap run blender` and a **Flatpak** app
`flatpak run org.blender.Blender`.

**Send key combination** presses a shortcut. Type it in the **Key combination**
box, e.g. `XF86AudioMute`, with `+` joining a chord.

Other handy values: `alt+Tab` (switch window), `super+d` (show the desktop),
`XF86AudioRaiseVolume` / `XF86AudioLowerVolume` (volume), `XF86MonBrightnessUp` /
`XF86MonBrightnessDown` (brightness). Turn on **keep open** for keys you repeat,
so the pie stays up while you nudge the value instead of closing after the first
press.

**Open file** opens a document or folder with the desktop's default app (via
`xdg-open`). Type the path in the **File** box, e.g. `/home/you/notes.md`, or use
**Browse for file…** to fill it in for you.

**Cancel** takes no config; it simply dismisses the pie.

## Settings

In the editor's **Settings** tab:

- **Interface theme**: the look of the editor window.
- **Pie appearance**: theme (dark / light / SpaceUX), opacity, frosted blur,
  label and icon size, overall pie scale, and the ring/centre balance. These
  apply to the live pie and the preview.
- **Fonts**: the font used for pie labels (bundled, system, or custom) and the
  monospace font for the action-config fields (default or custom).
- **SpaceMouse**: _Grab while pie open_: while the pie is open, hold the
  SpaceMouse so its movement drives only the pie and not the app underneath
  (FreeCAD, Blender, ...). Released when the pie closes; committed actions still
  reach the app. Turn it off if you don't use apps that read the SpaceMouse.
- **Plugins**: import and manage plugins (see below).

## Desktop mode

The editor's **Desktop** tab lets the SpaceMouse drive the desktop while the pie
isn't open: each axis and button gets a function of its own. Desktop mode is
**KDE only** (it uses KWin for the discrete actions).

- **Activation**: _Off_, _Always on_, or _Toggle with a button_. The tray
  checkbox toggles it too, and the tray icon shows the state.
- **Axes**: assign a function to each axis: _Scroll_, _Zoom_, _Volume_, or
  _Switch workspace_; the settings under each axis (speed, invert, thresholds)
  change to match the function you pick. The **Classic preset** maps volume to
  _Slide left / right_, zoom to _Press / lift_, scroll to _Tilt forward / back_,
  and workspace switching to _Twist_; the **Reset to Classic preset** button
  restores it.
- **Buttons**: bind device buttons to one-shot actions: _Overview_, _Show
  desktop_, or any pie action via _Action…_. The pie-trigger button is marked;
  with desktop mode always on, binding it would block the pie.
- **Suspend while pie open**: while the pie is open it owns the puck; desktop
  mode pauses and resumes when the pie closes.

## Plugins

Plugins extend SpaceUX without touching the core: function plugins add actions
and menus, theme plugins restyle the pie, navigation-style plugins package a
gesture model, and application bridges connect the pie to a specific program.
Import a downloaded plugin folder from Settings, Plugins.

## Troubleshooting

- **The pie doesn't open.** Make sure you press the configured trigger button. On
  a fresh setup that is **button 0**; if you previously used a different button,
  it resets to the default until you reconfigure it. Try each button on the puck.
- **The SpaceMouse isn't detected.** Confirm the device is plugged in and that
  you are in the `input` group (`groups | grep input`). If you just installed,
  **log out and back in** so the group membership takes effect.
- **Key-combo actions do nothing.** Key injection needs access to `/dev/uinput`;
  the installer sets up a udev rule and the `input` group for it. After a fresh
  install, re-login (or reboot) and try again.
- **FreeCAD or Blender don't respond to the SpaceMouse.** Those apps use the
  upstream `spacenavd` driver, which SpaceUX does not install by default. Install
  it (see [install.md](install.md), the FreeCAD/Blender step) or run the
  installer with `--with-spacenavd`. SpaceUX and spacenavd coexist: while the pie
  is open SpaceUX holds the device and those apps pause; on close they resume.

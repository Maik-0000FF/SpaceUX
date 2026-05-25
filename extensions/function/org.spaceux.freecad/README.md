<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# SpaceUX FreeCAD plugin

A context-aware SpaceUX pie for FreeCAD: the pie follows the **active
workbench**, showing its toolbars (one branch each) and commands (label +
icon), and runs a command on commit. (#77, Phase D1 — dynamic mode.)

It has two halves that talk over a local UNIX socket
(`$XDG_RUNTIME_DIR/spaceux/freecad.sock`):

- **this plugin** (`manifest.json` + `index.js`), imported into SpaceUX, which
  builds the pie at open time and sends commands to run;
- **the FreeCAD bridge addon** (`freecad/`), which runs inside FreeCAD and
  answers those requests.

## Install

### 1. The FreeCAD bridge addon

Copy the `freecad/` folder of this plugin into FreeCAD's user `Mod/` directory,
renamed to `SpaceUX`.

**Find the right Mod directory** — it is **version-specific**, so don't assume
a fixed path. In FreeCAD's Python console run:

```python
import FreeCAD; print(FreeCAD.getUserAppDataDir())
```

That prints your user data dir, e.g. `~/.local/share/FreeCAD/v1-2/` on
FreeCAD 1.2 (older builds use the unversioned `~/.local/share/FreeCAD/`; a
Flatpak/Snap install differs again). The addon goes in `<that dir>/Mod/SpaceUX`:

```
cp -r freecad/ "<UserAppDataDir>/Mod/SpaceUX"
# e.g. FreeCAD 1.2:
cp -r freecad/ ~/.local/share/FreeCAD/v1-2/Mod/SpaceUX
```

(so you have `…/Mod/SpaceUX/InitGui.py` and `spaceux_bridge.py`). An in-app
installer that resolves this path for you is tracked in #189. Restart FreeCAD.
The Report view should show:

```
SpaceUX bridge listening on /run/user/<uid>/spaceux/freecad.sock
```

The bridge starts automatically on every FreeCAD launch. It runs entirely on
your machine and is only reachable by your user (the socket is `0600`).

### 2. The SpaceUX plugin

In SpaceUX → **Settings → Plugins**, import this plugin's folder, then pick
**FreeCAD** in the active-pie (profile) dropdown.

## Use

Trigger the pie while FreeCAD is open: the active workbench's toolbars appear
as branches; drill into one to see its commands; commit a command to run it.
Switch workbenches in FreeCAD and reopen the pie — it follows the new context.

When FreeCAD is closed (or the addon isn't installed) the pie falls back to a
static placeholder; start FreeCAD and reopen.

### Pie-trigger button (no double-binding)

FreeCAD reads the same SpaceMouse (via spacenavd), so without this the
pie-trigger button would both open the SpaceUX pie **and** fire whatever FreeCAD
bound to it. While a FreeCAD pie is the active SpaceUX source, the bridge clears
FreeCAD's own binding for that button (your trigger button, from the menu's
`triggerButton`) and restores it when you switch the active source away — or
when FreeCAD closes. The original is parked in FreeCAD's parameter store
(`BaseApp/Spaceux/ReservedButtons`), so it survives a crash/restart and is
recoverable from FreeCAD's preferences if anything ever leaves it cleared.

## Notes

- Global `Std_*` commands and toolbar separators are filtered out, so the pie
  shows the workbench's own tools.
- Icons come live from the installed FreeCAD (no bundling), cached per command.
- AppImage FreeCAD works out of the box. Flatpak/Snap sandbox the socket path,
  so the bridge isn't reachable across the sandbox boundary without extra setup.
- Tested API surface: `Gui.activeWorkbench()`, `Workbench.getToolbarItems()`,
  `Gui.Command.get(name).getInfo()`, command-icon via the matching `QAction`,
  and `Gui.runCommand(name)`.

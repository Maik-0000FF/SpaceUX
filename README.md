<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# SpaceUX

[![CI](https://github.com/Maik-0000FF/SpaceUX/actions/workflows/ci.yml/badge.svg)](https://github.com/Maik-0000FF/SpaceUX/actions/workflows/ci.yml)
![status: alpha](https://img.shields.io/badge/status-alpha-yellow)
![license: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![platform: Linux](https://img.shields.io/badge/platform-Linux%20%2F%20Wayland-555)

A radial pie-menu UI for 3Dconnexion SpaceMouse devices on Linux. Push, tilt or
twist the puck to open a menu at the cursor and fire actions, navigate, or drive
your desktop, without reaching for the keyboard.

> **Alpha.** Usable day to day, but expect rough edges and breaking changes.
> It is meant to be tried and shaped by feedback, so please
> [report what you hit](#reporting-issues).

The current screencast shows the FreeCAD plugin (a work in progress):

<video src="https://github.com/user-attachments/assets/9940790f-f1c7-4471-9a02-329c09f6a30f" controls width="100%"></video>

## Contents

- [The idea](#the-idea)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Uninstall](#uninstall)
- [Reporting issues](#reporting-issues)
- [Contributing](#contributing)
- [License](#license)

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

## Requirements

Linux on Wayland with **KDE Plasma 6** and a 3Dconnexion SpaceMouse. KDE is
required: the overlay uses KWin and the wlr-layer-shell protocol, which
**GNOME's Mutter does not support**, so the pie does not appear on GNOME. On
Ubuntu/Debian use a KDE Plasma session (e.g. Kubuntu). The installer is tested on
the **Arch family**; **Ubuntu/Debian (26.04+) is supported in principle but not
yet verified**, so it may need manual fixups (please report what you hit). See
[docs/install.md](docs/install.md#requirements) for details.

Tested with a **3Dconnexion SpaceNavigator** (`046d:c626`) on **EndeavourOS**
(Arch-based), Linux 7.0, **KDE Plasma 6.6 on Wayland**, Qt 6.11.

## Installation

Alpha installs from source with one script:

```sh
git clone https://github.com/Maik-0000FF/SpaceUX.git
cd SpaceUX
./scripts/install.sh
```

It installs the build dependencies, builds everything, sets up the device
permissions, and adds a `spaceux` launcher. Full guide, options, and the optional
FreeCAD/Blender step: **[docs/install.md](docs/install.md)**.

## Usage

Launch **SpaceUX**, then press the trigger button (button 0 by default) to open
the pie at the cursor. Tilt or push the puck to aim, press the button to fire,
press down to go back. The full guide, including the navigation gestures and the
editor, is in **[docs/usage.md](docs/usage.md)**.

## Uninstall

```sh
./scripts/uninstall.sh
```

See **[docs/uninstall.md](docs/uninstall.md)** for what it removes and what it
deliberately keeps.

## Reporting issues

Bug reports and feature requests are very welcome while SpaceUX finds its shape.
Open an [issue](https://github.com/Maik-0000FF/SpaceUX/issues/new/choose) and the
templates will guide you through the useful details.

## Contributing

Development setup and conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0-or-later](LICENSE). Bundled third-party assets and their licenses are
listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

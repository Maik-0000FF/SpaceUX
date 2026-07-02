<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Installing SpaceUX

SpaceUX is alpha software and installs from source with a single script. The script
detects your distribution, installs the build dependencies, builds the daemon,
the native overlay, the editor and the core, sets up the device permissions, and
adds a `spaceux` launcher plus a desktop entry. The checkout stays in place and
the launcher runs from it.

## Requirements

- Linux on **Wayland** with **KDE Plasma 6**. KDE is required, not just the
  tested target: the overlay uses KWin and the wlr-layer-shell protocol, and the
  cursor position comes from a KWin D-Bus script. **GNOME's Mutter supports
  neither**, so the pie does not appear there. On Ubuntu/Debian use a KDE Plasma
  session (e.g. Kubuntu), not the default GNOME.
- A supported distribution: the **Arch family** (pacman), **Ubuntu 26.04+**
  (apt) or **Fedora 41+** (dnf, including Fedora derivatives such as Nobara). The
  package names are verified per distro, and a CI check re-verifies them so a
  renamed or dropped package is caught before release. Older Ubuntu LTS with Qt
  6.4 is not supported.
- A 3Dconnexion SpaceMouse.

Tested with a **3Dconnexion SpaceNavigator** (`046d:c626`) on **EndeavourOS**
(Arch-based), Linux 7.0.11, **KDE Plasma 6.6.5 on Wayland**, Qt 6.11.1. Other
SpaceMouse models and Arch-based distros should work; please report what you run.

## Quick install

```sh
git clone https://github.com/Maik-0000FF/SpaceUX.git
cd SpaceUX
./scripts/install.sh
```

Press **Enter** at **"Install with recommended settings?"**: that installs the
dependencies, builds SpaceUX, sets up device access (udev rules and the `input`
group, via sudo) and installs the launcher. Answer **`n`** for a step-by-step run
that asks about each part instead.

Then log out and back in (so the `input` group membership takes effect), launch
**SpaceUX** from your application menu, and press the trigger button (button 0)
to open the pie.

## What the installer does

1. **Dependencies** (via pacman or apt): the C/CMake toolchain, Node and npm, the
   Qt 6 modules the overlay and editor need (base, declarative, SVG and the SVG
   image plugin for icons) and LayerShellQt, plus the optional libkscreen
   (per-monitor scale), KWindowSystem (frosted blur) and clang. The required
   packages are checked up front; a missing one **aborts** with the list (so a
   broken install is never silent), while a missing optional one is skipped with
   a note. `--check-deps` runs just this verification.
2. **Build**: the daemon, overlay and editor via CMake, then `npm install` and
   the core build.
3. **Device permissions** (via sudo): udev rules so the daemon can use
   `/dev/uinput` for key injection and open the SpaceMouse `hidraw` node for LED
   control, a modules-load entry for the `uinput` module, and adding you to the
   `input` group so the daemon can read the device. The recommended install
   applies these without a further prompt; the step-by-step run asks first, and
   `--skip-perms` opts out (set them up later via
   [Manual permission setup](#manual-permission-setup)). **A re-login is required**
   for the group to apply.
4. **Launcher**: `~/.local/bin/spaceux` (starts the daemon + core and opens the
   editor; the login autostart entry starts it silently) and a desktop entry.

### Options

```sh
./scripts/install.sh --with-spacenavd   # also install spacenavd (see below)
./scripts/install.sh --no-spacenavd     # never prompt about spacenavd
./scripts/install.sh --skip-deps        # don't touch system packages
./scripts/install.sh --skip-perms       # don't touch udev rules / groups
./scripts/install.sh --check-deps       # only verify required packages resolve, then exit
```

## FreeCAD and Blender 3D navigation (optional)

FreeCAD and Blender use the upstream **spacenavd** driver (with **libspnav**) for
their own SpaceMouse 3D navigation. **SpaceUX does not need it** and does not
install it by default; install it only if you use those apps. The installer
offers this as a prompt, or pass `--with-spacenavd`.

On the Arch family, `libspnav` is in the official repos but **spacenavd is in the
AUR**, which `pacman` can't install. The installer uses an AUR helper (`yay` or
`paru`) if you have one, with your confirmation; otherwise it prints the command
(`yay -S spacenavd`) for you to run. On Ubuntu/Debian both are in the repos.

SpaceUX and spacenavd coexist: while the pie is open SpaceUX grabs the device
exclusively (so FreeCAD/Blender pause), and releases it when the pie closes (so
they resume). For that to work, spacenavd must not exclusively grab the device,
so the installer offers to set `grab = 0` in `/etc/spnavrc`.

## Manual permission setup

If you skip the automatic step, set up device access by hand:

```sh
# Let the daemon use /dev/uinput for key injection:
echo 'KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"' |
  sudo tee /etc/udev/rules.d/99-spaceux-uinput.rules
# Let the daemon open the SpaceMouse hidraw node for LED control:
{
  echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="256f", MODE="0660", GROUP="input"'
  echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="046d", ATTRS{idProduct}=="c603|c605|c606|c621|c623|c625|c626|c627|c628|c629|c62b|c62e|c640", MODE="0660", GROUP="input"'
} | sudo tee /etc/udev/rules.d/99-spaceux-hidraw.rules
echo uinput | sudo tee /etc/modules-load.d/spaceux-uinput.conf
sudo modprobe uinput
sudo udevadm control --reload-rules && sudo udevadm trigger
# Let the daemon read the SpaceMouse (re-login afterwards):
sudo usermod -aG input "$USER"
```

## Updating

Pull the latest source and rebuild:

```sh
git pull
./scripts/install.sh --skip-deps --skip-perms
```

## Troubleshooting

See the [usage guide](usage.md#troubleshooting) for device-not-detected,
permissions, and FreeCAD/Blender notes. To remove SpaceUX, see
[uninstall.md](uninstall.md).

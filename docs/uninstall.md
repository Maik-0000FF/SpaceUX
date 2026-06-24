<!--
SPDX-FileCopyrightText: Maik-0000FF
SPDX-License-Identifier: GPL-3.0-or-later
-->

# Uninstalling SpaceUX

Run the uninstaller from the checkout:

```sh
./scripts/uninstall.sh          # remove the launcher, desktop entry, system files
./scripts/uninstall.sh --data   # also remove SpaceUX user data (config, plugins)
```

## What it removes

- **A running SpaceUX is stopped first**: the editor window is closed, then the
  core (the daemon follows it), so no tray icon or background process is left
  behind by the removal.
- The `~/.local/bin/spaceux` launcher, the desktop entry, and the
  launch-on-login autostart entry.
- The udev rule and the uinput modules-load file the installer added (via sudo).
- With `--data`: SpaceUX's own config and plugin data
  (`~/.config/spaceux`, `~/.local/share/spaceux`) and its socket.

## What it deliberately keeps

The uninstaller never removes anything other software might rely on. Remove these
by hand only if you are sure you no longer want them:

- **spacenavd / libspnav** and any other system packages. Even if you installed
  spacenavd through the SpaceUX installer, FreeCAD, Blender and other apps use it,
  so it is left in place.
- Your **`input` group** membership: `gpasswd -d "$USER" input` to drop it.
- The **source checkout**: delete the cloned folder yourself.
- Without `--data`, your SpaceUX **user data** stays, so a reinstall keeps your
  menus. Re-run with `--data` to clear it.

# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
"""
SpaceUX bridge addon — FreeCAD entry point.

FreeCAD runs InitGui.py for every folder under Mod/ at GUI startup (the addon
dir is on sys.path), so installing this folder as `Mod/SpaceUX/` auto-starts
the bridge whenever FreeCAD launches. The real work lives in spaceux_bridge.py;
this only kicks it off and never raises, so a bridge failure can't block
FreeCAD's startup.
"""

import FreeCAD

try:
    import spaceux_bridge

    spaceux_bridge.start()
except Exception as exc:  # noqa: BLE001 — a bridge failure must not abort FreeCAD startup
    FreeCAD.Console.PrintError("SpaceUX bridge failed to start: %s\n" % exc)

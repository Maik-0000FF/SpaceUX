# SPDX-FileCopyrightText: Maik-0000FF
# SPDX-License-Identifier: GPL-3.0-or-later
"""
SpaceUX ↔ FreeCAD bridge.

A tiny UNIX-socket server that lets the SpaceUX pie menu read the active
workbench's commands (label + icon) and run a command by name. Started by
InitGui.py at FreeCAD GUI startup.

The accept loop runs on a background thread, but FreeCAD's GUI is
single-threaded — so every GUI access (active workbench, getToolbarItems,
QActions/icons, runCommand) is marshalled onto the Qt main thread via a queued
signal and awaited. Icons are cached per command name (the command set is
stable per workbench).

Protocol — newline-delimited JSON, one request → one response:
  {"op":"ping"}               -> {"ok":true,"version":1}
  {"op":"context"}            -> {"ok":true,"workbench":"<id>",
                                  "toolbars":[{"name":"<tb>",
                                    "commands":[{"name","label","icon"[,"members"]}]}]}
  {"op":"catalog","loadAll":<bool>}
                              -> {"ok":true,"loadedAll":<bool>,
                                  "workbenches":[{"key","name",
                                    "commands":[{"name","label","icon"[,"members"]}]}]}
  {"op":"run","name":"<cmd>"} -> {"ok":true} | {"ok":false,"error":"<msg>"}
  {"op":"reserve-button","button":<n>}
                              -> {"ok":true,"reserved":<n>,"previous":<...>}
  {"op":"release-button","button":<n>}
                              -> {"ok":true,"released":<n>,"previous":<...>}

`icon` is a `data:image/png;base64,...` string (or "" when none). Global
`Std_*` commands and `Separator` entries are filtered out so the pie shows the
workbench's own tools.

`members` (#208) is present when a toolbar item is a command group (a dropdown
button bundling sub-commands, e.g. Part primitives): it carries the member
`{name,label,icon}` entries, a third level for the pie. Members without an
objectName (selection-filter toggles) are skipped; they run via QAction trigger
since they aren't registered Gui.Commands (see _run).

`reserve-button` / `release-button` (#191) clear / restore FreeCAD's own
Spaceball binding for a button while SpaceUX owns it as the pie trigger — see
_reserve_button. The original command is parked in FreeCAD's parameter store, so
the reservation is idempotent and survives a bridge/FreeCAD restart; an atexit
hook hands every still-held button back when FreeCAD closes.
"""

import atexit
import base64
import json
import os
import socket
import threading

import FreeCAD
import FreeCADGui as Gui

# FreeCAD ships a `PySide` shim mapping to PySide2 or PySide6. QAction lives in
# QtGui on PySide6 and QtWidgets on PySide2 — resolve it from whichever exists.
from PySide import QtCore, QtGui

try:
    QtWidgets = __import__("PySide.QtWidgets", fromlist=["QtWidgets"])
except ImportError:  # PySide6 build without the QtWidgets re-export
    QtWidgets = None
QAction = getattr(QtGui, "QAction", None) or getattr(QtWidgets, "QAction", None)
# QToolButton lives in QtWidgets on both PySide2/6; the toolbar dropdown that
# holds a command group's members hangs off it (#208).
QToolButton = getattr(QtWidgets, "QToolButton", None) or getattr(QtGui, "QToolButton", None)

PROTOCOL_VERSION = 1

# Cap how long a worker thread waits for the GUI main thread to run a marshalled
# call. The SpaceUX side gives up at 1.5s; this frees the worker (instead of
# leaking a blocked daemon thread) if the GUI is wedged, e.g. behind a modal.
GUI_CALL_TIMEOUT_S = 5.0

# Module-level refs keep the server objects alive for the FreeCAD session.
_invoker = None
_server_sock = None
_icon_cache = {}


def socket_path():
    """`$XDG_RUNTIME_DIR/spaceux/freecad.sock`, falling back to /tmp. Must match
    the path the SpaceUX plugin (index.js) connects to."""
    base = os.environ.get("XDG_RUNTIME_DIR") or "/tmp"
    directory = os.path.join(base, "spaceux")
    os.makedirs(directory, exist_ok=True)
    # Lock the directory to the owner. Matters for the /tmp fallback, where
    # makedirs honours a permissive umask and would let other local users
    # traverse to the socket — which can run FreeCAD commands. XDG_RUNTIME_DIR
    # is already 0700, so this is a no-op there.
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    return os.path.join(directory, "freecad.sock")


class _GuiInvoker(QtCore.QObject):
    """Runs a callable on the Qt main thread and returns its result. Created on
    the main thread (InitGui.py); the queued signal marshals the call there from
    the server's worker thread."""

    _invoke = QtCore.Signal(object, object)

    def __init__(self):
        super().__init__()
        self._invoke.connect(self._on_invoke, QtCore.Qt.QueuedConnection)

    def _on_invoke(self, fn, holder):
        try:
            holder["result"] = fn()
        except Exception as exc:  # noqa: BLE001 — relay any GUI error to the client
            holder["error"] = str(exc)
        finally:
            holder["event"].set()

    def call(self, fn):
        holder = {"event": threading.Event()}
        self._invoke.emit(fn, holder)
        # The GUI thread pumps its event loop, so this normally resolves at
        # once. Bound the wait so a wedged GUI (modal dialog, busy op) frees the
        # worker thread instead of leaking it; a late completion afterwards just
        # discards the orphaned holder.
        if not holder["event"].wait(GUI_CALL_TIMEOUT_S):
            raise RuntimeError("GUI thread did not respond within %ss" % GUI_CALL_TIMEOUT_S)
        if "error" in holder:
            raise RuntimeError(holder["error"])
        return holder.get("result")


def _actions_by_name():
    """Map objectName -> QAction for every action under the main window, so a
    command's icon can be resolved by name (the QAction route sidesteps
    resource-path quirks)."""
    out = {}
    mw = Gui.getMainWindow()
    if mw is None or QAction is None:
        return out
    for action in mw.findChildren(QAction):
        name = action.objectName()
        if name and name not in out:
            out[name] = action
    return out


def _icon_data_uri(name, actions):
    """PNG data-URI for a command's icon, or "" — cached per name."""
    if name in _icon_cache:
        return _icon_cache[name]
    uri = ""
    action = actions.get(name)
    if action is not None:
        icon = action.icon()
        if icon is not None and not icon.isNull():
            pixmap = icon.pixmap(32, 32)
            buf = QtCore.QBuffer()
            buf.open(QtCore.QIODevice.WriteOnly)
            if pixmap.save(buf, "PNG"):
                b64 = base64.b64encode(bytes(buf.data())).decode("ascii")
                uri = "data:image/png;base64," + b64
            buf.close()
    _icon_cache[name] = uri
    return uri


def _command_entry(name, actions):
    """One command's {name,label,icon}, or None when the command isn't
    registered yet — i.e. its workbench hasn't been loaded this session."""
    cmd = Gui.Command.get(name)
    if cmd is None:
        return None
    info = cmd.getInfo()
    # menuText carries an accelerator "&" we don't want in a label.
    label = (info.get("menuText") or name).replace("&", "")
    return {"name": name, "label": label, "icon": _icon_data_uri(name, actions)}


def _toolbutton_menus():
    """Map a toolbar command's objectName -> its dropdown QMenu, for command
    groups (#208). FreeCAD bundles a group's sub-commands behind a QToolButton
    with a dropdown menu; getToolbarItems() returns only the group as one name,
    and the members hang off the *button's* menu (not the QAction's). Keyed by
    the button's defaultAction objectName, which equals the toolbar item name."""
    out = {}
    mw = Gui.getMainWindow()
    if mw is None or QToolButton is None:
        return out
    for btn in mw.findChildren(QToolButton):
        action = btn.defaultAction()
        menu = btn.menu()
        if action is not None and menu is not None:
            name = action.objectName()
            if name and name not in out:
                out[name] = menu
    return out


def _group_members(menu, actions):
    """Member entries of a command group's dropdown menu (#208). Each member is
    a child QAction; its objectName is the run target. Members without an
    objectName (e.g. the selection-filter toggles) can't be addressed by name,
    so they're skipped — as are separators and the global Std_* set. Label/icon
    come straight from the child QAction: group members like the PartDesign
    primitives aren't registered Gui.Commands, so _command_entry would drop
    them; the run side triggers their QAction by name instead."""
    members = []
    seen = set()
    for child in menu.actions():
        if child.isSeparator():
            continue
        name = child.objectName()
        if not name or name.startswith("Std_") or name in seen:
            continue
        seen.add(name)
        label = (child.text() or name).replace("&", "")
        members.append({"name": name, "label": label, "icon": _icon_data_uri(name, actions)})
    return members


def _commands_from_items(items, actions, groups):
    """Flatten a workbench's getToolbarItems() into command entries, dropping
    separators, the global Std_* set, and duplicates. A toolbar item that is a
    command group (#208) becomes a nested entry `{name,label,icon,members}` — a
    third pie level; its members come from the dropdown menu in `groups`. A
    plain command yields `{name,label,icon}` (dropped if not yet registered)."""
    commands = []
    seen = set()
    for names in items.values():
        for name in names:
            if name == "Separator" or name.startswith("Std_") or name in seen:
                continue
            seen.add(name)
            menu = groups.get(name)
            members = _group_members(menu, actions) if menu is not None else []
            if members:
                # Group node: label/icon from the group command's own QAction
                # (the group command itself may not be a registered Gui.Command).
                action = actions.get(name)
                label = (action.text().replace("&", "") if action is not None and action.text() else name)
                commands.append(
                    {
                        "name": name,
                        "label": label,
                        "icon": _icon_data_uri(name, actions),
                        "members": members,
                    }
                )
                continue
            entry = _command_entry(name, actions)
            if entry is not None:
                commands.append(entry)
    return commands


def _app_icon():
    """PNG data-URI of FreeCAD's own app icon (the active-plugin badge, #186),
    read live from the running FreeCAD so nothing is bundled/redistributed; ""
    when unavailable. Same pixmap→PNG→base64 path as the command icons."""
    try:
        icon = Gui.getMainWindow().windowIcon()
        if icon is None or icon.isNull():
            return ""
        pixmap = icon.pixmap(64, 64)
        buf = QtCore.QBuffer()
        buf.open(QtCore.QIODevice.WriteOnly)
        ok = pixmap.save(buf, "PNG")
        uri = "data:image/png;base64," + base64.b64encode(bytes(buf.data())).decode("ascii") if ok else ""
        buf.close()
        return uri
    except Exception:  # noqa: BLE001 — no app icon is a benign "no badge"
        return ""


def _workbench_label(wb, key):
    # MenuText is the human-readable workbench name (e.g. "Part Design").
    return getattr(wb, "MenuText", None) or key


def _context():
    wb = Gui.activeWorkbench()
    wb_id = wb.__class__.__name__
    actions = _actions_by_name()
    groups = _toolbutton_menus()
    toolbars = []
    for tb_name, names in wb.getToolbarItems().items():
        commands = _commands_from_items({tb_name: names}, actions, groups)
        if commands:
            toolbars.append({"name": tb_name, "commands": commands})
    return {"ok": True, "workbench": wb_id, "toolbars": toolbars, "appIcon": _app_icon()}


# Workbenches the catalog never activates or lists: Start opens the welcome
# page (intrusive, no pie-useful commands), None is the empty placeholder.
_SKIP_WORKBENCHES = {"StartWorkbench", "NoneWorkbench"}


def _catalog(load_all):
    """Every workbench's commands, for the editor's command palette. Commands
    register only once their workbench has been activated, so by default this
    lists whatever is already loaded. With load_all, briefly activate each
    workbench (then restore the original) to register them all — that is what
    makes the GUI cycle through workbenches, hence only on explicit request.
    StartWorkbench is skipped so the cycle doesn't pop the welcome page."""
    wbs = Gui.listWorkbenches()
    if load_all:
        active = Gui.activeWorkbench()
        original = next((k for k, v in wbs.items() if v is active), None)
        for key in list(wbs.keys()):
            if key in _SKIP_WORKBENCHES:
                continue
            try:
                Gui.activateWorkbench(key)
            except Exception:  # noqa: BLE001 — skip a workbench that won't load
                pass
        if original is not None:
            try:
                Gui.activateWorkbench(original)
            except Exception:  # noqa: BLE001
                pass
    actions = _actions_by_name()
    # Command-group dropdowns (#208) exist only for the currently-shown toolbars
    # (the active workbench), so groups expand in the catalog for the active WB;
    # seeding a non-active WB lists such groups as single entries. The dynamic
    # pie (_context, always the active WB) always expands them.
    groups = _toolbutton_menus()
    workbenches = []
    for key, wb in wbs.items():
        if key in _SKIP_WORKBENCHES:
            continue
        try:
            items = wb.getToolbarItems()
        except Exception:  # noqa: BLE001 — a workbench that can't enumerate is skipped
            items = {}
        # Group by toolbar (like _context) so a curated pie can seed one submenu
        # per toolbar, mirroring the dynamic pie's structure.
        toolbars = []
        for tb_name, names in items.items():
            commands = _commands_from_items({tb_name: names}, actions, groups)
            if commands:
                toolbars.append({"name": tb_name, "commands": commands})
        if toolbars:
            workbenches.append({"key": key, "name": _workbench_label(wb, key), "toolbars": toolbars})
    return {
        "ok": True,
        "loadedAll": bool(load_all),
        "workbenches": workbenches,
        "appIcon": _app_icon(),
    }


def _run(name):
    # A registered command runs the canonical way. Command-group members (#208,
    # e.g. PartDesign_AdditiveBox) are NOT registered Gui.Commands — listCommands
    # / Command.get don't know them — but their QAction is reachable by
    # objectName, and triggering it does exactly what clicking the dropdown does.
    if Gui.Command.get(name) is not None:
        Gui.runCommand(name)
        return {"ok": True}
    action = _actions_by_name().get(name)
    if action is not None:
        action.trigger()
        return {"ok": True}
    return {"ok": False, "error": "unknown command: %r" % (name,)}


# FreeCAD stores Spaceball button → command bindings here, one subgroup per
# button index ("0", "1", ...) with a "Command" string. SpaceUX parks the
# original it cleared in its own group so a reservation is recoverable even if
# release never arrives (SpaceUX crash) — the saved command lives in FreeCAD's
# config, not just bridge memory.
_BUTTONS_PARAM = "User parameter:BaseApp/Spaceball/Buttons"
_RESERVED_PARAM = "User parameter:BaseApp/Spaceux/ReservedButtons"


def _dump_buttons():
    """All currently-configured Spaceball button → command bindings, as a dict
    {button_key: command}. Used for the diagnostic log (and to surface FreeCAD's
    own button numbering, which need not match SpaceUX's evdev index)."""
    buttons = FreeCAD.ParamGet(_BUTTONS_PARAM)
    out = {}
    for key in buttons.GetGroups():
        cmd = buttons.GetGroup(key).GetString("Command", "")
        if cmd:
            out[key] = cmd
    return out


def _reserve_button(n):
    """Clear FreeCAD's binding for spaceball button `n` while SpaceUX uses it as
    the pie trigger, saving the original command so release (or a later session)
    restores it. Idempotent: re-reserving an already-reserved button preserves
    the saved original instead of overwriting it with our cleared value. A button
    FreeCAD never had a command on is recorded as reserved but its (absent) group
    is left untouched."""
    key = str(int(n))
    buttons = FreeCAD.ParamGet(_BUTTONS_PARAM)
    reserved = FreeCAD.ParamGet(_RESERVED_PARAM)
    if reserved.HasGroup(key):
        # Already reserved — idempotent no-op (the host polls this; stay quiet).
        saved = reserved.GetGroup(key).GetString("OriginalCommand", "")
        return {"ok": True, "reserved": int(n), "previous": _binding(saved)}
    original = buttons.GetGroup(key).GetString("Command", "") if buttons.HasGroup(key) else ""
    reserved.GetGroup(key).SetString("OriginalCommand", original)
    if original:  # only touch FreeCAD's config when there was a binding to clear
        buttons.GetGroup(key).SetString("Command", "")
    # Log only on the real first reserve (#191): FreeCAD's button numbering need
    # not match SpaceUX's evdev index, so show what we cleared + the binding table
    # so the Report view confirms we cleared the button that actually fires.
    FreeCAD.Console.PrintMessage(
        "SpaceUX: reserved spaceball button %s (was: %s); bindings now: %s\n"
        % (key, original or "unbound", _dump_buttons())
    )
    return {"ok": True, "reserved": int(n), "previous": _binding(original)}


def _release_button(n):
    """Restore FreeCAD's original binding for button `n` (if SpaceUX reserved it)
    and drop the saved record. A no-op when nothing was reserved.

    Edge: if the user re-binds this button inside FreeCAD *while it's reserved*
    (its Command shows empty in the dialog), release writes the saved original
    back over that new binding. Unlikely — the button does nothing while reserved,
    so there's little reason to rebind it — and accepted as-is."""
    key = str(int(n))
    reserved = FreeCAD.ParamGet(_RESERVED_PARAM)
    if not reserved.HasGroup(key):
        return {"ok": True, "released": int(n), "previous": None}
    original = reserved.GetGroup(key).GetString("OriginalCommand", "")
    if original:
        FreeCAD.ParamGet(_BUTTONS_PARAM).GetGroup(key).SetString("Command", original)
    reserved.RemGroup(key)
    return {"ok": True, "released": int(n), "previous": _binding(original)}


def _binding(command):
    """A reserved button's prior binding for the JSON reply (None = was unbound),
    for SpaceUX-side logging only."""
    return {"command": command} if command else None


def _restore_all_reservations():
    """Hand every still-held button back to FreeCAD. Registered with atexit so
    closing FreeCAD restores the user's Spaceball config even when SpaceUX never
    sent release (still running, or crashed). Best-effort — runs on interpreter
    shutdown, after the Qt loop is likely gone, so no marshalling and no raising."""
    try:
        reserved = FreeCAD.ParamGet(_RESERVED_PARAM)
        for key in list(reserved.GetGroups()):
            original = reserved.GetGroup(key).GetString("OriginalCommand", "")
            if original:
                FreeCAD.ParamGet(_BUTTONS_PARAM).GetGroup(key).SetString("Command", original)
            reserved.RemGroup(key)
    except Exception:  # noqa: BLE001 — never raise out of an atexit hook
        pass


def _dispatch(req):
    op = req.get("op")
    if op == "ping":
        return {"ok": True, "version": PROTOCOL_VERSION}
    if op == "context":
        return _invoker.call(_context)
    if op == "catalog":
        load_all = bool(req.get("loadAll"))
        return _invoker.call(lambda: _catalog(load_all))
    if op == "run":
        name = req.get("name")
        if not isinstance(name, str) or not name:
            return {"ok": False, "error": "run requires a non-empty string 'name'"}
        return _invoker.call(lambda: _run(name))
    if op in ("reserve-button", "release-button"):
        n = req.get("button")
        if not isinstance(n, int) or isinstance(n, bool) or n < 0:
            return {"ok": False, "error": "%s requires a non-negative integer 'button'" % op}
        fn = _reserve_button if op == "reserve-button" else _release_button
        return _invoker.call(lambda: fn(n))
    return {"ok": False, "error": "unknown op: %r" % (op,)}


def _handle(conn):
    with conn:
        data = b""
        while b"\n" not in data:
            chunk = conn.recv(4096)
            if not chunk:
                return
            data += chunk
        line = data.split(b"\n", 1)[0]
        try:
            resp = _dispatch(json.loads(line.decode("utf-8")))
        except Exception as exc:  # noqa: BLE001 — never crash the loop on bad input
            resp = {"ok": False, "error": str(exc)}
        try:
            conn.sendall((json.dumps(resp) + "\n").encode("utf-8"))
        except OSError:
            pass


def _serve(sock):
    while True:
        try:
            conn, _ = sock.accept()
        except OSError:
            return  # socket closed on shutdown
        threading.Thread(target=_handle, args=(conn,), daemon=True).start()


def start():
    """Bind the socket and start the accept loop. Called once on GUI startup."""
    global _invoker, _server_sock
    if _server_sock is not None:
        return  # already running in this session
    path = socket_path()
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.bind(path)
    except OSError as exc:
        # Another FreeCAD instance already owns the socket — leave it be.
        FreeCAD.Console.PrintWarning("SpaceUX bridge: cannot bind %s: %s\n" % (path, exc))
        sock.close()
        return
    os.chmod(path, 0o600)
    sock.listen(8)
    _server_sock = sock
    _invoker = _GuiInvoker()  # created here, on the GUI main thread
    # Restore any button SpaceUX reserved if FreeCAD closes while it still holds
    # one (#191) — so a FreeCAD-only session keeps the user's own binding.
    atexit.register(_restore_all_reservations)
    threading.Thread(target=_serve, args=(sock,), daemon=True).start()
    FreeCAD.Console.PrintMessage("SpaceUX bridge listening on %s\n" % path)

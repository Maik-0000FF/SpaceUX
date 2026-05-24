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
                                    "commands":[{"name","label","icon"}]}]}
  {"op":"catalog","loadAll":<bool>}
                              -> {"ok":true,"loadedAll":<bool>,
                                  "workbenches":[{"key","name",
                                    "commands":[{"name","label","icon"}]}]}
  {"op":"run","name":"<cmd>"} -> {"ok":true} | {"ok":false,"error":"<msg>"}

`icon` is a `data:image/png;base64,...` string (or "" when none). Global
`Std_*` commands and `Separator` entries are filtered out so the pie shows the
workbench's own tools.
"""

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


def _commands_from_items(items, actions):
    """Flatten a workbench's getToolbarItems() into command entries, dropping
    separators, the global Std_* set, duplicates, and not-yet-registered ones."""
    commands = []
    seen = set()
    for names in items.values():
        for name in names:
            if name == "Separator" or name.startswith("Std_") or name in seen:
                continue
            seen.add(name)
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
    toolbars = []
    for tb_name, names in wb.getToolbarItems().items():
        commands = _commands_from_items({tb_name: names}, actions)
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
            commands = _commands_from_items({tb_name: names}, actions)
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
    Gui.runCommand(name)
    return {"ok": True}


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
    threading.Thread(target=_serve, args=(sock,), daemon=True).start()
    FreeCAD.Console.PrintMessage("SpaceUX bridge listening on %s\n" % path)

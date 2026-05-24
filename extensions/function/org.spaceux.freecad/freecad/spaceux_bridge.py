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
        # The GUI thread always pumps its event loop, so this resolves quickly;
        # the SpaceUX side caps the whole request with its own timeout.
        holder["event"].wait()
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
    cmd = Gui.Command.get(name)
    label = name
    if cmd is not None:
        info = cmd.getInfo()
        # menuText carries an accelerator "&" we don't want in a pie label.
        label = (info.get("menuText") or name).replace("&", "")
    return {"name": name, "label": label, "icon": _icon_data_uri(name, actions)}


def _context():
    wb = Gui.activeWorkbench()
    wb_id = wb.__class__.__name__
    actions = _actions_by_name()
    toolbars = []
    for tb_name, names in wb.getToolbarItems().items():
        commands = []
        for name in names:
            # Drop visual separators and the global Std_* set — the pie shows
            # the workbench's own tools, grouped by toolbar.
            if name == "Separator" or name.startswith("Std_"):
                continue
            commands.append(_command_entry(name, actions))
        if commands:
            toolbars.append({"name": tb_name, "commands": commands})
    return {"ok": True, "workbench": wb_id, "toolbars": toolbars}


def _run(name):
    Gui.runCommand(name)
    return {"ok": True}


def _dispatch(req):
    op = req.get("op")
    if op == "ping":
        return {"ok": True, "version": PROTOCOL_VERSION}
    if op == "context":
        return _invoker.call(_context)
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

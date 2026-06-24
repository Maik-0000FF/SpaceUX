// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include <QObject>

class QQuickWindow;

/**
 * One editor per session (#457 D7): the running editor owns
 * `org.spaceux.Editor` on the session bus and exports a Raise method; a second
 * launch finds the name taken, asks the owner to surface its window and exits.
 * The same bus-name pattern the core uses for its own single instance
 * (org.spaceux.Core), one level up the stack.
 */
class SingleInstance : public QObject {
    Q_OBJECT

public:
    explicit SingleInstance(QObject *parent = nullptr);

    // Claim the editor's bus name. On success the object is exported (with its
    // Raise slot) and the editor starts up; on failure another editor owns the
    // name, so it is asked to Raise and the caller exits. A session without a
    // reachable bus logs and starts WITHOUT the single-instance guard: a
    // broken bus must degrade the guard, not silently kill the editor.
    bool claimOrRaise();

    // The window Raise surfaces; attached once the QML root exists. Replays a
    // Raise that arrived in the gap before the root was loaded.
    void attachWindow(QQuickWindow *window);

public slots:
    // D-Bus entry: surface the running editor's window. On Wayland the
    // compositor arbitrates focus stealing, so this may flash the taskbar
    // entry instead of focusing; that is the platform's call, not ours.
    // Q_SCRIPTABLE + ExportScriptableSlots keep the bus surface to exactly
    // these slots (ExportAllSlots would also export the inherited QObject
    // ones).
    Q_SCRIPTABLE void Raise();

    // D-Bus entry: close the editor (the tray's app-level Quit). Closes the
    // window through the normal path so the close-time work (the window-size
    // flush) still runs; only a pre-root call falls back to a bare quit.
    Q_SCRIPTABLE void Quit();

private:
    QQuickWindow *window_ = nullptr;
    // A Raise that arrived before attachWindow (two editors racing startup);
    // replayed once the window exists.
    bool pendingRaise_ = false;
};

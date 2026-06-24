// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef SPACEUX_EDITOR_NATIVE_DIALOGS_H
#define SPACEUX_EDITOR_NATIVE_DIALOGS_H

#include <QObject>
#include <QString>
#include <QStringList>
#include <qqmlregistration.h>

// Global native file/folder pickers for the editor (#457). Exposed to QML as the
// singleton `NativeDialogs` (import SpaceUX.Editor) so EVERY action that needs a
// browser (the icon pick now; the plugin folder + exec/open-file target later)
// opens the SAME dialog. Uses Qt's QFileDialog, which routes through the platform
// integration and, on Wayland, xdg-desktop-portal, so it is the RUNNING desktop's
// own file chooser (KDE, GNOME, wlroots/Hyprland, ...), never tied to one DE.
// Returns a local filesystem path, or an empty string when cancelled.
class NativeDialogs : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit NativeDialogs(QObject *parent = nullptr);

    // Pick a single existing file. `nameFilters` are Qt filter strings
    // (e.g. "Images (*.png *.svg)"); empty offers all files.
    Q_INVOKABLE QString openFile(const QString &title,
                                 const QStringList &nameFilters = {}) const;
    // Pick an existing directory (e.g. a plugin folder).
    Q_INVOKABLE QString openFolder(const QString &title) const;
};

#endif // SPACEUX_EDITOR_NATIVE_DIALOGS_H

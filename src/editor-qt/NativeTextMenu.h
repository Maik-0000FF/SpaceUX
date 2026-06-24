// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef SPACEUX_EDITOR_NATIVE_TEXT_MENU_H
#define SPACEUX_EDITOR_NATIVE_TEXT_MENU_H

#include <QObject>
#include <QString>
#include <qqmlregistration.h>

// Native right-click context menu for the editor's text fields. Exposed to QML
// as the singleton `NativeTextMenu` (import SpaceUX.Editor), mirroring
// NativeDialogs. A Qt Widgets QMenu is drawn by the platform's widget style
// (Breeze on KDE, the platform theme elsewhere) with the system icon theme, so
// it looks and behaves exactly like the cut/copy/paste menu of every other
// Qt/KDE app and follows the user's System Settings (Application Style, Colors,
// Icons) automatically, never a bespoke app-styled menu.
//
// The menu only reports the chosen action; the caller (QML) performs the edit
// on the focused TextInput through its built-in cut()/copy()/paste()/
// selectAll(), so there is no duplicated clipboard handling.
class NativeTextMenu : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit NativeTextMenu(QObject *parent = nullptr);

    // Pop up the native text-edit context menu at the given GLOBAL screen
    // position (so it lands at the click point, also under Wayland). Carries the
    // full set of standard entries (Undo, Redo, Cut, Copy, Paste, Delete, Select
    // All), matching QLineEdit/QTextEdit. The flags drive the entries' enabled
    // state: undo/redo from canUndo/canRedo; cut/copy/delete need a selection;
    // undo/redo/cut/paste/delete need a writable field; paste also needs
    // non-empty clipboard text (checked here); select-all needs some text.
    // Blocks until dismissed; returns the chosen action id ("undo" | "redo" |
    // "cut" | "copy" | "paste" | "delete" | "selectAll"), or "" when nothing was
    // picked.
    Q_INVOKABLE QString popup(qreal globalX, qreal globalY, bool hasSelection,
                              bool readOnly, bool hasText, bool canUndo,
                              bool canRedo) const;
};

#endif // SPACEUX_EDITOR_NATIVE_TEXT_MENU_H

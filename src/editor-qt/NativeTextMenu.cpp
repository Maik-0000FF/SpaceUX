// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#include "NativeTextMenu.h"

#include <QAction>
#include <QClipboard>
#include <QCoreApplication>
#include <QGuiApplication>
#include <QIcon>
#include <QKeySequence>
#include <QMenu>
#include <QPoint>
#include <QWindow>

NativeTextMenu::NativeTextMenu(QObject *parent) : QObject(parent) {}

QString NativeTextMenu::popup(qreal globalX, qreal globalY, bool hasSelection,
                              bool readOnly, bool hasText, bool canUndo,
                              bool canRedo) const {
    const bool writable = !readOnly;
    const bool clipboardHasText =
        !QGuiApplication::clipboard()->text().isEmpty();

    QMenu menu;

    // Reuse Qt's own translated strings for the standard edit actions (the
    // "QWidgetTextControl" context, the same one QLineEdit/QTextEdit use), so
    // the entries appear in the desktop's language wherever Qt ships a
    // translation (qtbase_<locale> is loaded in main()). "&" marks the
    // mnemonic; the icons come from the system icon theme.
    const auto label = [](const char *source) {
        return QCoreApplication::translate("QWidgetTextControl", source);
    };

    QAction *undo = menu.addAction(
        QIcon::fromTheme(QStringLiteral("edit-undo")), label("&Undo"));
    undo->setShortcut(QKeySequence::Undo);
    undo->setEnabled(canUndo && writable);

    QAction *redo = menu.addAction(
        QIcon::fromTheme(QStringLiteral("edit-redo")), label("&Redo"));
    redo->setShortcut(QKeySequence::Redo);
    redo->setEnabled(canRedo && writable);

    menu.addSeparator();

    QAction *cut = menu.addAction(QIcon::fromTheme(QStringLiteral("edit-cut")),
                                  label("Cu&t"));
    cut->setShortcut(QKeySequence::Cut);
    cut->setEnabled(hasSelection && writable);

    QAction *copy = menu.addAction(
        QIcon::fromTheme(QStringLiteral("edit-copy")), label("&Copy"));
    copy->setShortcut(QKeySequence::Copy);
    copy->setEnabled(hasSelection);

    QAction *paste = menu.addAction(
        QIcon::fromTheme(QStringLiteral("edit-paste")), label("&Paste"));
    paste->setShortcut(QKeySequence::Paste);
    paste->setEnabled(writable && clipboardHasText);

    QAction *del = menu.addAction(
        QIcon::fromTheme(QStringLiteral("edit-delete")), label("Delete"));
    del->setShortcut(QKeySequence::Delete);
    del->setEnabled(hasSelection && writable);

    menu.addSeparator();

    QAction *selectAll =
        menu.addAction(QIcon::fromTheme(QStringLiteral("edit-select-all")),
                       label("Select All"));
    selectAll->setShortcut(QKeySequence::SelectAll);
    selectAll->setEnabled(hasText);

    // Anchor the popup to the editor's active window so the Wayland compositor
    // places it relative to that surface; a parentless popup can mis-position.
    // winId() forces the backing QWindow to exist so windowHandle() is set.
    menu.winId();
    if (QWindow *handle = menu.windowHandle()) {
        if (QWindow *active = QGuiApplication::focusWindow())
            handle->setTransientParent(active);
    }

    const QAction *chosen = menu.exec(QPoint(qRound(globalX), qRound(globalY)));
    if (chosen == undo)
        return QStringLiteral("undo");
    if (chosen == redo)
        return QStringLiteral("redo");
    if (chosen == cut)
        return QStringLiteral("cut");
    if (chosen == copy)
        return QStringLiteral("copy");
    if (chosen == paste)
        return QStringLiteral("paste");
    if (chosen == del)
        return QStringLiteral("delete");
    if (chosen == selectAll)
        return QStringLiteral("selectAll");
    return QString();
}

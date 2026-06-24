// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#include "NativeDialogs.h"

#include <QFileDialog>

NativeDialogs::NativeDialogs(QObject *parent) : QObject(parent) {}

QString NativeDialogs::openFile(const QString &title,
                                const QStringList &nameFilters) const {
    // The static helper uses the platform's native dialog by default (no
    // DontUseNativeDialog), so Qt hands off to the desktop's own chooser; the
    // filters are one ";;"-joined string. No parent: a top-level modal dialog.
    return QFileDialog::getOpenFileName(nullptr, title, QString(),
                                        nameFilters.join(QStringLiteral(";;")));
}

QString NativeDialogs::openFolder(const QString &title) const {
    return QFileDialog::getExistingDirectory(nullptr, title);
}

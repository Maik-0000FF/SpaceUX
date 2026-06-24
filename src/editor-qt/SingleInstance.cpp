// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#include "SingleInstance.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusInterface>
#include <QLatin1StringView>
#include <QQuickWindow>

namespace {
// The editor's own bus identity: serializes editor launches against each
// other (Raise) and receives the tray's app-level Quit. Mirrors
// EDITOR_SERVICE / EDITOR_OBJECT_PATH / EDITOR_INTERFACE in
// src/shared/core-contract.ts, which the core uses to reach this object.
// constexpr views (not QString globals): a static QString's constructor
// could throw during static initialization, where nothing can catch it.
constexpr QLatin1StringView kService("org.spaceux.Editor");
constexpr QLatin1StringView kPath("/org/spaceux/Editor");
constexpr QLatin1StringView kInterface("org.spaceux.Editor1");
} // namespace

SingleInstance::SingleInstance(QObject *parent) : QObject(parent) {}

bool SingleInstance::claimOrRaise() {
    QDBusConnection bus = QDBusConnection::sessionBus();
    // No session bus at all (not "name taken"): the guard can't work, but the
    // editor must still start and say why, not exit silently with code 0.
    if (!bus.isConnected()) {
        qWarning("spaceux-editor: session bus unreachable; running without "
                 "the single-instance guard");
        return true;
    }
    if (bus.registerService(kService)) {
        bus.registerObject(kPath, kInterface, this,
                           QDBusConnection::ExportScriptableSlots);
        return true;
    }
    // Another editor owns the name: hand the launch over to it. A blocking
    // call is fine here, this process only exits afterwards.
    QDBusInterface owner(kService, kPath, kInterface, bus);
    owner.call(QStringLiteral("Raise"));
    return false;
}

void SingleInstance::attachWindow(QQuickWindow *window) {
    window_ = window;
    // A second launch may have called Raise in the gap between the claim and
    // the QML root existing; surface the window now instead of dropping it.
    if (pendingRaise_) {
        pendingRaise_ = false;
        Raise();
    }
}

void SingleInstance::Raise() {
    if (window_ == nullptr) {
        pendingRaise_ = true;
        return;
    }
    // show() covers a minimized window, raise() the stacking order, and
    // requestActivate() asks for focus (subject to the compositor's
    // focus-stealing rules).
    window_->show();
    window_->raise();
    window_->requestActivate();
}

void SingleInstance::Quit() {
    // close() runs the window's regular close path (Main.qml flushes the
    // remembered size there); the app then exits with its last window. Only
    // when no root exists yet is there nothing to flush, so quit directly.
    if (window_ != nullptr)
        window_->close();
    else
        QCoreApplication::quit();
}

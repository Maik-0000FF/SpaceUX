// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#include "EditorClient.h"

#include <QDBusConnection>
#include <QDBusError>
#include <QDBusInterface>
#include <QDBusPendingCall>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDBusServiceWatcher>
#include <QJSValue>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLatin1StringView>

namespace {
// Wire addressing: mirrors src/shared/core-contract.ts
// (CORE_SERVICE / CORE_OBJECT_PATH / CORE_INTERFACE).
// constexpr views (not QString globals): a static QString's constructor
// could throw during static initialization, where nothing can catch it.
constexpr QLatin1StringView kService("org.spaceux.Core");
constexpr QLatin1StringView kPath("/org/spaceux/Core");
constexpr QLatin1StringView kInterface("org.spaceux.Core1");

// Reply budget for the blocking callSync (the window-close flush): a tiny
// Set* on a healthy core answers in milliseconds, and a hung core must not
// pin the closing window for the 25s D-Bus default (a dead core fails fast
// either way; the bus daemon answers for it).
constexpr int kSyncCallTimeoutMs = 2000;

// One JSON-RPC wire encoding for both call paths: the logical argument list
// as a compact JSON array string.
QString encodeArgs(const QVariantList &args) {
    const QJsonArray array = QJsonArray::fromVariantList(args);
    return QString::fromUtf8(
        QJsonDocument(array).toJson(QJsonDocument::Compact));
}
} // namespace

EditorClient::EditorClient(QObject *parent) : QObject(parent) {
    QDBusConnection bus = QDBusConnection::sessionBus();
    iface_ = new QDBusInterface(kService, kPath, kInterface, bus, this);
    connected_ = iface_->isValid();
    if (!connected_) {
        qWarning("spaceux-editor: org.spaceux.Core is not reachable; "
                 "is the headless core running?");
    }
    // Track the core's bus ownership so `connected` reflects a core that starts
    // after the editor, or restarts / dies, rather than being a one-shot check.
    auto *watcher = new QDBusServiceWatcher(
        kService, bus, QDBusServiceWatcher::WatchForOwnerChange, this);
    connect(watcher, &QDBusServiceWatcher::serviceRegistered, this,
            [this] { setConnected(true); });
    connect(watcher, &QDBusServiceWatcher::serviceUnregistered, this,
            [this] { setConnected(false); });

    // Empty member name => every signal on the interface lands in one handler,
    // which reads the name + payload off the message.
    if (!bus.connect(kService, kPath, kInterface, QString(), this,
                     SLOT(onCoreSignal(QDBusMessage)))) {
        qWarning("spaceux-editor: failed to subscribe to core push signals");
    }
}

void EditorClient::setConnected(bool connected) {
    if (connected_ == connected)
        return;
    connected_ = connected;
    emit connectedChanged();
}

void EditorClient::callAsync(const QString &method, const QVariantList &args,
                             const QJSValue &callback) {
    const QDBusPendingCall pending =
        iface_->asyncCall(method, encodeArgs(args));
    auto *watcher = new QDBusPendingCallWatcher(pending, this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this,
            [method, callback](QDBusPendingCallWatcher *call) mutable {
                const QDBusPendingReply<QString> reply = *call;
                call->deleteLater();
                if (reply.isError()) {
                    qWarning("spaceux-editor: call %s failed: %s",
                             qUtf8Printable(method),
                             qUtf8Printable(reply.error().message()));
                    return;
                }
                if (callback.isCallable())
                    callback.call(QJSValueList{QJSValue(reply.value())});
            });
}

void EditorClient::callSync(const QString &method, const QVariantList &args) {
    // The short timeout only belongs to this blocking path; restore the
    // interface's default afterwards so the async calls keep theirs.
    const int previousTimeout = iface_->timeout();
    iface_->setTimeout(kSyncCallTimeoutMs);
    const QDBusMessage reply = iface_->call(method, encodeArgs(args));
    iface_->setTimeout(previousTimeout);
    if (reply.type() == QDBusMessage::ErrorMessage) {
        qWarning("spaceux-editor: sync call %s failed: %s",
                 qUtf8Printable(method), qUtf8Printable(reply.errorMessage()));
    }
}

void EditorClient::onCoreSignal(const QDBusMessage &message) {
    const QString name = message.member();
    const QString payload = message.arguments().isEmpty()
                                ? QString()
                                : message.arguments().constFirst().toString();
    emit coreSignal(name, payload);
}

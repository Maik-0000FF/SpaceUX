// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef SPACEUX_EDITOR_CLIENT_H
#define SPACEUX_EDITOR_CLIENT_H

#include <QDBusMessage>
#include <QJSValue>
#include <QObject>
#include <QString>
#include <QVariantList>
#include <qqmlregistration.h>

class QDBusInterface;

// The editor's single D-Bus surface: a CLIENT of org.spaceux.Core1 (the headless
// core, #457 Phase B), the inverse of src/overlay, which is a service. It wraps
// the uniform JSON-RPC wire (every method takes one "args" JSON-array string and
// returns one "result" JSON string) behind call(), and re-emits the core's push
// signals as coreSignal(name, payloadJson). Nothing else in the editor
// touches D-Bus.
class EditorClient : public QObject {
    Q_OBJECT
    // Exposed to QML as the singleton `EditorClient` (import SpaceUX.Editor).
    QML_ELEMENT
    QML_SINGLETON

    // Whether org.spaceux.Core is reachable on the session bus.
    Q_PROPERTY(bool connected READ connected NOTIFY connectedChanged)

public:
    explicit EditorClient(QObject *parent = nullptr);

    bool connected() const { return connected_; }

    // Call a core method by name, asynchronously so a slow method (BuildScene,
    // ImportPlugin, a loadAll catalog) never blocks the GUI thread. `args` is the
    // logical argument list (QML passes a JS array), JSON-encoded into the single
    // "args" string the wire expects. `callback`, if callable, receives the
    // result JSON string (QML JSON.parses it); omit it for a fire-and-forget Set*.
    Q_INVOKABLE void callAsync(const QString &method,
                               const QVariantList &args = {},
                               const QJSValue &callback = QJSValue());

    // Blocking variant for the window-close flush ONLY: a final Set* fired
    // while the window closes must reach the core before the process exits,
    // which a queued async call can't guarantee. Blocks the GUI thread on the
    // reply, so it must never carry a slow method or run on the hot path.
    Q_INVOKABLE void callSync(const QString &method,
                              const QVariantList &args = {});

signals:
    void connectedChanged();
    // A core push signal arrived; `payloadJson` is its JSON string (empty for the
    // payloadless ActionsChanged).
    void coreSignal(const QString &name, const QString &payloadJson);

private slots:
    // One handler for every signal on the interface (connected with an empty
    // member name); the message carries the signal name + its optional payload.
    void onCoreSignal(const QDBusMessage &message);

private:
    // Update connected_ and emit connectedChanged when it changes; driven by the
    // QDBusServiceWatcher as the core's bus ownership comes and goes.
    void setConnected(bool connected);

    QDBusInterface *iface_ = nullptr;
    bool connected_ = false;
};

#endif // SPACEUX_EDITOR_CLIENT_H

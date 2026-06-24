// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later
//
// spaceux-overlay (#296): a Qt6/QML window promoted to a Wayland
// layer-shell surface, controlled over the session bus by the SpaceUX
// core process (org.spaceux.Overlay1).

#include <QDBusConnection>
#include <QFontDatabase>
#include <QGuiApplication>
#include <QQmlEngine>
#include <QQuickView>
#include <QSurfaceFormat>
#include <QUrl>

#include <LayerShellQt/Window>

#ifdef __linux__
#include <csignal>
#include <cstdlib>
#include <sys/prctl.h>
#include <unistd.h>
#endif

#include "OverlayController.h"

int main(int argc, char *argv[]) {
#ifdef __linux__
    // Die with the spawning app, but only when it opts in via
    // SPACEUX_OVERLAY_DIE_WITH_PARENT (set by OverlayClient when SpaceUX
    // spawns us). Without this a spawned daemon is reparented to init on app
    // quit/crash and its surface lingers on screen; PR_SET_PDEATHSIG delivers
    // SIGTERM when the parent dies, and the getppid() check closes the race
    // where the parent died before we asked. A standalone / manual launch (the
    // dev demo, a shell) omits the env and keeps running until quit explicitly.
    if (std::getenv("SPACEUX_OVERLAY_DIE_WITH_PARENT") != nullptr) {
        prctl(PR_SET_PDEATHSIG, SIGTERM);
        if (getppid() == 1)
            return 0;
    }
#endif

    // Honour fractional monitor scales (e.g. 145%) exactly instead of rounding
    // them to an integer: the pie then renders at the live per-output scale the
    // compositor reports rather than snapping to 100% / 200%. Reads the real
    // scale from the compositor (nothing is hardcoded). Must be set before the
    // QGuiApplication is constructed.
    QGuiApplication::setHighDpiScaleFactorRoundingPolicy(
        Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);

    // Since Qt 6.5 the wlr-layer-shell role is selected automatically as
    // soon as LayerShellQt::Window::get() is called before the window is
    // shown (the old Shell::useLayerShell() is deprecated and not needed).
    // If a future Qt regresses, set QT_WAYLAND_SHELL_INTEGRATION=layer-shell.
    QGuiApplication app(argc, argv);

    // Register the bundled Inter-SemiBold face (see CMakeLists) so the pie
    // labels render in the bundled face instead of the system
    // sans-serif. buildOverlayTheme requests it by its family name
    // ("Inter SemiBold"). A failure is non-fatal (the QML falls back to
    // sans-serif), so warn and carry on rather than aborting the daemon.
    if (QFontDatabase::addApplicationFont(
            QStringLiteral(":/fonts/Inter-SemiBold.ttf")) < 0)
        qWarning("spaceux-overlay: failed to load the bundled Inter font");

    // Per-pixel alpha so the transparent QML surface composites over the
    // windows below instead of painting an opaque background.
    QSurfaceFormat fmt;
    fmt.setAlphaBufferSize(8);
    QSurfaceFormat::setDefaultFormat(fmt);

    QQuickView view;
    view.setColor(Qt::transparent);
    view.setResizeMode(QQuickView::SizeRootObjectToView);
    // The shared SpaceUX.Shared module (ScenePie) registers its qmldir under
    // qrc:/SpaceUX/Shared, off the default /qt/qml import root, so add qrc:/ to
    // the import path for `import SpaceUX.Shared` to resolve.
    view.engine()->addImportPath(QStringLiteral("qrc:/"));

    LayerShellQt::Window *layer = LayerShellQt::Window::get(&view);
    layer->setLayer(LayerShellQt::Window::LayerOverlay);
    // Anchor top-left so SetCursorPosition can place the surface by margin.
    layer->setAnchors(LayerShellQt::Window::Anchors(
        LayerShellQt::Window::AnchorTop | LayerShellQt::Window::AnchorLeft));
    // Never take keyboard focus: the app below keeps its caret, so the
    // user can keep typing while the pie is up.
    layer->setKeyboardInteractivity(
        LayerShellQt::Window::KeyboardInteractivityNone);
    // Don't reserve screen space / push panels around.
    layer->setExclusiveZone(-1);
    layer->setScope(QStringLiteral("spaceux-overlay"));

    // Load the QML first: `import SpaceUX` forces the module's type
    // registration and creates the OverlayController singleton. Fetching it
    // before this point races the registration and can return null.
    view.setSource(QUrl(QStringLiteral("qrc:/SpaceUX/qml/Overlay.qml")));

    // OverlayController is a QML singleton (type SpaceUX/OverlayController):
    // the QML engine owns the one instance, and QML + D-Bus share it. Fetch
    // it by type id, inject the window, and export it on the bus.
    const int overlayTypeId = qmlTypeId("SpaceUX", 1, 0, "OverlayController");
    auto *controller =
        view.engine()->singletonInstance<OverlayController *>(overlayTypeId);
    if (controller == nullptr) {
        qWarning("spaceux-overlay: could not obtain the OverlayController "
                 "singleton");
        return 1;
    }
    controller->setWindow(&view, layer);
    // Single source of truth for the surface size lives in the controller
    // (shared with the QML scene and the input-region mask).
    view.resize(controller->surfaceSize(), controller->surfaceSize());
    // Parented to the controller; exported automatically when the
    // controller object is registered below.
    new OverlayDBusAdaptor(controller);

    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.registerObject(QStringLiteral("/org/spaceux/Overlay"),
                            controller)) {
        qWarning("spaceux-overlay: failed to register D-Bus object");
        return 1;
    }
    if (!bus.registerService(QStringLiteral("org.spaceux.Overlay"))) {
        qWarning("spaceux-overlay: failed to register D-Bus service "
                 "(already running?)");
        return 1;
    }

    // Stays hidden until the SpaceUX side calls Show() over the bus.
    return app.exec();
}

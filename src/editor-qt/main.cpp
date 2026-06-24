// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later
//
// spaceux-editor (#457 Phase B): the native Qt6/QML editor, a client of the
// headless org.spaceux.Core1 core. The
// EditorClient singleton (registered by the SpaceUX.Editor QML module) is the
// only D-Bus surface; everything else is QML over it.

#include <QApplication>
#include <QFontDatabase>
#include <QIcon>
#include <QLibraryInfo>
#include <QLocale>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QTranslator>
#include <QUrl>

#include "SingleInstance.h"

int main(int argc, char *argv[]) {
    // Honour fractional monitor scales exactly (the editor must not snap to
    // 100%/200%); the compositor's real per-output scale drives layout. Must be
    // set before the application is constructed.
    QApplication::setHighDpiScaleFactorRoundingPolicy(
        Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);

    // QApplication (not QGuiApplication): NativeDialogs' QFileDialog is a
    // QWidget, so the editor needs the widgets application even though the UI is
    // QML. It routes file pickers to the desktop's native chooser (the portal on
    // Wayland), keeping them DE-agnostic.
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("SpaceUX Editor"));
    // The Wayland app_id: the compositor resolves the taskbar/window icon from
    // the matching spaceux.desktop entry (#50), not from setWindowIcon.
    QGuiApplication::setDesktopFileName(QStringLiteral("spaceux"));
    // Process icon for everything that doesn't go through the .desktop lookup
    // (X11 _NET_WM_ICON, dev runs without an installed entry).
    app.setWindowIcon(QIcon(QStringLiteral(":/icon.png")));

    // Load Qt's own translations for the system locale so the native text
    // context menu (NativeTextMenu) and any other Qt standard strings appear in
    // the desktop's language, exactly like every other Qt/KDE app and following
    // the user's KDE language setting. Only Qt's built-in strings are affected;
    // the editor's own authored UI is unchanged. Parented to the app so it lives
    // for the whole run.
    auto *qtTranslator = new QTranslator(&app);
    if (qtTranslator->load(QLocale(), QStringLiteral("qtbase"),
                           QStringLiteral("_"),
                           QLibraryInfo::path(QLibraryInfo::TranslationsPath)))
        QApplication::installTranslator(qtTranslator);

    // One editor per session: a second launch surfaces the running window
    // instead of opening a duplicate, then exits. Claimed before the QML
    // engine exists so the duplicate never builds a UI.
    SingleInstance instance;
    if (!instance.claimOrRaise())
        return 0;

    // Register the bundled Inter SemiBold ONLY for the pie labels (ScenePie
    // references the family by name, matching the overlay).
    // We deliberately do NOT setFont() it application-wide: that would also
    // override native Qt dialogs (the file picker), which must follow the
    // desktop's own settings. The editor UI + the dialogs use the system font.
    if (QFontDatabase::addApplicationFont(
            QStringLiteral(":/fonts/Inter-SemiBold.ttf")) < 0)
        qWarning("spaceux-editor: failed to load the bundled Inter font");

    QQmlApplicationEngine engine;
    // The shared SpaceUX.Shared module's qmldir lives under qrc:/SpaceUX/Shared
    // (not the default /qt/qml import root), so add qrc:/ to the import path for
    // `import SpaceUX.Shared` to resolve.
    engine.addImportPath(QStringLiteral("qrc:/"));
    // Loaded by qrc URL (the QML lives in the qml/ subdir, so it isn't a
    // top-level module type); `import SpaceUX.Editor` still resolves the
    // EditorClient singleton the module registers. RESOURCE_PREFIX "/" + URI
    // SpaceUX.Editor put the file under qrc:/SpaceUX/Editor/.
    engine.load(QUrl(QStringLiteral("qrc:/SpaceUX/Editor/qml/Main.qml")));
    if (engine.rootObjects().isEmpty()) {
        qCritical("spaceux-editor: failed to load the QML root");
        return 1;
    }
    // The root is the editor's Window; hand it to the single-instance service
    // so a second launch's Raise can surface it.
    instance.attachWindow(
        qobject_cast<QQuickWindow *>(engine.rootObjects().constFirst()));

    return app.exec();
}

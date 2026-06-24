// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#include "OverlayController.h"

#include <QCoreApplication>
#include <QGuiApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMargins>
#include <QPoint>
#include <QPolygon>
#include <QPolygonF>
#include <QQuickView>
#include <QRect>
#include <QRegion>
#include <QScreen>
#include <QtGlobal>

#include <cmath>

#ifdef SPACEUX_HAVE_KWINDOWSYSTEM
#include <KWindowEffects>
#endif
#include <LayerShellQt/Window>

namespace {
// A centred circular region of the given radius, in surface-local pixels,
// clamped to the surface. The input-region mask and the blur region share this
// shape, so click-through and the frosted area can't drift.
QRegion pieRegion(int surfaceSize, int radius) {
    const int r = qBound(0, radius, surfaceSize / 2);
    return QRegion(surfaceSize / 2 - r, surfaceSize / 2 - r, 2 * r, 2 * r,
                   QRegion::Ellipse);
}
} // namespace

OverlayController::OverlayController(QObject *parent) : QObject(parent) {}

void OverlayController::setWindow(QQuickView *view,
                                  LayerShellQt::Window *layer) {
    view_ = view;
    layer_ = layer;
}

void OverlayController::show() {
    // Input region = the pie circle. setMask maps to the Wayland
    // wl_surface input region on the Qt Wayland backend, so pointer
    // events outside the circle fall through to the surface below.
    // NOTE (spike): confirming this mapping actually happens on KDE
    // Wayland is the central thing this spike must prove.
    view_->setMask(pieRegion(surfaceSize_, regionRadius()));
    view_->show();
    // Re-apply the blur after the surface exists; calling it pre-show would
    // race the platform window's creation.
    applyBlur();
}

void OverlayController::hide() { view_->hide(); }

void OverlayController::quit() {
    Q_EMIT closed();
    QCoreApplication::quit();
}

void OverlayController::setCursorPosition(int x, int y) {
    // (x, y) is a global (whole-desktop) cursor pixel. layer-shell margins
    // are relative to the *anchored output*, not the global desktop, so a
    // global coordinate would spill across monitors. Pick the output the
    // cursor is on, bind the surface to it, then convert the global pixel
    // to that output's local coordinates for the margin.
    //
    // layer-shell positioning is not subject to KWin's "centre small
    // windows" rule, which is what blocked the plain xdg-shell route.
    lastCursorX_ = x;
    lastCursorY_ = y;
    hasCursor_ = true;

    const QPoint global(x, y);
    QScreen *screen = QGuiApplication::screenAt(global);
    if (!screen)
        screen = QGuiApplication::primaryScreen();

    // Bind the surface to the cursor's output.
    layer_->setScreen(screen);
    view_->setScreen(screen);

    applyMargins();
}

void OverlayController::applyMargins() {
    if (view_ == nullptr || layer_ == nullptr || !hasCursor_)
        return;
    QScreen *screen = view_->screen();
    if (screen == nullptr)
        return;
    const QRect geo = screen->geometry();
    // Offset by half the surface so the pie centre lands on the cursor,
    // then clamp so the whole pie stays on this output. Near an edge the
    // centre drifts off the cursor, but the pie never spills off-screen
    // (and never asks for the negative margins layer-shell would clamp).
    const int half = surfaceSize_ / 2;
    const int maxLeft = qMax(0, geo.width() - surfaceSize_);
    const int maxTop = qMax(0, geo.height() - surfaceSize_);
    const int marginLeft = qBound(0, (lastCursorX_ - geo.x()) - half, maxLeft);
    const int marginTop = qBound(0, (lastCursorY_ - geo.y()) - half, maxTop);
    layer_->setMargins(QMargins(marginLeft, marginTop, 0, 0));
}

void OverlayController::setScene(const QString &json) {
    if (json == sceneJson_)
        return;
    sceneJson_ = json;
    // Track the rendered extent so the blur + input-region mask follow the
    // visible pie (inner radius at the top level, growing to the outer radius
    // once a preview/drill adds the outer band) instead of the full circle
    // (#324). A malformed payload leaves the extent at 0 -> full circle.
    const QJsonObject obj = QJsonDocument::fromJson(json.toUtf8()).object();
    const double extent = obj.value(QStringLiteral("extent")).toDouble(0);
    // Modern wedge style (#47 PR2): the per-wedge (+ centre) polygons and the
    // viewBox they live in, used to build a per-wedge blur region. Absent on the
    // classic / shape path, leaving the list empty so applyBlur uses the single
    // disc region. Reference coords (centred on 0), mapped to surface px later.
    viewBoxSize_ = obj.value(QStringLiteral("viewBoxSize")).toDouble(0);
    displaySize_ = obj.value(QStringLiteral("displaySize")).toDouble(0);
    blurWedges_.clear();
    const QJsonArray wedges = obj.value(QStringLiteral("blurWedges")).toArray();
    for (const auto &w : wedges) {
        const QJsonArray flat = w.toArray();
        QPolygonF poly;
        poly.reserve(flat.size() / 2);
        for (int i = 0; i + 1 < flat.size(); i += 2)
            poly << QPointF(flat.at(i).toDouble(), flat.at(i + 1).toDouble());
        if (!poly.isEmpty())
            blurWedges_ << poly;
    }
    const bool extentChanged = extent != sceneExtent_;
    if (extentChanged)
        sceneExtent_ = extent;
    // Keep the live native pie in sync with every appearance change. The
    // input-region mask only needs the new radius when the extent changed, but
    // the blur region must be re-applied on ANY scene change: a gap-width or
    // gap-shape edit changes the wedge polygons at the same extent, and it has to
    // show on the open pie at once.
    if (view_ != nullptr && view_->isVisible()) {
        if (extentChanged)
            view_->setMask(pieRegion(surfaceSize_, regionRadius()));
        applyBlur();
    }
    Q_EMIT sceneChanged();
}

void OverlayController::setTheme(const QString &json) {
    if (json == themeJson_)
        return;
    themeJson_ = json;
    // The controller owns one field of the theme: the frosted-background flag,
    // which drives a compositor effect QML can't reach. The colours/opacity/
    // font are parsed in QML (see Overlay.qml). A malformed payload leaves
    // blur off (toBool's default).
    const QJsonObject obj = QJsonDocument::fromJson(json.toUtf8()).object();
    blurEnabled_ = obj.value(QStringLiteral("blur")).toBool(false);
    // Apply now so a live theme edit toggles blur on the open pie; a no-op
    // before the surface exists, re-applied by show().
    applyBlur();
    Q_EMIT themeChanged();
}

void OverlayController::setSurfaceSize(int px) {
    if (px <= 0 || px == surfaceSize_)
        return;
    surfaceSize_ = px;
    if (view_ != nullptr)
        view_->resize(surfaceSize_, surfaceSize_);
    Q_EMIT surfaceSizeChanged();
    // When the pie is already on screen (a live size-slider change), re-apply
    // the geometry that depends on the size: the input-region mask, the margins
    // (re-anchor the centre on the cursor at the new size, which also forces the
    // compositor to re-configure the surface, needed for the resize to take on
    // rotated outputs), and the blur. Otherwise show() / SetCursorPosition do
    // it on the open path.
    if (view_ != nullptr && view_->isVisible()) {
        view_->setMask(pieRegion(surfaceSize_, regionRadius()));
        applyMargins();
        applyBlur();
    }
}

void OverlayController::applyBlur() {
    if (view_ == nullptr)
        return;
#ifdef SPACEUX_HAVE_KWINDOWSYSTEM
    const bool on = blurEnabled_ && KWindowEffects::isEffectAvailable(
                                        KWindowEffects::BlurBehind);
    QRegion region;
    if (on) {
        // Modern wedge style frosts each wedge separately so the gaps stay sharp;
        // every other style keeps the historical single disc.
        region = blurWedgeRegion();
        if (region.isEmpty())
            region = pieRegion(surfaceSize_, regionRadius());
    }
    KWindowEffects::enableBlurBehind(view_, on, region);
#else
    // Built without KWindowSystem: no compositor blur is available. Touch the
    // flag so it isn't flagged unused under -Werror.
    (void)blurEnabled_;
#endif
}

QRegion OverlayController::blurWedgeRegion() const {
    if (blurWedges_.isEmpty() || viewBoxSize_ <= 0.0 || displaySize_ <= 0.0 ||
        surfaceSize_ <= 0)
        return QRegion();
    // The pie is drawn at displaySize / viewBoxSize and centred in the (larger)
    // surface, so a reference unit is displaySize / viewBoxSize px (NOT surface /
    // viewBox: the surface adds the ring-inset padding around the pie), with the
    // pie centre at the surface centre. Using the surface ratio would over-scale
    // the frost past the rim and narrow the gaps this region keeps sharp.
    const double f = displaySize_ / viewBoxSize_;
    const double c = surfaceSize_ / 2.0;
    QRegion region;
    for (const QPolygonF &poly : blurWedges_) {
        QPolygon p;
        p.reserve(static_cast<int>(poly.size()));
        for (const QPointF &pt : poly)
            p << QPoint(qRound(c + pt.x() * f), qRound(c + pt.y() * f));
        region += QRegion(p);
    }
    return region;
}

int OverlayController::regionRadius() const {
    // The full pie circle, the historical extent: the outer-ring outer radius.
    const int full = surfaceSize_ / 2 - ringInset_;
    if (sceneExtent_ <= 0.0)
        return full; // no scene pushed yet
    // Round up so the rim isn't clipped, and never exceed the surface.
    return qMin(static_cast<int>(std::ceil(sceneExtent_)), full);
}

void OverlayController::applyRegion() {
    if (view_ == nullptr)
        return;
    view_->setMask(pieRegion(surfaceSize_, regionRadius()));
    applyBlur();
}

void OverlayController::reportPointerMoved(int x, int y) {
    Q_EMIT pointerMoved(x, y);
}

void OverlayController::reportPointerPressed(int x, int y) {
    Q_EMIT pointerPressed(x, y);
}

OverlayDBusAdaptor::OverlayDBusAdaptor(OverlayController *ctrl)
    : QDBusAbstractAdaptor(ctrl), ctrl_(ctrl) {
    // Bridge controller signals onto the bus interface.
    connect(ctrl_, &OverlayController::pointerMoved, this,
            &OverlayDBusAdaptor::PointerMoved);
    connect(ctrl_, &OverlayController::pointerPressed, this,
            &OverlayDBusAdaptor::PointerPressed);
    connect(ctrl_, &OverlayController::closed, this,
            &OverlayDBusAdaptor::Closed);
}

void OverlayDBusAdaptor::Show() { ctrl_->show(); }
void OverlayDBusAdaptor::Hide() { ctrl_->hide(); }
void OverlayDBusAdaptor::Quit() { ctrl_->quit(); }
void OverlayDBusAdaptor::SetCursorPosition(int x, int y) {
    ctrl_->setCursorPosition(x, y);
}
void OverlayDBusAdaptor::SetScene(const QString &json) {
    ctrl_->setScene(json);
}
void OverlayDBusAdaptor::SetTheme(const QString &json) {
    ctrl_->setTheme(json);
}
void OverlayDBusAdaptor::SetSurfaceSize(int px) { ctrl_->setSurfaceSize(px); }

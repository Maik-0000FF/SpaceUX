// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef SPACEUX_OVERLAY_CONTROLLER_H
#define SPACEUX_OVERLAY_CONTROLLER_H

#include <QDBusAbstractAdaptor>
#include <QList>
#include <QObject>
#include <QPolygonF>
#include <QRegion>
#include <QString>
#include <qqmlregistration.h>

namespace LayerShellQt {
class Window;
}
class QQuickView;

// Owns the overlay surface state and is the bridge between D-Bus
// (driven by the SpaceUX core process) and the QML scene.
//
// Design split (see private/overlay-architecture.md): the SpaceUX side
// runs the shape-plugin compute (layout()/hitTest()) and pushes the
// *result* here. This controller does not compute geometry; it renders
// what it is told and reports raw pointer events back so the SpaceUX
// side can hit-test them with the same plugin code.
//
// The controller object itself is exported on the bus; the
// OverlayDBusAdaptor child below carries the org.spaceux.Overlay1
// interface (capitalised methods/signals) and forwards to the lower-case
// slots here.
class OverlayController : public QObject {
    Q_OBJECT
    // Exposed to QML as the singleton `OverlayController`. Not named
    // `Overlay` to avoid colliding with the Overlay.qml file's own type.
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString sceneJson READ sceneJson NOTIFY sceneChanged)
    Q_PROPERTY(QString themeJson READ themeJson NOTIFY themeChanged)
    // Single source of truth for surface geometry, shared with the QML
    // scene (binds width/height + ring inset) and the input-region mask,
    // so the click-through circle and the drawn pie cannot drift apart.
    // surfaceSize tracks the pie-size slider (SetSurfaceSize), so it's
    // NOTIFY, not CONSTANT, and the QML re-binds when it changes.
    Q_PROPERTY(int surfaceSize READ surfaceSize NOTIFY surfaceSizeChanged)
    Q_PROPERTY(int ringInset READ ringInset CONSTANT)

public:
    explicit OverlayController(QObject *parent = nullptr);

    // The engine owns this singleton, so the window can't come through the
    // constructor. main injects it after fetching the instance; the
    // window-control methods (show/hide/cursor/mask) need it.
    void setWindow(QQuickView *view, LayerShellQt::Window *layer);

    QString sceneJson() const { return sceneJson_; }
    QString themeJson() const { return themeJson_; }
    int surfaceSize() const { return surfaceSize_; }
    int ringInset() const { return ringInset_; }

    // QML -> here -> D-Bus. The MouseArea only receives events inside the
    // input-region mask (the pie circle); clicks outside fall through to
    // the window below, which is the whole point of the spike.
    Q_INVOKABLE void reportPointerMoved(int x, int y);
    Q_INVOKABLE void reportPointerPressed(int x, int y);

    // D-Bus methods (routed from the adaptor).
    void show();
    void hide();
    void quit();
    void setCursorPosition(int x, int y);
    void setScene(const QString &json);
    void setTheme(const QString &json);
    // Resize the surface (pie-size slider). Resizes the view, re-applies the
    // input-region mask + blur when visible, and re-emits so the QML re-binds.
    void setSurfaceSize(int px);

Q_SIGNALS:
    void sceneChanged();
    void themeChanged();
    void surfaceSizeChanged();
    // Re-emitted onto the bus by the adaptor.
    void pointerMoved(int x, int y);
    void pointerPressed(int x, int y);
    void closed();

private:
    // Ask the compositor to blur the desktop behind the pie circle, or clear
    // it. Honoured only where KWindowEffects reports the blur effect available
    // (KWin); a no-op otherwise, so non-KDE compositors degrade to plain
    // translucency. Re-applied on show() and on a theme change.
    void applyBlur();

    // Recompute + set the layer-shell margins from the last cursor and the
    // current surface size, anchoring the pie centre on the cursor. Called on
    // SetCursorPosition and again on a live resize (so the surface re-anchors
    // and the compositor re-configures it on every output, including rotated).
    void applyMargins();

    // Radius (surface px) of the blur region and the input-region mask: the
    // rendered scene extent when one has been pushed, clamped to the surface;
    // the full pie circle (surfaceSize/2 - ringInset) before the first scene.
    // Tracking the extent keeps the frosted area + click-through to the visible
    // pie instead of a fixed full circle (#324).
    int regionRadius() const;

    // Set the input-region mask + re-apply the blur to the current region
    // radius. Called whenever the mask shape changes (show, resize, new scene).
    void applyRegion();

    // The modern wedge's per-wedge blur region (#47 PR2): the pushed wedge
    // polygons (reference coords, centred on 0) mapped to surface pixels via the
    // surface size / viewBox ratio and unioned. Empty when no wedge polygons were
    // pushed (classic style / shape plugin), so applyBlur falls back to the
    // single pieRegion disc.
    QRegion blurWedgeRegion() const;

    QQuickView *view_ = nullptr;
    LayerShellQt::Window *layer_ = nullptr;
    // Last cursor pushed via SetCursorPosition, so a live resize can re-anchor.
    int lastCursorX_ = 0;
    int lastCursorY_ = 0;
    bool hasCursor_ = false;
    QString sceneJson_;
    QString themeJson_;
    // Outermost rendered radius (surface px) parsed from the pushed scene's
    // `extent`, or 0 before the first scene. Drives regionRadius() (#324).
    double sceneExtent_ = 0;
    // Frosted-background flag parsed from the pushed theme (#296 P2b-4a).
    bool blurEnabled_ = false;
    // Modern wedge (#47 PR2): the pushed wedge + centre polygons in reference
    // coords (centred on 0), plus the scene's viewBox edge and the on-screen
    // display edge. The pie is drawn at displaySize / viewBoxSize and centred in
    // the (larger) surface, so the polygons map with that same ratio, not the
    // surface size. Empty / 0 keeps the classic single-circle blur region.
    QList<QPolygonF> blurWedges_;
    double viewBoxSize_ = 0;
    double displaySize_ = 0;
    // Fixed pie-sized surface. The pie is centred in it; the cursor is
    // mapped to the centre via the layer-shell margins.
    int surfaceSize_ = 480;
    // Gap between the surface edge and the pie's outer radius. Shared with
    // the QML scene via the ringInset property. Must equal main's
    // OVERLAY_RING_INSET (index.ts), which sizes the surface to match.
    int ringInset_ = 2;
};

// org.spaceux.Overlay1 — the on-bus interface. Methods forward to the
// controller's slots; signals mirror the controller's signals so the
// SpaceUX side can react to pointer events over the bus.
class OverlayDBusAdaptor : public QDBusAbstractAdaptor {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.spaceux.Overlay1")

public:
    explicit OverlayDBusAdaptor(OverlayController *ctrl);

public Q_SLOTS:
    void Show();
    void Hide();
    void Quit();
    void SetCursorPosition(int x, int y);
    void SetScene(const QString &json);
    void SetTheme(const QString &json);
    void SetSurfaceSize(int px);

Q_SIGNALS:
    void PointerMoved(int x, int y);
    void PointerPressed(int x, int y);
    void Closed();

private:
    OverlayController *ctrl_;
};

#endif // SPACEUX_OVERLAY_CONTROLLER_H

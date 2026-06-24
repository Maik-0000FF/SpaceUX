// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#include "PieView.h"

#include <QPainter>
#include <QRectF>

PieView::PieView(QQuickItem *parent) : QQuickPaintedItem(parent) {
    // Smooth the SVG paths / text / embedded icons. The backing store is cleared
    // to the transparent fillColor before each paint() (opaquePainting is false),
    // so a shorter label on the next scene leaves no stale pixels behind.
    setAntialiasing(true);
}

void PieView::setSvg(const QString &svg) {
    if (svg == svg_)
        return;
    svg_ = svg;
    // load() returns false on an empty / invalid string and leaves the renderer
    // invalid, so paint() draws nothing and clearing the SVG blanks the item.
    renderer_.load(svg_.toUtf8());
    update();
    Q_EMIT svgChanged();
}

void PieView::paint(QPainter *painter) {
    if (!renderer_.isValid())
        return;
    // The SVG viewBox is square and centred on the pie centre; the item is square
    // too (QML binds width == height), so filling it maps the pie centre to the
    // item centre with no distortion, matching the centred Image it replaces.
    renderer_.render(painter, QRectF(0, 0, width(), height()));
}

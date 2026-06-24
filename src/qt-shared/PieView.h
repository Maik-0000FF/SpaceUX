// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef SPACEUX_PIE_VIEW_H
#define SPACEUX_PIE_VIEW_H

#include <QQuickPaintedItem>
#include <QString>
#include <QSvgRenderer>
#include <qqmlregistration.h>

// Paints the pie SVG (the string built by src/core/pie-svg buildPieSvg, pushed
// from the SpaceUX side) into the item rect with QSvgRenderer.
//
// A QQuickPaintedItem, not a QML Image fed a `data:` URI. The Image reloaded its
// source on every scene push and re-decoded it asynchronously, flashing a blank
// frame between the cleared source and the decoded one; that was the flicker.
// PieView renders the SVG synchronously in paint(), and the on-screen texture is
// only replaced once that paint finishes, so a scene swap (hover, drill, live
// edit) never shows a blank frame. QSvgRenderer rasterises at the item's device
// pixel ratio, so no manual sourceSize is needed either.
class PieView : public QQuickPaintedItem {
    Q_OBJECT
    QML_ELEMENT
    // The whole pie as an SVG string; setting it reloads the renderer + repaints.
    Q_PROPERTY(QString svg READ svg WRITE setSvg NOTIFY svgChanged)

public:
    explicit PieView(QQuickItem *parent = nullptr);

    QString svg() const { return svg_; }
    void setSvg(const QString &svg);

    void paint(QPainter *painter) override;

Q_SIGNALS:
    void svgChanged();

private:
    QString svg_;
    QSvgRenderer renderer_;
};

#endif // SPACEUX_PIE_VIEW_H

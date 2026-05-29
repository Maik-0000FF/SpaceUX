// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { isRenderableIcon } from '@/core/icon';
import { type MenuNode } from '@/shared/menu';

import styles from './MenuPreview.module.scss';

/** A node's icon as an `<image>`, or null when the node has no renderable
 *  icon. Stacked above the label point (cx, cy); with an empty label it
 *  centres on the point instead. `iconSize` is the appearance-scaled size, so
 *  the preview tracks the live pie's icon size faithfully.
 *
 *  Lives in its own module so both MenuPreview (wedge map) and ShapePie
 *  (plugin shapes) can import it without one having to import the other —
 *  see #255 for the cyclic-import that motivated this split. */
export function sectorIcon(
  node: MenuNode,
  cx: number,
  cy: number,
  iconSize: number,
): React.ReactElement | null {
  if (!isRenderableIcon(node.icon)) return null;
  const top = node.label.trim().length > 0 ? cy - iconSize : cy - iconSize / 2;
  return (
    <image
      className={styles.icon}
      href={node.icon}
      x={cx - iconSize / 2}
      y={top}
      width={iconSize}
      height={iconSize}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

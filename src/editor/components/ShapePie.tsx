// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo } from 'react';

import { isRenderableIcon } from '@/core/icon';
import { truncatePieLabel, segmentLabelFontPx } from '@/core/pie-geometry';
import { isCancelNode, type MenuNode } from '@/shared/menu';
import {
  validateShapeLayout,
  type ShapeLayout,
  type ShapeRingRadii,
} from '@/shared/shape-plugin-api';

import { useShapeModules } from '../state/shape-modules';

import styles from './MenuPreview.module.scss';
import { sectorIcon } from './MenuPreview';

/**
 * Render the active ring of a pie as a shape-plugin layout (#107 PR3b).
 * Calls the plugin's `layout(sectorCount, ringRadii)`, defensively
 * validates the return, and emits one <g> per sector with a <circle>
 * (the node body), the node's icon, and the label.
 *
 * Used by `MenuPreview` to replace the active-ring wedge map when a
 * shape plugin is selected. Falls back to wedge by returning `null`
 * when the plugin isn't loaded yet or its layout output fails the
 * structural check; the caller renders the wedge code path in that
 * case, so the pie is never blank.
 *
 * The wedge code path is not touched. This component is parallel,
 * activated only by `MenuConfig.shapeModel` / `PieAppearance.shapeModel`
 * resolving to a known shape plugin id.
 *
 * The live overlay (`src/renderer/PieMenu.tsx`) does NOT use this
 * component today; PR3c adds the same dispatch on the renderer side,
 * possibly by lifting this component to a renderer-process-agnostic
 * location.
 */
export type ShapePieProps = {
  /** Composite `<pluginId>/<shapeId>` key from the resolver. */
  shapeKey: string;
  /** The active ring's nodes; one per sector. */
  sectors: readonly MenuNode[];
  /** Ring radii passed to the plugin's `layout`. Same shape the host
   *  computes for the wedge default. */
  ringRadii: ShapeRingRadii;
  /** The currently-selected sector index, or null. Drives the
   *  `is-active` class on its <circle>. */
  selectedIndex: number | null;
  /** Edge length the host wants icons drawn at, in SVG units. */
  iconSize: number;
  /** Pixel radius the labels are positioned against, used to size the
   *  font auto-fit. Matches the wedge map's `activeLabel`. */
  labelRadius: number;
  /** Drop target index during a drag-reorder, or null. Drives the
   *  `is-drop-target` class on its <circle>. */
  dropTo?: number | null;
  /** Drag source index, for the `dragging` class. */
  dragFrom?: number | null;
  /** Pointer-down on a sector; the parent owns the drag state machine. */
  onSectorPointerDown?: (index: number, evt: React.PointerEvent<SVGGElement>) => void;
  /** Keyboard activation; the parent decides select vs drill. */
  onSectorKeyDown?: (index: number, evt: React.KeyboardEvent<SVGGElement>) => void;
  /** The wedge-map JSX the caller would have rendered if no shape plugin
   *  were active. Rendered when the plugin's module isn't loaded yet,
   *  the source pull failed, or the plugin's `layout()` returned a
   *  malformed value. Keeps the pie filled in every error path so the
   *  user never sees a blank ring. */
  fallback: React.ReactNode;
};

/** Per-sector ARIA + className helpers. Inlined here because the
 *  wedge map computes them inline too; promoting them to a helper
 *  would obscure the parallel between the two render paths. */
function sectorClassName(args: {
  selected: boolean;
  isDropTarget: boolean;
  cancel: boolean;
}): string {
  return [
    styles.shapeNode,
    args.selected && styles.shapeNodeSelected,
    args.isDropTarget && styles.shapeNodeDropTarget,
    args.cancel && styles.shapeNodeCancel,
  ]
    .filter(Boolean)
    .join(' ');
}

export function ShapePie({
  shapeKey,
  sectors,
  ringRadii,
  selectedIndex,
  iconSize,
  labelRadius,
  dropTo = null,
  dragFrom = null,
  onSectorPointerDown,
  onSectorKeyDown,
  fallback,
}: ShapePieProps): React.ReactElement {
  // Pull the plugin id from the namespaced key (`<pluginId>/<shapeId>`).
  // The runtime store loads by plugin id; the shape id is a within-plugin
  // selector that PR3b doesn't dispatch on (a plugin ships one shape, so
  // the key uniquely identifies the layout-function pair).
  const pluginId = shapeKey.includes('/') ? shapeKey.split('/', 1)[0]! : shapeKey;

  const ensureLoaded = useShapeModules((s) => s.ensureLoaded);
  const moduleEntry = useShapeModules((s) => s.modules[pluginId]);

  // Lazy-load on first render. The store coalesces concurrent calls so a
  // remount or a sibling Pie re-mount won't fan out into multiple loads.
  useEffect(() => {
    void ensureLoaded(pluginId);
  }, [ensureLoaded, pluginId]);

  // Compute the layout once per (module, sectorCount, ringRadii) tuple.
  // The plugin's layout is pure; memoising is just to skip re-runs while
  // a frame's other state churns (axes, drag).
  const layoutResult = useMemo(() => {
    if (moduleEntry?.status !== 'ready') return null;
    let raw: unknown;
    try {
      raw = moduleEntry.module.layout(sectors.length, ringRadii);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[shape] layout() threw for plugin ${pluginId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    const validated = validateShapeLayout(raw, sectors.length);
    if (!validated.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[shape] layout() output rejected for plugin ${pluginId}: ${validated.reason}`);
      return null;
    }
    return validated.layout;
  }, [moduleEntry, sectors.length, ringRadii, pluginId]);

  // No module loaded yet, or layout failed validation: render the
  // caller-supplied fallback (the wedge map) so the pie stays filled.
  // The renderer never blanks the active ring on a slow / broken plugin.
  if (layoutResult === null) return <>{fallback}</>;

  return (
    <ShapeSectorList
      layout={layoutResult}
      sectors={sectors}
      selectedIndex={selectedIndex}
      iconSize={iconSize}
      labelRadius={labelRadius}
      dropTo={dropTo}
      dragFrom={dragFrom}
      onSectorPointerDown={onSectorPointerDown}
      onSectorKeyDown={onSectorKeyDown}
    />
  );
}

/** Inner presentational sub-component, separated so the outer ShapePie
 *  can early-return null without nesting all the per-sector rendering
 *  inside a guard. Pure: given a validated layout, emit the SVG. */
function ShapeSectorList(props: {
  layout: ShapeLayout;
  sectors: readonly MenuNode[];
  selectedIndex: number | null;
  iconSize: number;
  labelRadius: number;
  dropTo: number | null;
  dragFrom: number | null;
  onSectorPointerDown?: ShapePieProps['onSectorPointerDown'];
  onSectorKeyDown?: ShapePieProps['onSectorKeyDown'];
}): React.ReactElement {
  const {
    layout,
    sectors,
    selectedIndex,
    iconSize,
    labelRadius,
    dropTo,
    dragFrom,
    onSectorPointerDown,
    onSectorKeyDown,
  } = props;
  return (
    <>
      {sectors.map((node, i) => {
        const sn = layout.nodes[i]!;
        const sl = layout.labels[i]!;
        const selected = selectedIndex === i;
        const isDropTarget = dropTo !== null && dropTo === i && dropTo !== dragFrom;
        const cancel = isCancelNode(node);
        const labelText = truncatePieLabel(node.label);
        const hasIcon = isRenderableIcon(node.icon);
        return (
          <g
            key={`shape-${i}`}
            className={`${styles.wedgeGroup} ${dragFrom === i ? styles.dragging : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${node.branches?.length ? 'Open' : 'Select'} ${node.label}`}
            aria-pressed={selected}
            onPointerDown={onSectorPointerDown ? (e) => onSectorPointerDown(i, e) : undefined}
            onKeyDown={onSectorKeyDown ? (e) => onSectorKeyDown(i, e) : undefined}
          >
            <circle
              cx={sn.cx}
              cy={sn.cy}
              r={sn.r}
              className={sectorClassName({ selected, isDropTarget, cancel })}
            />
            {sectorIcon(node, sn.cx, sn.cy, iconSize)}
            <text
              x={sl.x}
              y={hasIcon ? sl.y + iconSize * 0.5 : sl.y}
              textAnchor={sl.anchor}
              dominantBaseline="middle"
              className={styles.label}
              style={{
                fontSize: `calc(${segmentLabelFontPx(labelRadius, sectors.length, [...labelText].length)}px * var(--pie-label-scale, 1))`,
              }}
            >
              {labelText}
            </text>
          </g>
        );
      })}
    </>
  );
}

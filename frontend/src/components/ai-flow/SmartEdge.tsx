/**
 * SmartEdge - Custom edge with A* grid-based orthogonal pathfinding
 *
 * Routes edges around node bounding boxes to avoid collisions.
 * Uses an A* algorithm on a discrete grid to find the shortest
 * orthogonal path that doesn't cross any node.
 */

'use client';

import React, { useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useNodes,
  type EdgeProps,
  type Node,
} from '@xyflow/react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELL = 20;        // grid cell size (px)
const NODE_PAD = 14;    // padding around obstacle nodes (px)
const MAX_ITER = 8000;  // max A* iterations before fallback
const CORNER_R = 8;     // border-radius at path corners (px)

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Build padded obstacle rectangles from nodes, excluding source & target */
function buildObstacles(nodes: Node[], excludeIds: string[]): Rect[] {
  const exclude = new Set(excludeIds);
  return nodes
    .filter((n) => !exclude.has(n.id))
    .map((n) => ({
      x: n.position.x,
      y: n.position.y,
      w: (n.measured?.width ?? (n.width as number | undefined) ?? 200),
      h: (n.measured?.height ?? (n.height as number | undefined) ?? 80),
    }));
}

/** Check if a world-space point lies inside any padded obstacle */
function isInsideAny(wx: number, wy: number, rects: Rect[]): boolean {
  for (const r of rects) {
    if (
      wx >= r.x - NODE_PAD &&
      wx <= r.x + r.w + NODE_PAD &&
      wy >= r.y - NODE_PAD &&
      wy <= r.y + r.h + NODE_PAD
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// A* orthogonal pathfinding
// ---------------------------------------------------------------------------

function findPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: Rect[],
): [number, number][] {
  // Quick exit: same point
  if (Math.abs(sx - tx) < 1 && Math.abs(sy - ty) < 1) {
    return [[sx, sy], [tx, ty]];
  }

  // Quick check: direct horizontal line clear?
  if (Math.abs(sy - ty) < CELL) {
    const minX = Math.min(sx, tx);
    const maxX = Math.max(sx, tx);
    let clear = true;
    for (let x = minX; x <= maxX; x += CELL / 2) {
      if (isInsideAny(x, sy, obstacles)) { clear = false; break; }
    }
    if (clear) return [[sx, sy], [tx, ty]];
  }

  const sc = Math.round(sx / CELL);
  const sr = Math.round(sy / CELL);
  const tc = Math.round(tx / CELL);
  const tr = Math.round(ty / CELL);

  if (sc === tc && sr === tr) return [[sx, sy], [tx, ty]];

  // Grid bounds with margin
  const margin = 15;
  const minC = Math.min(sc, tc) - margin;
  const maxC = Math.max(sc, tc) + margin;
  const minR = Math.min(sr, tr) - margin;
  const maxR = Math.max(sr, tr) + margin;
  const rows = maxR - minR + 1;

  // Pre-compute blocked cells from obstacle rectangles
  const blockedCells = new Set<number>();
  for (const r of obstacles) {
    const c1 = Math.floor((r.x - NODE_PAD) / CELL) - 1;
    const c2 = Math.ceil((r.x + r.w + NODE_PAD) / CELL) + 1;
    const r1 = Math.floor((r.y - NODE_PAD) / CELL) - 1;
    const r2 = Math.ceil((r.y + r.h + NODE_PAD) / CELL) + 1;
    for (let c = Math.max(c1, minC); c <= Math.min(c2, maxC); c++) {
      for (let row = Math.max(r1, minR); row <= Math.min(r2, maxR); row++) {
        blockedCells.add((c - minC) * rows + (row - minR));
      }
    }
  }

  // Ensure start/end cells are passable
  const sk = (sc - minC) * rows + (sr - minR);
  const tk = (tc - minC) * rows + (tr - minR);
  blockedCells.delete(sk);
  blockedCells.delete(tk);
  // Also clear cells immediately around start/end
  for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    blockedCells.delete((sc + dc - minC) * rows + (sr + dr - minR));
    blockedCells.delete((tc + dc - minC) * rows + (tr + dr - minR));
  }

  // A* search
  const heuristic = (c: number, r: number) => Math.abs(c - tc) + Math.abs(r - tr);

  const gScore = new Map<number, number>();
  const parent = new Map<number, number>();
  const closed = new Set<number>();

  gScore.set(sk, 0);
  const open: Array<{ k: number; c: number; r: number; f: number }> = [
    { k: sk, c: sc, r: sr, f: heuristic(sc, sr) },
  ];

  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let iter = 0;

  while (open.length > 0 && iter < MAX_ITER) {
    iter++;

    // Pop node with smallest f (swap-remove for performance)
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bi].f) bi = i;
    }
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();

    if (closed.has(cur.k)) continue;
    closed.add(cur.k);

    // Reached target?
    if (cur.c === tc && cur.r === tr) {
      const pts: [number, number][] = [];
      let pk: number | undefined = cur.k;
      while (pk !== undefined) {
        const gc = Math.floor(pk / rows) + minC;
        const gr = (pk % rows) + minR;
        pts.unshift([gc * CELL, gr * CELL]);
        pk = parent.get(pk);
      }
      // Snap endpoints to exact handle positions
      pts[0] = [sx, sy];
      pts[pts.length - 1] = [tx, ty];
      return simplifyOrthogonal(pts);
    }

    const curG = gScore.get(cur.k)!;
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;

      const nk = (nc - minC) * rows + (nr - minR);
      if (closed.has(nk) || blockedCells.has(nk)) continue;

      // Slight penalty for direction changes to prefer straighter paths
      const prevK = parent.get(cur.k);
      let turnPenalty = 0;
      if (prevK !== undefined) {
        const prevC = Math.floor(prevK / rows) + minC;
        const prevR = (prevK % rows) + minR;
        const prevDc = cur.c - prevC;
        const prevDr = cur.r - prevR;
        if (prevDc !== dc || prevDr !== dr) turnPenalty = 2;
      }

      const ng = curG + 1 + turnPenalty;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        parent.set(nk, cur.k);
        open.push({ k: nk, c: nc, r: nr, f: ng + heuristic(nc, nr) });
      }
    }
  }

  // Fallback: L-shaped path
  const mx = (sx + tx) / 2;
  return [[sx, sy], [mx, sy], [mx, ty], [tx, ty]];
}

/** Remove collinear waypoints */
function simplifyOrthogonal(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const result: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const sameX = Math.abs(px - cx) < 1 && Math.abs(cx - nx) < 1;
    const sameY = Math.abs(py - cy) < 1 && Math.abs(cy - ny) < 1;
    if (!sameX && !sameY) {
      result.push([cx, cy]);
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// SVG path generation with rounded corners
// ---------------------------------------------------------------------------

function toSvgPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`;
  }

  let d = `M ${pts[0][0]},${pts[0][1]}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];

    const dp = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
    const dn = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
    const r = Math.min(CORNER_R, dp / 2, dn / 2);

    if (r < 1) {
      d += ` L ${cx},${cy}`;
      continue;
    }

    // Points before and after the corner
    const bx = cx - (r * (cx - px)) / dp;
    const by = cy - (r * (cy - py)) / dp;
    const ax = cx + (r * (nx - cx)) / dn;
    const ay = cy + (r * (ny - cy)) / dn;

    d += ` L ${bx},${by}`;
    d += ` Q ${cx},${cy} ${ax},${ay}`;
  }

  const last = pts[pts.length - 1];
  d += ` L ${last[0]},${last[1]}`;
  return d;
}

// ---------------------------------------------------------------------------
// SmartEdge Component
// ---------------------------------------------------------------------------

export default function SmartEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  markerStart,
  label,
  labelStyle,
  labelBgStyle,
  data,
}: EdgeProps & { data?: any }) {
  // v3.1: when data.flowing is true (set by the page based on phase progress),
  // render the edge with a marching dashed line.
  const flowing = !!(data && (data as any).flowing);
  const flowingStyle = flowing
    ? { ...(style || {}), strokeDasharray: '6 4', animation: 'edge-flow 0.6s linear infinite' }
    : style;
  const allNodes = useNodes();

  // Stable key: only recalc when node positions change meaningfully
  const nodesKey = useMemo(
    () =>
      allNodes
        .map(
          (n) =>
            `${n.id}:${Math.round(n.position.x / CELL)}:${Math.round(n.position.y / CELL)}`,
        )
        .join('|'),
    [allNodes],
  );

  const { svgPath, labelPoint } = useMemo(() => {
    // Exclude source, target, and terminal nodes from obstacles
    const obstacles = buildObstacles(allNodes, [source, target]);

    const pts = findPath(sourceX, sourceY, targetX, targetY, obstacles);
    const path = toSvgPath(pts);

    // Label position: midpoint along the path by arc length
    let totalLen = 0;
    const segLens: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      segLens.push(Math.sqrt(dx * dx + dy * dy));
      totalLen += segLens[segLens.length - 1];
    }
    let half = totalLen / 2;
    let lx = (sourceX + targetX) / 2;
    let ly = (sourceY + targetY) / 2;
    for (let i = 0; i < segLens.length; i++) {
      if (half <= segLens[i]) {
        const t = segLens[i] > 0 ? half / segLens[i] : 0;
        lx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
        ly = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
        break;
      }
      half -= segLens[i];
    }

    return { svgPath: path, labelPoint: { x: lx, y: ly } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceX, sourceY, targetX, targetY, source, target, nodesKey]);

  return (
    <>
      <BaseEdge
        id={id}
        path={svgPath}
        style={flowingStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <span
              style={{
                background: (labelBgStyle as any)?.fill || 'white',
                opacity: (labelBgStyle as any)?.fillOpacity ?? 0.9,
                padding: '1px 5px',
                borderRadius: 3,
                fontSize: (labelStyle as any)?.fontSize || 10,
                fontWeight: (labelStyle as any)?.fontWeight || 500,
                color: (labelStyle as any)?.fill || (style as any)?.stroke || '#666',
              }}
            >
              {label as string}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

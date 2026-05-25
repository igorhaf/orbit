/**
 * SmartEdge - Custom edge with A* grid-based orthogonal pathfinding
 *
 * Routes edges around node bounding boxes to avoid collisions.
 * Uses an A* algorithm on a discrete grid to find the shortest
 * orthogonal path that doesn't cross any node.
 */

'use client';

import React, { useMemo, useCallback, useRef } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useNodes,
  useReactFlow,
  type EdgeProps,
  type Node,
} from '@xyflow/react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELL = 16;        // grid cell size (px) — menor = mais preciso, mais lento
const NODE_PAD = 28;    // v3.5.5: padding ↑ pra forçar A* contornar com folga maior
const MAX_ITER = 12000; // v3.5.5: limite ↑ pra evitar fallback em grafos densos
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

  // v3.5.5: Quick check direto só se TOTALMENTE limpo (passo menor, range maior)
  // Inclui também checagem vertical.
  const dxDirect = Math.abs(sx - tx);
  const dyDirect = Math.abs(sy - ty);
  if (dyDirect < 4) {
    const minX = Math.min(sx, tx);
    const maxX = Math.max(sx, tx);
    let clear = true;
    for (let x = minX; x <= maxX; x += 4) {
      if (isInsideAny(x, sy, obstacles)) { clear = false; break; }
    }
    if (clear) return [[sx, sy], [tx, ty]];
  } else if (dxDirect < 4) {
    const minY = Math.min(sy, ty);
    const maxY = Math.max(sy, ty);
    let clear = true;
    for (let y = minY; y <= maxY; y += 4) {
      if (isInsideAny(sx, y, obstacles)) { clear = false; break; }
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

  // v3.5.5: Fallback inteligente — tenta 4 caminhos L-shape e escolhe o que
  // tem MENOS colisões com obstáculos. Se todos colidirem, sobe verticalmente
  // pra fora do bounding box antes de mover horizontal.
  const candidates: [number, number][][] = [];
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  // 4 variantes L-shape
  candidates.push([[sx, sy], [mx, sy], [mx, ty], [tx, ty]]);
  candidates.push([[sx, sy], [tx, sy], [tx, ty]]);
  candidates.push([[sx, sy], [sx, ty], [tx, ty]]);
  candidates.push([[sx, sy], [sx, my], [tx, my], [tx, ty]]);

  // Avalia cada candidato — quanto menos cells colididos, melhor
  const countCollisions = (pts: [number, number][]): number => {
    let count = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 8;
      for (let k = 0; k <= steps; k++) {
        const t = steps === 0 ? 0 : k / steps;
        const px = x1 + (x2 - x1) * t;
        const py = y1 + (y2 - y1) * t;
        if (isInsideAny(px, py, obstacles)) count++;
      }
    }
    return count;
  };
  let best = candidates[0];
  let bestScore = countCollisions(best);
  for (let i = 1; i < candidates.length; i++) {
    const score = countCollisions(candidates[i]);
    if (score < bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  // Se o melhor ainda tem muita colisão, contorna por CIMA do bounding box
  if (bestScore > 3 && obstacles.length > 0) {
    const yMin = Math.min(...obstacles.map((r) => r.y)) - NODE_PAD - 24;
    return [[sx, sy], [sx, yMin], [tx, yMin], [tx, ty]];
  }
  return best;
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
  selected,
}: EdgeProps & { data?: any; selected?: boolean }) {
  // v3.1: when data.flowing is true (set by the page based on phase progress),
  // render the edge with a marching dashed line.
  const flowing = !!(data && (data as any).flowing);
  const flowingStyle = flowing
    ? { ...(style || {}), strokeDasharray: '6 4', animation: 'edge-flow 0.6s linear infinite' }
    : style;
  const allNodes = useNodes();
  const reactFlow = useReactFlow();

  // v3.6.5: waypoints manuais arrastáveis. Se data.waypoints existe, usa
  // esses pontos em vez do A* automático. Cada waypoint vira um handle
  // arrastável; click duplo na edge adiciona; right-click remove.
  const waypoints: [number, number][] | null =
    Array.isArray((data as any)?.waypoints) && (data as any).waypoints.length > 0
      ? (data as any).waypoints
      : null;

  // Stable key: recalc when posição OU dimensão medida mudar (v3.5.5: size
  // entra no key porque measured.width/height vem só após primeiro render,
  // e edges precisam refazer pathfinding com a dimensão real).
  const nodesKey = useMemo(
    () =>
      allNodes
        .map(
          (n) => {
            const w = Math.round((n.measured?.width ?? 200) / CELL);
            const h = Math.round((n.measured?.height ?? 80) / CELL);
            return `${n.id}:${Math.round(n.position.x / CELL)}:${Math.round(n.position.y / CELL)}:${w}:${h}`;
          },
        )
        .join('|'),
    [allNodes],
  );

  const { svgPath, labelPoint, pathPoints } = useMemo(() => {
    let pts: [number, number][];
    if (waypoints) {
      // Caminho manual: source → waypoints → target
      pts = [[sourceX, sourceY], ...waypoints, [targetX, targetY]];
    } else {
      // Caminho automático A*
      const obstacles = buildObstacles(allNodes, [source, target]);
      pts = findPath(sourceX, sourceY, targetX, targetY, obstacles);
    }
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

    return { svgPath: path, labelPoint: { x: lx, y: ly }, pathPoints: pts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceX, sourceY, targetX, targetY, source, target, nodesKey, waypoints]);

  // ── Waypoint editing helpers (v3.6.5) ─────────────────────────────────
  const updateWaypoints = useCallback(
    (newWaypoints: [number, number][]) => {
      reactFlow.setEdges((eds) =>
        eds.map((e) =>
          e.id === id
            ? {
                ...e,
                data: {
                  ...(e.data || {}),
                  waypoints: newWaypoints.length > 0 ? newWaypoints : undefined,
                },
              }
            : e,
        ),
      );
    },
    [id, reactFlow],
  );

  // Double-click na edge → adiciona um waypoint no ponto clicado
  const handleEdgeDoubleClick = useCallback(
    (e: React.MouseEvent<SVGPathElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const flowPos = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const current = waypoints ? [...waypoints] : [];
      // Inserir no índice mais perto da posição do mouse
      // (estratégia simples: anexar; usuário pode arrastar pra reordenar visualmente)
      current.push([Math.round(flowPos.x), Math.round(flowPos.y)]);
      updateWaypoints(current);
    },
    [waypoints, updateWaypoints, reactFlow],
  );

  // Drag handlers (mouse capture global)
  const dragRef = useRef<{ idx: number; startMouse: { x: number; y: number }; startWp: [number, number] } | null>(null);

  const onWaypointMouseDown = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.stopPropagation();
      e.preventDefault();
      const wp = waypoints![idx];
      dragRef.current = { idx, startMouse: { x: e.clientX, y: e.clientY }, startWp: [wp[0], wp[1]] };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dragData = dragRef.current;
        // Convert delta de pixels de tela pra delta de unidades do canvas
        const start = reactFlow.screenToFlowPosition(dragData.startMouse);
        const cur = reactFlow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        const dx = cur.x - start.x;
        const dy = cur.y - start.y;
        const next: [number, number][] = waypoints!.map((p, i) =>
          i === dragData.idx
            ? [Math.round(dragData.startWp[0] + dx), Math.round(dragData.startWp[1] + dy)]
            : p,
        );
        updateWaypoints(next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [waypoints, updateWaypoints, reactFlow],
  );

  // Right-click num waypoint → remove
  const onWaypointContextMenu = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.stopPropagation();
      e.preventDefault();
      if (!waypoints) return;
      const next = waypoints.filter((_, i) => i !== idx);
      updateWaypoints(next);
    },
    [waypoints, updateWaypoints],
  );

  // Mostrar waypoint controls quando edge está selecionada OU já tem waypoints
  const showWaypointControls = selected || (waypoints && waypoints.length > 0);

  return (
    <>
      <BaseEdge
        id={id}
        path={svgPath}
        style={flowingStyle}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
      {/* v3.6.5: invisible thicker path por cima do BaseEdge pra capturar
          double-click (mais fácil de acertar). Não estiliza, só serve de hit area. */}
      <path
        d={svgPath}
        stroke="transparent"
        strokeWidth={18}
        fill="none"
        style={{ pointerEvents: 'stroke', cursor: 'crosshair' }}
        onDoubleClick={handleEdgeDoubleClick}
      />
      {/* Waypoint handles (drag/remove) */}
      {showWaypointControls && waypoints && waypoints.map((wp, idx) => (
        <EdgeLabelRenderer key={`wp-${idx}`}>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${wp[0]}px, ${wp[1]}px)`,
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#3b82f6',
              border: '2px solid white',
              boxShadow: '0 0 0 1px #3b82f6',
              cursor: 'grab',
              pointerEvents: 'all',
              zIndex: 10,
            }}
            className="nodrag nopan"
            onMouseDown={(e) => onWaypointMouseDown(e, idx)}
            onContextMenu={(e) => onWaypointContextMenu(e, idx)}
            title="Arrastar pra mover · botão direito pra remover"
          />
        </EdgeLabelRenderer>
      ))}
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

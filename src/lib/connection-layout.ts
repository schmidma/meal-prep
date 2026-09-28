export type ConnectionRect = {
  left: number;
  right: number;
  top: number;
  height: number;
};
export type ConnectionAnchor = { day: string; rect: ConnectionRect; y?: number };
export type ConnectionColumn = { day: string; left: number; right: number };
export type ConnectionPoint = { x: number; y: number };
export type ConnectionRoute = { d: string; points: ConnectionPoint[] };

/** Geometry only: typography and label collisions never influence a food path. */
export function routeConnection(
  source: ConnectionAnchor,
  target: ConnectionAnchor,
  columns: ConnectionColumn[],
  canvas: { left: number; top: number; right: number; bottom?: number },
  track?: { index: number; count: number },
  obstacles: ConnectionRect[] = []
): ConnectionRoute | null {
  const from = columns.findIndex((column) => column.day === source.day);
  const to = columns.findIndex((column) => column.day === target.day);
  if (from < 0 || to < 0) return null;
  const sameDay = from === to;
  const forward = to > from;
  // Keep every track inside its measured gutter, including the trailing rail.
  const rail = (index: number) => {
    const left = columns[index].right;
    const right = columns[index + 1]?.left ?? canvas.right;
    const spread = Math.min(18, Math.max(0, right - left - 4));
    return (
      (left + right) / 2 -
      canvas.left +
      (track ? ((track.index + 1) / (track.count + 1) - 0.5) * spread : 0)
    );
  };
  const firstRail = rail(!sameDay && !forward ? from - 1 : from);
  const lastRail = rail(sameDay || !forward ? to : to - 1);
  const x1 = (sameDay || forward ? source.rect.right : source.rect.left) - canvas.left;
  const x2 = (sameDay || !forward ? target.rect.right : target.rect.left) - canvas.left;
  const y1 =
    source.y !== undefined
      ? source.y - canvas.top
      : source.rect.top - canvas.top + Math.min(source.rect.height / 2, 22);
  const y2 =
    target.y !== undefined
      ? target.y - canvas.top
      : target.rect.top - canvas.top + Math.min(target.rect.height / 2, 20);
  const points = [
    { x: x1, y: y1 },
    { x: firstRail, y: y1 }
  ];
  if (firstRail !== lastRail) {
    const low = Math.min(y1, y2),
      high = Math.max(y1, y2);
    const left = Math.min(firstRail, lastRail) + canvas.left;
    const right = Math.max(firstRail, lastRail) + canvas.left;
    const crossed = obstacles.filter((rect) => rect.right > left && rect.left < right);
    // All crossings inside the endpoint range have equal Manhattan length. Prefer
    // an endpoint (fewer bends), then the closest actual obstacle boundary.
    const boundaries = crossed.flatMap((rect) => [
      rect.top - canvas.top - 4,
      rect.top + rect.height - canvas.top + 4
    ]);
    const candidates = [y1, y2, ...boundaries]
      .filter((y) => y >= low && y <= high)
      .sort((a, b) => Math.abs(a - y1) - Math.abs(b - y1));
    const beyondSpan = (y: number) => Math.max(low - y, y - high, 0);
    const boundedDetours = boundaries
      .filter(
        (y) =>
          beyondSpan(y) > 0 &&
          beyondSpan(y) <= 12 &&
          y >= 0 &&
          y <= (canvas.bottom === undefined ? Infinity : canvas.bottom - canvas.top - 2)
      )
      .sort((a, b) => beyondSpan(a) - beyondSpan(b) || Math.abs(a - y1) - Math.abs(b - y1));
    const clear = (y: number) =>
      !crossed.some(
        (rect) => y > rect.top - canvas.top - 3 && y < rect.top + rect.height - canvas.top + 3
      );
    // A full-height blocker is not a reason to detour hours away. Keep a bounded
    // crossing even when no unobstructed horizontal corridor exists.
    const crossing =
      candidates.find(clear) ??
      // A small clear detour is preferable to implying a connection through an unrelated card.
      boundedDetours.find(clear) ??
      (low === high
        ? Math.max(0, y1 - (track ? ((track.index + 1) / (track.count + 1)) * 12 : 0))
        : (y1 + y2) / 2);
    points.push({ x: firstRail, y: crossing }, { x: lastRail, y: crossing });
  }
  points.push({ x: lastRail, y: y2 }, { x: x2, y: y2 });
  const distinct = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y
  );
  return {
    d: distinct
      .map((point, index) =>
        index === 0
          ? `M${point.x},${point.y}`
          : point.x === distinct[index - 1].x
            ? `V${point.y}`
            : `H${point.x}`
      )
      .join(' '),
    points: distinct
  };
}

/** Labels are optional annotations of an already final route, never routing obstacles. */
export function placeConnectionLabel(
  route: ConnectionRoute,
  width: number,
  bounds: { left: number; right: number; top: number; bottom: number },
  obstacles: ConnectionRect[],
  occupied: ConnectionRect[]
): { x: number; y: number; rect: ConnectionRect } | null {
  const height = 20;
  const candidates: ConnectionPoint[] = [];
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1],
      b = route.points[index];
    if (a.y === b.y) {
      if (Math.abs(a.x - b.x) >= width) {
        for (const dy of [-7, 19]) candidates.push({ x: (a.x + b.x) / 2, y: a.y + dy });
      }
    } else {
      const low = Math.min(a.y, b.y),
        high = Math.max(a.y, b.y);
      for (const y of [(low + high) / 2, low + 26, high - 10]) {
        if (y < low || y > high) continue;
        for (const sign of [-1, 1]) candidates.push({ x: a.x + sign * (width / 2 + 7), y });
      }
    }
  }
  for (const point of candidates) {
    const rect = {
      left: point.x - width / 2,
      right: point.x + width / 2,
      top: point.y - 15,
      height
    };
    if (
      rect.left < bounds.left ||
      rect.right > bounds.right ||
      rect.top < bounds.top ||
      rect.top + height > bounds.bottom
    )
      continue;
    if (
      [...obstacles, ...occupied].some(
        (other) =>
          rect.right + 3 > other.left &&
          rect.left - 3 < other.right &&
          rect.top + height + 3 > other.top &&
          rect.top - 3 < other.top + other.height
      )
    )
      continue;
    return { ...point, rect };
  }
  return null;
}

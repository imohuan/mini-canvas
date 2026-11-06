/**
 * edgeGeometry —— 自定义边几何纯逻辑（无 Vue 依赖，可独立单测）。
 *
 * 移植自 v1 `components/CustomEdge.vue` 的路径/采样算法（金标准 core-node-contract §6.3），
 * 把 v1 里对 `canvas.state.core.*` 的读取参数化为显式入参，使组件不再耦合 pinia store。
 * 覆盖：Position 方向、bezier/straight/step/smoothstep 路径、折点、圆角、采样(供箭头/剪切钮)。
 *
 * 注意：行为必须与 v1 逐字节一致，禁止"顺手改进"几何。
 */

export type EdgeType =
  | "bezier"
  | "straight"
  | "step"
  | "smoothstep"
  | "adaptive"
  | "avoid";

export const Position = {
  Left: "left",
  Right: "right",
  Top: "top",
  Bottom: "bottom",
} as const;
export type Position = (typeof Position)[keyof typeof Position];

export interface XYPosition {
  x: number;
  y: number;
}

export interface EdgeAppearance {
  /** bezier 最小曲率半径（px），v1 恒定 80 */
  minCurvature?: number;
  /** step 直线段伸出偏移（px），v1 edgeStepOffset=20 */
  stepOffset?: number;
  /** smoothstep 圆角半径（px），v1 edgeSmoothRadius=5 */
  smoothRadius?: number;
  /** 正交避障：节点矩形向外扩的边距（px） */
  avoidMargin?: number;
  /** 正交避障：拐角圆角半径（px） */
  avoidRadius?: number;
  /** 正交避障：连线与节点安全区之间再留的间距（px） */
  avoidClearance?: number;
}

const DEFAULT_APPEARANCE: Required<EdgeAppearance> = {
  minCurvature: 80,
  stepOffset: 20,
  smoothRadius: 5,
  avoidMargin: 18,
  avoidRadius: 8,
  avoidClearance: 6,
};

/** 正交避障的障碍矩形（flow 坐标） */
export interface EdgeObstacle {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 本矩形单独的外扩距离（px）。缺省 = 使用 EdgeAppearance.avoidMargin。
   * 边自身的两端卡片同样外扩，它们"上下左右"都必须和普通节点一样留出安全区。
   * 空间不足时由几何层按可用缝隙自动收窄（见 buildAvoidGeometry 的端点裁剪）。
   */
  inflate?: number;
  /** 本矩形是否是这条边的端点卡片（会按可用空间收窄外扩，不挤死通路） */
  endpoint?: boolean;
  /** 端点角色：source / target（面对面方向与缝隙计算要用） */
  role?: "source" | "target";
  /**
   * 端点卡片的"开口方向"：端口所在那一侧不封口（安全区不覆盖出线口），
   * 其余三边仍保留完整边距。列表中的字符串是省略方向，如 ['right']。
   */
  open?: Position[];
}

/**
 * 把节点矩形整理成避障输入。
 *
 * 两端卡片**也要**参与避障（与普通节点同口径，四向外扩）：
 * 之前把它们整个排除，路线就会从目标卡片背后穿过，最后一段被卡片挡住，
 * 看起来像"右侧端口连到了右侧端口"。
 * 端点卡片打 endpoint 标记：几何层会保证端口能出线，缝隙不够时只收窄端点自身的边距，
 * 不牺牲路径与普通节点之间的安全区。
 */
export function resolveEdgeObstacles(
  rects: ReadonlyArray<EdgeObstacle>,
  endpointIds: ReadonlyArray<string | undefined>,
  options: {
    liveOffsets?: ReadonlyMap<string, { dx: number; dy: number }>;
    isTransparent?: (id: string) => boolean;
    /** 端点开口方向：source 端口省略它所在的边，target 端口同理 */
    openEndpoints?: ReadonlyArray<Position | undefined>;
  } = {},
): EdgeObstacle[] {
  const endpoints = new Set(endpointIds.filter((id): id is string => Boolean(id)));
  const offsets = options.liveOffsets;
  const opens = new Map<string, Position[]>();
  endpointIds.forEach((id, index) => {
    const open = options.openEndpoints?.[index];
    if (id && open) opens.set(id, [open]);
  });
  return rects
    .filter((rect) => !(rect.id && options.isTransparent?.(rect.id)))
    .map((rect) => {
      const live = rect.id ? offsets?.get(rect.id) : undefined;
      return {
        ...rect,
        x: rect.x + (live?.dx ?? 0),
        y: rect.y + (live?.dy ?? 0),
        ...(rect.id && endpoints.has(rect.id)
          ? {
              endpoint: true,
              role: rect.id === endpointIds[0] ? ("source" as const) : ("target" as const),
              ...(opens.has(rect.id) ? { open: opens.get(rect.id) } : {}),
            }
          : {}),
      };
    });
}

/**
 * 按四个方向分别外扩（端点卡片可以只开一个口）。
 *
 * open 里的方向不扩，其余方向用对应 pad；这样"面对面"端口只收窄水平方向，
 * 上下仍保留完整安全区，不会出现"只有 X 轴有边距、Y 轴没有"。
 */
export function expandObstacle(
  rect: EdgeObstacle,
  pad: number,
  options: {
    /** 四个方向统一值（缺省 pad） */
    padX?: number;
    padY?: number;
    /** 不扩的方向（端点端口所在边） */
    open?: Position[];
  } = {},
): EdgeObstacle {
  const open = new Set(options.open ?? []);
  const padX = options.padX ?? pad;
  const padY = options.padY ?? pad;
  const left = open.has(Position.Left) ? 0 : padX;
  const right = open.has(Position.Right) ? 0 : padX;
  const top = open.has(Position.Top) ? 0 : padY;
  const bottom = open.has(Position.Bottom) ? 0 : padY;
  return {
    ...rect,
    x: rect.x - left,
    y: rect.y - top,
    w: rect.w + left + right,
    h: rect.h + top + bottom,
  };
}

const handleDirections: Record<Position, XYPosition> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

function getDirection({
  source,
  sourcePosition = Position.Bottom,
  target,
}: {
  source: XYPosition;
  sourcePosition: Position;
  target: XYPosition;
}): XYPosition {
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }
  return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 };
}

function dist(a: XYPosition, b: XYPosition) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function getSimpleEdgeCenter({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}): [number, number, number, number] {
  const xOffset = Math.abs(targetX - sourceX) / 2;
  const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset;
  const yOffset = Math.abs(targetY - sourceY) / 2;
  const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset;
  return [centerX, centerY, xOffset, yOffset];
}

/** 把 VueFlow 的 position 字符串归一成 Position；无法识别回 null */
export function normalizePosition(position?: string | null): Position | null {
  const v = String(position || "").toLowerCase();
  if (v.includes("left")) return Position.Left;
  if (v.includes("right")) return Position.Right;
  if (v.includes("top")) return Position.Top;
  if (v.includes("bottom")) return Position.Bottom;
  return null;
}

/** source 端口位置：handle==='source' → Right，否则取 position ?? Right */
export function getSourcePosition(
  position?: string | null,
  handle?: string | null,
): Position {
  if (handle === "source") return Position.Right;
  return normalizePosition(position) ?? Position.Right;
}

/** target 端口位置：handle==='target' → Left，否则取 position ?? Left */
export function getTargetPosition(
  position?: string | null,
  handle?: string | null,
): Position {
  if (handle === "target") return Position.Left;
  return normalizePosition(position) ?? Position.Left;
}

/**
 * Port of vue-flow getPoints — computes intermediate junction points for step/smoothstep edges.
 */
function getPoints({
  source,
  sourcePosition,
  target,
  targetPosition,
  center,
  offset,
}: {
  source: XYPosition;
  sourcePosition: Position;
  target: XYPosition;
  targetPosition: Position;
  center: Partial<XYPosition>;
  offset: number;
}): [XYPosition[], number, number] {
  const sourceDir = handleDirections[sourcePosition];
  const targetDir = handleDirections[targetPosition];
  const sourceGapped: XYPosition = {
    x: source.x + sourceDir.x * offset,
    y: source.y + sourceDir.y * offset,
  };
  const targetGapped: XYPosition = {
    x: target.x + targetDir.x * offset,
    y: target.y + targetDir.y * offset,
  };
  const dir = getDirection({
    source: sourceGapped,
    sourcePosition,
    target: targetGapped,
  });
  const dirAccessor = dir.x !== 0 ? "x" : "y";
  const currDir = dir[dirAccessor];

  let points: XYPosition[];
  let labelX: number, labelY: number;

  const sourceGapOffset: XYPosition = { x: 0, y: 0 };
  const targetGapOffset: XYPosition = { x: 0, y: 0 };

  const [defaultCenterX, defaultCenterY] = getSimpleEdgeCenter({
    sourceX: source.x,
    sourceY: source.y,
    targetX: target.x,
    targetY: target.y,
  });

  // opposite handle positions
  if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
    const cx = center.x ?? defaultCenterX;
    const cy = center.y ?? defaultCenterY;
    const verticalSplit: XYPosition[] = [
      { x: cx, y: sourceGapped.y },
      { x: cx, y: targetGapped.y },
    ];
    const horizontalSplit: XYPosition[] = [
      { x: sourceGapped.x, y: cy },
      { x: targetGapped.x, y: cy },
    ];
    if (sourceDir[dirAccessor] === currDir) {
      points = dirAccessor === "x" ? verticalSplit : horizontalSplit;
    } else {
      points = dirAccessor === "x" ? horizontalSplit : verticalSplit;
    }
    labelX = cx;
    labelY = cy;
  } else {
    // same side or mixed handle positions
    const sourceTarget: XYPosition[] = [
      { x: sourceGapped.x, y: targetGapped.y },
    ];
    const targetSource: XYPosition[] = [
      { x: targetGapped.x, y: sourceGapped.y },
    ];

    if (dirAccessor === "x") {
      points = sourceDir.x === currDir ? targetSource : sourceTarget;
    } else {
      points = sourceDir.y === currDir ? sourceTarget : targetSource;
    }

    if (sourcePosition === targetPosition) {
      const diff = Math.abs(source[dirAccessor] - target[dirAccessor]);
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff);
        if (sourceDir[dirAccessor] === currDir) {
          const sign = sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1;
          sourceGapOffset[dirAccessor] = sign * gapOffset;
        } else {
          const sign = targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1;
          targetGapOffset[dirAccessor] = sign * gapOffset;
        }
      }
    }

    if (sourcePosition !== targetPosition) {
      const dirAccOpp = dirAccessor === "x" ? "y" : "x";
      const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccOpp];
      const sourceGt = sourceGapped[dirAccOpp] > targetGapped[dirAccOpp];
      const sourceLt = sourceGapped[dirAccOpp] < targetGapped[dirAccOpp];
      const flip =
        (sourceDir[dirAccessor] === 1 &&
          ((!isSameDir && sourceGt) || (isSameDir && sourceLt))) ||
        (sourceDir[dirAccessor] !== 1 &&
          ((!isSameDir && sourceLt) || (isSameDir && sourceGt)));
      if (flip) {
        points = dirAccessor === "x" ? sourceTarget : targetSource;
      }
    }

    const sourceGapPoint = {
      x: sourceGapped.x + sourceGapOffset.x,
      y: sourceGapped.y + sourceGapOffset.y,
    };
    const targetGapPoint = {
      x: targetGapped.x + targetGapOffset.x,
      y: targetGapped.y + targetGapOffset.y,
    };
    const maxX = Math.max(
      Math.abs(sourceGapPoint.x - points[0].x),
      Math.abs(targetGapPoint.x - points[0].x),
    );
    const maxY = Math.max(
      Math.abs(sourceGapPoint.y - points[0].y),
      Math.abs(targetGapPoint.y - points[0].y),
    );
    if (maxX >= maxY) {
      labelX = (sourceGapPoint.x + targetGapPoint.x) / 2;
      labelY = points[0].y;
    } else {
      labelX = points[0].x;
      labelY = (sourceGapPoint.y + targetGapPoint.y) / 2;
    }
  }

  const pathPoints = [
    source,
    {
      x: sourceGapped.x + sourceGapOffset.x,
      y: sourceGapped.y + sourceGapOffset.y,
    },
    ...points,
    {
      x: targetGapped.x + targetGapOffset.x,
      y: targetGapped.y + targetGapOffset.y,
    },
    target,
  ];

  return [pathPoints, labelX, labelY];
}

function getBend(
  a: XYPosition,
  b: XYPosition,
  c: XYPosition,
  size: number,
): string {
  const bendSize = Math.min(dist(a, b) / 2, dist(b, c) / 2, size);
  const { x, y } = b;
  if ((a.x === x && x === c.x) || (a.y === y && y === c.y)) {
    return `L${x} ${y}`;
  }
  // first segment is horizontal, bend to vertical
  if (a.y === y) {
    const xDir = a.x < c.x ? -1 : 1;
    const yDir = a.y < c.y ? 1 : -1;
    return `L ${x + bendSize * xDir},${y}Q ${x},${y} ${x},${y + bendSize * yDir}`;
  }
  // first segment is vertical, bend to horizontal
  const xDir = a.x < c.x ? 1 : -1;
  const yDir = a.y < c.y ? -1 : 1;
  return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`;
}

interface PathSegment {
  kind: "line" | "quad";
  a: XYPosition;
  b: XYPosition;
  c?: XYPosition;
}

function directionOf(position: Position): XYPosition {
  return handleDirections[position];
}

/**
 * 自适应贝塞尔：控制点沿端口法线伸出，长度随实际缝宽收缩。
 *
 * 原版固定最小曲率 80px；两个端口只隔十几像素时，c1/c2 会越过彼此，曲线先鼓出去再折回。
 * 这里对"面对面"的端口取轴向距离的一半，从数学上保证控制点不交叉；其它朝向按弦长取比例。
 */
function adaptiveControlPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
): { c1: XYPosition; c2: XYPosition } {
  const s = { x: sourceX, y: sourceY };
  const t = { x: targetX, y: targetY };
  const sd = directionOf(sourcePosition);
  const td = directionOf(targetPosition);
  const chord = dist(s, t);
  const facing = sd.x * td.x + sd.y * td.y < -0.5;
  const axial = (t.x - s.x) * sd.x + (t.y - s.y) * sd.y;
  let kS: number;
  let kT: number;

  if (facing && axial >= 0) {
    const halfGap = Math.min(axial * 0.5, 180);
    kS = halfGap;
    kT = halfGap;
  } else if (facing) {
    kS = Math.min(Math.max(chord * 0.32, 28), 140);
    kT = kS;
  } else {
    kS = Math.min(Math.max(chord * 0.32, 22), 140);
    kT = kS;
  }

  return {
    c1: { x: s.x + sd.x * kS, y: s.y + sd.y * kS },
    c2: { x: t.x + td.x * kT, y: t.y + td.y * kT },
  };
}

function buildAdaptivePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
): string {
  const { c1, c2 } = adaptiveControlPoints(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  );
  return `M ${sourceX} ${sourceY} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${targetX} ${targetY}`;
}

function pointInsideRect(point: XYPosition, rect: EdgeObstacle, pad: number): boolean {
  const x1 = rect.x + pad;
  const y1 = rect.y + pad;
  const x2 = rect.x + rect.w - pad;
  const y2 = rect.y + rect.h - pad;
  return point.x > x1 && point.x < x2 && point.y > y1 && point.y < y2;
}

/** 轴对齐线段是否穿过矩形内部（Liang-Barsky；贴边不算穿过） */
function segmentIntersectsRect(
  a: XYPosition,
  b: XYPosition,
  rect: EdgeObstacle,
  pad: number,
): boolean {
  const x1 = rect.x + pad;
  const y1 = rect.y + pad;
  const x2 = rect.x + rect.w - pad;
  const y2 = rect.y + rect.h - pad;
  if (x2 <= x1 || y2 <= y1) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const ps = [-dx, dx, -dy, dy];
  const qs = [a.x - x1, x2 - a.x, a.y - y1, y2 - a.y];
  for (let i = 0; i < 4; i++) {
    const p = ps[i];
    const q = qs[i];
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 < t1 - 1e-7;
}


/**
 * 从端口沿法线找一个"出线桩"点：距离尽量大，但不能落进任何外扩矩形。
 *
 * 面对面端口缝很窄、边距又大时，固定 30px 桩会直接伸进对面卡片的安全区，
 * A* 连起点都不合法，就会整条回退成贝塞尔（用户看到的"避障失效"）。
 * 这里从期望距离往回试，保证桩点总在障碍之外。
 */
function pickStubPoint(
  port: XYPosition,
  dir: XYPosition,
  maxDistance: number,
  obstacles: ReadonlyArray<EdgeObstacle>,
): XYPosition {
  for (let d = Math.max(1, maxDistance); d >= 1; d--) {
    const point = { x: port.x + dir.x * d, y: port.y + dir.y * d };
    let blocked = false;
    for (const rect of obstacles) {
      if (pointInsideRect(point, rect, 0.35) || segmentIntersectsRect(port, point, rect, 0.45)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return point;
  }
  return { x: port.x + dir.x, y: port.y + dir.y };
}

function uniqueSorted(values: number[]): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (!out.length || Math.abs(value - out[out.length - 1]) > 0.001) out.push(value);
  }
  return out;
}

function withMidpoints(values: number[]): number[] {
  const base = uniqueSorted(values);
  if (!base.length) return [];
  const out = [base[0]];
  for (let i = 1; i < base.length; i++) {
    if (base[i] - base[i - 1] > 2) out.push((base[i - 1] + base[i]) / 2);
    out.push(base[i]);
  }
  return out;
}

interface MinHeapItem {
  key: number;
  g: number;
  f: number;
}

class MinHeap {
  private items: MinHeapItem[] = [];
  size(): number {
    return this.items.length;
  }
  push(item: MinHeapItem): void {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (items[parent].f <= items[index].f) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }
  pop(): MinHeapItem | null {
    const items = this.items;
    if (!items.length) return null;
    const top = items[0];
    const last = items.pop() as MinHeapItem;
    if (items.length) {
      items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left].f < items[smallest].f) smallest = left;
        if (right < items.length && items[right].f < items[smallest].f) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
    return top;
  }
}

/**
 * 在"端点 + 障碍边界"组成的稀疏网格上跑 A*，只走水平/垂直边。
 * 返回从 start 到 end 的正交折线；无路可走返回 null。
 */
function routeOrthogonal(
  start: XYPosition,
  end: XYPosition,
  obstacles: ReadonlyArray<EdgeObstacle>,
): XYPosition[] | null {
  if (dist(start, end) < 0.5) return [start, end];
  const baseXs = [start.x, end.x];
  const baseYs = [start.y, end.y];
  for (const rect of obstacles) {
    baseXs.push(rect.x, rect.x + rect.w);
    baseYs.push(rect.y, rect.y + rect.h);
  }
  const xs = withMidpoints(baseXs);
  const ys = withMidpoints(baseYs);
  const nx = xs.length;
  const ny = ys.length;
  if (!nx || !ny) return null;
  const startIx = xs.findIndex((x) => Math.abs(x - start.x) < 0.001);
  const endIx = xs.findIndex((x) => Math.abs(x - end.x) < 0.001);
  const startIy = ys.findIndex((y) => Math.abs(y - start.y) < 0.001);
  const endIy = ys.findIndex((y) => Math.abs(y - end.y) < 0.001);
  if (startIx < 0 || startIy < 0 || endIx < 0 || endIy < 0) return null;

  const pointAt = (pointIndex: number): XYPosition => ({
    x: xs[pointIndex % nx],
    y: ys[Math.floor(pointIndex / nx)],
  });
  const pointValid = (pointIndex: number): boolean => {
    const point = pointAt(pointIndex);
    for (const rect of obstacles) {
      if (pointInsideRect(point, rect, 0.35)) return false;
    }
    return true;
  };
  const segmentClear = (a: XYPosition, b: XYPosition): boolean => {
    for (const rect of obstacles) {
      if (segmentIntersectsRect(a, b, rect, 0.45)) return false;
    }
    return true;
  };

  const startPointIndex = startIy * nx + startIx;
  const endPointIndex = endIy * nx + endIx;
  if (!pointValid(startPointIndex) || !pointValid(endPointIndex)) return null;

  const pointCount = nx * ny;
  const stateCount = pointCount * 5;
  const distances = new Float64Array(stateCount);
  const parents = new Int32Array(stateCount);
  const closed = new Uint8Array(stateCount);
  distances.fill(Infinity);
  parents.fill(-1);

  const startState = startPointIndex * 5 + 4;
  const endPoint = pointAt(endPointIndex);
  distances[startState] = 0;
  const heap = new MinHeap();
  heap.push({
    key: startState,
    g: 0,
    f: Math.abs(start.x - endPoint.x) + Math.abs(start.y - endPoint.y),
  });
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const turnPenalty = 28;
  let goal = -1;

  while (heap.size()) {
    const item = heap.pop() as MinHeapItem;
    if (closed[item.key]) continue;
    if (item.g > distances[item.key] + 1e-6) continue;
    closed[item.key] = 1;
    const pointIndex = Math.floor(item.key / 5);
    const prevDir = item.key % 5;
    if (pointIndex === endPointIndex) {
      goal = item.key;
      break;
    }
    const current = pointAt(pointIndex);
    const currentIx = pointIndex % nx;
    const currentIy = Math.floor(pointIndex / nx);
    for (let d = 0; d < 4; d++) {
      const dir = dirs[d];
      const nextIx = currentIx + dir.dx;
      const nextIy = currentIy + dir.dy;
      if (nextIx < 0 || nextIx >= nx || nextIy < 0 || nextIy >= ny) continue;
      const nextPointIndex = nextIy * nx + nextIx;
      if (!pointValid(nextPointIndex)) continue;
      const nextPoint = pointAt(nextPointIndex);
      if (!segmentClear(current, nextPoint)) continue;
      const nextState = nextPointIndex * 5 + d;
      let cost = dist(current, nextPoint);
      if (prevDir !== 4 && prevDir !== d) cost += turnPenalty;
      const nextG = item.g + cost;
      if (nextG + 1e-6 >= distances[nextState]) continue;
      distances[nextState] = nextG;
      parents[nextState] = item.key;
      heap.push({
        key: nextState,
        g: nextG,
        f: nextG + Math.abs(nextPoint.x - endPoint.x) + Math.abs(nextPoint.y - endPoint.y),
      });
    }
  }

  if (goal < 0) return null;
  const route: XYPosition[] = [];
  let cursor = goal;
  const seen = new Set<number>();
  while (cursor !== -1 && !seen.has(cursor)) {
    seen.add(cursor);
    route.push(pointAt(Math.floor(cursor / 5)));
    if (cursor === startState) break;
    cursor = parents[cursor];
  }
  route.reverse();
  return route;
}

function simplifyOrthogonal(points: XYPosition[]): XYPosition[] {
  const clean: XYPosition[] = [];
  for (const point of points) {
    const last = clean.length ? clean[clean.length - 1] : null;
    if (!last || dist(last, point) > 0.01) clean.push({ x: point.x, y: point.y });
  }
  let changed = true;
  while (changed && clean.length > 2) {
    changed = false;
    for (let i = 1; i < clean.length - 1; i++) {
      const a = clean[i - 1];
      const b = clean[i];
      const c = clean[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 0.01) {
        clean.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return clean;
}

interface AvoidGeometry {
  d: string;
  segments: PathSegment[];
  points: XYPosition[];
  fallback: boolean;
}

/** 正交折线 → 带圆角的 path，同时给出可用于采样的线段/二次曲线列表 */
function buildRoundedOrthogonal(points: XYPosition[], radius: number): AvoidGeometry {
  const clean = simplifyOrthogonal(points);
  if (!clean.length) return { d: "", segments: [], points: [], fallback: false };
  const segments: PathSegment[] = [];
  let d = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const cur = clean[i];
    const next = clean[i + 1];
    const inLen = dist(prev, cur);
    const outLen = dist(cur, next);
    if (inLen < 0.001 || outLen < 0.001) continue;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inUx = (cur.x - prev.x) / inLen;
    const inUy = (cur.y - prev.y) / inLen;
    const outUx = (next.x - cur.x) / outLen;
    const outUy = (next.y - cur.y) / outLen;
    const dot = inUx * outUx + inUy * outUy;
    const beforeCorner = { x: cur.x - inUx * r, y: cur.y - inUy * r };
    if (r < 0.4 || dot < -0.999) {
      segments.push({ kind: "line", a: prev, b: cur });
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const afterCorner = { x: cur.x + outUx * r, y: cur.y + outUy * r };
    segments.push({ kind: "line", a: prev, b: beforeCorner });
    segments.push({ kind: "quad", a: beforeCorner, c: cur, b: afterCorner });
    d += ` L ${beforeCorner.x} ${beforeCorner.y} Q ${cur.x} ${cur.y} ${afterCorner.x} ${afterCorner.y}`;
  }
  const last = clean[clean.length - 1];
  const prevLast = clean.length > 1 ? clean[clean.length - 2] : last;
  segments.push({ kind: "line", a: prevLast, b: last });
  d += ` L ${last.x} ${last.y}`;
  return { d, segments, points: clean, fallback: false };
}

/**
 * 正交避障的"少折点"版本。
 *
 * 不跑网格搜索，而是从端口沿法线拉出两条正交走线：
 *   ① 先横后竖（或先竖后横）
 *   ② 先走远一点再横（避开两张卡的安全区）
 * 在所有"两段直线 + 最多两次转弯"的候选里，挑第一条不穿安全区、且总长最短的。
 * 这样 48px 大边距也只产生 2～3 个折点，不会变成一串小阶梯。
 */
/**
 * 正交避障的"少折点"版本。
 *
 * 不跑网格搜索，而是从端口沿法线拉出两条正交走线：
 *   ① 先横后竖（或先竖后横）
 *   ② 先走远一点再横（避开两张卡的安全区）
 * 在所有"两段直线 + 最多两次转弯"的候选里，挑第一条不穿安全区、且总长最短的。
 * 这样 48px 大边距也只产生 2～3 个折点，不会变成一串小阶梯。
 */
/**
 * 正交避障的"少折点"版本。
 *
 * 优先用 2～4 个折点的正交折线：端口出线后直接连、从两卡缝隙穿过、或绕到所有安全区外侧；
 * 只有这些候选全都不通时，才退回稀疏网格 A*。这样 48px 大边距也只产生少量折点。
 */
function buildAvoidGeometry(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  appearance: Required<EdgeAppearance>,
  obstacles: ReadonlyArray<EdgeObstacle> | undefined,
): AvoidGeometry {
  const margin = Math.max(0, appearance.avoidMargin);
  const clearance = Math.max(0, appearance.avoidClearance);
  // 连线离节点矩形边缘的距离 = 避障边距 + 连线留白。
  const pad = margin + clearance;
  const sd = directionOf(sourcePosition);
  const td = directionOf(targetPosition);
  const list = obstacles ?? [];
  // 出线桩要用**原始**卡片矩形算（外扩前的），否则会多退一次 pad。
  const rawSource = list.find((r) => r.role === "source");
  const rawTarget = list.find((r) => r.role === "target");

  // 所有卡片（含两端）四边统一按 pad 外扩，端口侧不留整边开口 ——
  // 留开口会让路径贴着卡片边框走（用户截图的重合问题）。
  const rects = list.map((rect) => {
    if (rect.role === "source" || rect.role === "target" || rect.endpoint) {
      return expandObstacle(rect, pad);
    }
    return expandObstacle(rect, Math.max(0, rect.inflate ?? pad));
  });

  // 出线桩：从端口沿法线直接放到"自己卡片 + pad + 12"之外。
  const stubFor = (rect: EdgeObstacle | undefined, x: number, y: number, dir: XYPosition): XYPosition => {
    // 桩点 = 端口沿法线走出 "自己卡片外侧 + pad + 12"。
    // 这里用原始卡片矩形（未外扩），避免边距被重复计算。
    const gapToOuter = pad + 12;
    if (!rect) {
      return { x: x + dir.x * gapToOuter, y: y + dir.y * gapToOuter };
    }
    if (dir.x > 0) return { x: Math.max(x + gapToOuter, rect.x + rect.w + pad + 12), y };
    if (dir.x < 0) return { x: Math.min(x - gapToOuter, rect.x - pad - 12), y };
    if (dir.y > 0) return { x, y: Math.max(y + gapToOuter, rect.y + rect.h + pad + 12) };
    if (dir.y < 0) return { x, y: Math.min(y - gapToOuter, rect.y - pad - 12) };
    return { x: x + dir.x * gapToOuter, y: y + dir.y * gapToOuter };
  };
  const start = stubFor(rawSource, sourceX, sourceY, sd);
  const end = stubFor(rawTarget, targetX, targetY, td);

  const candidates: XYPosition[][] = [];
  const priorities: number[] = [];
  const push = (mid: XYPosition[], priority: number): void => {
    const points = [{ x: sourceX, y: sourceY }, ...mid, { x: targetX, y: targetY }];
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1];
      const b = points[i];
      const c = points[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) > 0.001) {
        candidates.push(simplifyOrthogonal(points));
        priorities.push(priority);
        return;
      }
    }
  };

  push([start, { x: end.x, y: start.y }, end], 3);
  push([start, { x: start.x, y: end.y }, end], 3);

  for (const a of rects) {
    for (const c of rects) {
      if (a === c) continue;
      if (c.y > a.y + a.h) {
        const line = (a.y + a.h + c.y) / 2;
        push([start, { x: start.x, y: line }, { x: end.x, y: line }, end], 0);
      }
      if (c.x > a.x + a.w) {
        const line = (a.x + a.w + c.x) / 2;
        push([start, { x: line, y: start.y }, { x: line, y: end.y }, end], 0);
      }
    }
  }

  if (rects.length) {
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    // rects 已经是外扩后的安全区，这里直接用边界，不能再减一次 pad（否则边距会被算两遍）。
    push([start, { x: start.x, y: minY }, { x: end.x, y: minY }, end], 1);
    push([start, { x: start.x, y: maxY }, { x: end.x, y: maxY }, end], 1);
    push([start, { x: minX, y: start.y }, { x: minX, y: end.y }, end], 1);
    push([start, { x: maxX, y: start.y }, { x: maxX, y: end.y }, end], 1);
  }

  // 只允许跳过"端口→出线桩"那一小段（垂直于卡边、必然穿过自己的安全区）。
  // 其余段（含最后一段）一律不许进入任何安全区，否则会从卡片内部穿回去。
  const blocked = (points: XYPosition[], strict: boolean): boolean => {
    for (let i = 1; i < points.length; i++) {
      for (const rect of rects) {
        const raw = list.find((r) => r.id === rect.id)
        // 端口那一段允许穿过"自己"的安全区，但只允许沿端口法线方向穿（垂直于卡边）；
        // 斜着穿或横着穿回卡片仍然禁止，否则线会穿进卡片内部或贴边行走。
        if (raw && raw.role === "source" && i === 1 && sd.x * (points[1].x - points[0].x) + sd.y * (points[1].y - points[0].y) > 0) {
          if (segmentIntersectsRect(points[i - 1], points[i], raw, 0.5)) return true
          continue
        }
        if (raw && raw.role === "target" && i === points.length - 1 && td.x * (points[i - 1].x - points[i].x) + td.y * (points[i - 1].y - points[i].y) > 0) {
          if (segmentIntersectsRect(points[i - 1], points[i], raw, 0.5)) return true
          continue
        }
        if (segmentIntersectsRect(points[i - 1], points[i], rect, strict ? 0.5 : -0.5)) return true;
        // 即使是被跳过的端口段，也不许穿进卡片本体。
        if (raw && segmentIntersectsRect(points[i - 1], points[i], raw, 0.5)) return true;
      }
    }
    return false;
  };
  const lengthOf = (points: XYPosition[]): number => {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
    return total;
  };
  const pick = (strict: boolean): XYPosition[] | null => {
    const idx = candidates
      .map((points, i) => ({ points, i }))
      .filter(({ points }) => !blocked(points, strict));
    idx.sort((a, b) => priorities[a.i] - priorities[b.i] || lengthOf(a.points) - lengthOf(b.points));
    return idx[0]?.points ?? null;
  };

  let best = pick(true) ?? pick(false);
  if (!best) {
    const grid = routeOrthogonal(start, end, rects);
    if (grid) {
      const gridPts = simplifyOrthogonal([{ x: sourceX, y: sourceY }, ...grid, { x: targetX, y: targetY }]);
      if (!blocked(gridPts, false)) best = gridPts;
    }
  }
  if (!best) {
    // 兜底：所有安全区都放不下，就沿所有卡片的外接框走一条正交路径。
    // 宁可多绕，也不能穿进卡片、更不能贴着边框走。
    if (rects.length) {
      const minX = Math.min(...rects.map((r) => r.x));
      const maxX = Math.max(...rects.map((r) => r.x + r.w));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxY = Math.max(...rects.map((r) => r.y + r.h));
      const around = simplifyOrthogonal([
        { x: sourceX, y: sourceY },
        start,
        { x: start.x, y: minY },
        { x: end.x, y: minY },
        end,
        { x: targetX, y: targetY },
      ]);
      if (around.length > 2) {
        const radius = Math.min(appearance.avoidRadius, Math.max(1, pad * 0.55));
        return buildRoundedOrthogonal(around, radius);
      }
      void maxX;
      void maxY;
    }
    return {
      d: buildAdaptivePath(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition),
      segments: [],
      points: [],
      fallback: true,
    };
  }
  const radius = Math.min(appearance.avoidRadius, Math.max(1, pad * 0.55));
  return buildRoundedOrthogonal(best, radius);
}

function sampleSegments(segments: PathSegment[], t: number): XYPosition {
  if (!segments.length) return { x: 0, y: 0 };
  const lengths: number[] = [];
  let total = 0;
  for (const segment of segments) {
    let length: number;
    if (segment.kind === "line") {
      length = dist(segment.a, segment.b);
    } else {
      length = 0;
      let prev = segment.a;
      for (let i = 1; i <= 8; i++) {
        const u = i / 8;
        const mt = 1 - u;
        const point = {
          x: mt * mt * segment.a.x + 2 * mt * u * segment.c!.x + u * u * segment.b.x,
          y: mt * mt * segment.a.y + 2 * mt * u * segment.c!.y + u * u * segment.b.y,
        };
        length += dist(prev, point);
        prev = point;
      }
    }
    lengths.push(length);
    total += length;
  }
  if (total <= 1e-9) return { x: segments[0].a.x, y: segments[0].a.y };
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const length = lengths[i];
    if (target > length) {
      target -= length;
      continue;
    }
    const u = length <= 1e-9 ? 0 : target / length;
    if (segment.kind === "line") {
      return {
        x: segment.a.x + (segment.b.x - segment.a.x) * u,
        y: segment.a.y + (segment.b.y - segment.a.y) * u,
      };
    }
    const mt = 1 - u;
    return {
      x: mt * mt * segment.a.x + 2 * mt * u * segment.c!.x + u * u * segment.b.x,
      y: mt * mt * segment.a.y + 2 * mt * u * segment.c!.y + u * u * segment.b.y,
    };
  }
  const last = segments[segments.length - 1];
  return { x: last.b.x, y: last.b.y };
}

function buildStepPath(
  params: {
    sourceX: number;
    sourceY: number;
    sourcePosition: Position;
    targetX: number;
    targetY: number;
    targetPosition: Position;
    borderRadius: number;
    centerX?: number;
    centerY?: number;
    offset?: number;
  },
  borderRadius: number,
): [string, XYPosition[]] {
  const app = { ...DEFAULT_APPEARANCE, ...params };
  const offset = params.offset ?? app.stepOffset;
  const {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    centerX,
    centerY,
  } = params;

  const [points] = getPoints({
    source: { x: sourceX, y: sourceY },
    sourcePosition,
    target: { x: targetX, y: targetY },
    targetPosition,
    center: { x: centerX, y: centerY },
    offset,
  });

  const path = points.reduce((res, p, i) => {
    let segment: string;
    if (i > 0 && i < points.length - 1) {
      segment = getBend(points[i - 1], p, points[i + 1], borderRadius);
    } else {
      segment = `${i === 0 ? "M" : "L"}${p.x} ${p.y}`;
    }
    return res + segment;
  }, "");

  return [path, points];
}

/** 生成边的 path d 数据（v1 buildCustomEdgePath 参数化版） */
export function buildEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  edgeType: EdgeType,
  appearance?: EdgeAppearance,
  obstacles?: ReadonlyArray<EdgeObstacle>,
): string {
  const app: Required<EdgeAppearance> = {
    ...DEFAULT_APPEARANCE,
    ...(appearance || {}),
  };
  switch (edgeType) {
    case "adaptive":
      return buildAdaptivePath(
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      );
    case "avoid":
      return buildAvoidGeometry(
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        app,
        obstacles,
      ).d;
    case "straight":
      return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    case "step": {
      const [path] = buildStepPath(
        {
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 0,
          offset: app.stepOffset,
        },
        0,
      );
      return path;
    }
    case "smoothstep": {
      const [path] = buildStepPath(
        {
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: app.smoothRadius,
          offset: app.stepOffset,
        },
        app.smoothRadius,
      );
      return path;
    }
    case "bezier":
    default: {
      const sourceSign = sourcePosition === Position.Left ? -1 : 1;
      const targetSign = targetPosition === Position.Left ? -1 : 1;
      const distX = Math.max(
        Math.abs(targetX - sourceX) * 0.5,
        app.minCurvature,
      );
      const c1x = sourceX + sourceSign * distX;
      const c2x = targetX + targetSign * distX;
      return `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${targetX} ${targetY}`;
    }
  }
}

/** 按 t∈[0,1] 采样路径上的点（v1 sampleCustomEdgePath 参数化版，供箭头/剪切钮） */
export function sampleEdgePath(
  t: number,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  edgeType: EdgeType,
  appearance?: EdgeAppearance,
  obstacles?: ReadonlyArray<EdgeObstacle>,
): XYPosition {
  const app: Required<EdgeAppearance> = {
    ...DEFAULT_APPEARANCE,
    ...(appearance || {}),
  };
  switch (edgeType) {
    case "adaptive": {
      const { c1, c2 } = adaptiveControlPoints(
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
      );
      const mt = 1 - t;
      return {
        x:
          mt ** 3 * sourceX +
          3 * mt ** 2 * t * c1.x +
          3 * mt * t ** 2 * c2.x +
          t ** 3 * targetX,
        y:
          mt ** 3 * sourceY +
          3 * mt ** 2 * t * c1.y +
          3 * mt * t ** 2 * c2.y +
          t ** 3 * targetY,
      };
    }
    case "avoid": {
      const geometry = buildAvoidGeometry(
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        app,
        obstacles,
      );
      if (geometry.fallback) {
        // A* 找不到通路时画的是自适应贝塞尔，采样必须跟着走同一条曲线。
        const { c1, c2 } = adaptiveControlPoints(
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
        );
        const mt = 1 - t;
        return {
          x:
            mt ** 3 * sourceX +
            3 * mt ** 2 * t * c1.x +
            3 * mt * t ** 2 * c2.x +
            t ** 3 * targetX,
          y:
            mt ** 3 * sourceY +
            3 * mt ** 2 * t * c1.y +
            3 * mt * t ** 2 * c2.y +
            t ** 3 * targetY,
        };
      }
      return sampleSegments(geometry.segments, t);
    }
    case "straight":
      return {
        x: sourceX + (targetX - sourceX) * t,
        y: sourceY + (targetY - sourceY) * t,
      };
    case "step":
    case "smoothstep": {
      const borderRadius = edgeType === "smoothstep" ? app.smoothRadius : 0;
      const [, points] = buildStepPath(
        {
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius,
          offset: app.stepOffset,
        },
        borderRadius,
      );
      const total = points.length - 1;
      const segment = Math.min(total - 1, Math.floor(t * total));
      const segStart = segment / total;
      const segT = (t - segStart) * total;
      const from = points[segment];
      const to = points[segment + 1];
      return {
        x: from.x + (to.x - from.x) * segT,
        y: from.y + (to.y - from.y) * segT,
      };
    }
    case "bezier":
    default: {
      const sourceSign = sourcePosition === Position.Left ? -1 : 1;
      const targetSign = targetPosition === Position.Left ? -1 : 1;
      const distX = Math.max(
        Math.abs(targetX - sourceX) * 0.5,
        app.minCurvature,
      );
      const c1x = sourceX + sourceSign * distX;
      const c2x = targetX + targetSign * distX;
      const mt = 1 - t;
      return {
        x:
          mt ** 3 * sourceX +
          3 * mt ** 2 * t * c1x +
          3 * mt * t ** 2 * c2x +
          t ** 3 * targetX,
        y:
          mt ** 3 * sourceY +
          3 * mt ** 2 * t * sourceY +
          3 * mt * t ** 2 * targetY +
          t ** 3 * targetY,
      };
    }
  }
}

/** 在路径上找离屏幕点(mx,my)最近的点（双击剪切钮锚点用，采样 51 点） */
export function findClosestPointOnPath(
  mx: number,
  my: number,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  edgeType: EdgeType,
  appearance?: EdgeAppearance,
  obstacles?: ReadonlyArray<EdgeObstacle>,
): XYPosition {
  let best = { x: 0, y: 0, dist: Infinity };
  for (let i = 0; i <= 50; i++) {
    const p = sampleEdgePath(
      i / 50,
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      edgeType,
      appearance,
      obstacles,
    );
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
    if (d < best.dist) {
      best = { ...p, dist: d };
    }
  }
  return { x: best.x, y: best.y };
}

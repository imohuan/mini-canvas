/**
 * edgeGeometry —— 自定义边几何纯逻辑（无 Vue 依赖，可独立单测）。
 *
 * 移植自 v1 `components/CustomEdge.vue` 的路径/采样算法（金标准 core-node-contract §6.3），
 * 把 v1 里对 `canvas.state.core.*` 的读取参数化为显式入参，使组件不再耦合 pinia store。
 * 覆盖：Position 方向、bezier/straight/step/smoothstep 路径、折点、圆角、采样(供箭头/剪切钮)。
 *
 * 注意：行为必须与 v1 逐字节一致，禁止"顺手改进"几何。
 */

export type EdgeType = 'bezier' | 'straight' | 'step' | 'smoothstep'

export const Position = { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' } as const
export type Position = (typeof Position)[keyof typeof Position]

export interface XYPosition {
  x: number
  y: number
}

export interface EdgeAppearance {
  /** bezier 最小曲率半径（px），v1 恒定 80 */
  minCurvature?: number
  /** step 直线段伸出偏移（px），v1 edgeStepOffset=20 */
  stepOffset?: number
  /** smoothstep 圆角半径（px），v1 edgeSmoothRadius=5 */
  smoothRadius?: number
}

const DEFAULT_APPEARANCE: Required<EdgeAppearance> = {
  minCurvature: 80,
  stepOffset: 20,
  smoothRadius: 5,
}

const handleDirections: Record<Position, XYPosition> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

function getDirection({
  source,
  sourcePosition = Position.Bottom,
  target,
}: {
  source: XYPosition
  sourcePosition: Position
  target: XYPosition
}): XYPosition {
  if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
    return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 }
  }
  return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 }
}

function dist(a: XYPosition, b: XYPosition) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

function getSimpleEdgeCenter({
  sourceX, sourceY, targetX, targetY,
}: { sourceX: number; sourceY: number; targetX: number; targetY: number }): [number, number, number, number] {
  const xOffset = Math.abs(targetX - sourceX) / 2
  const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset
  const yOffset = Math.abs(targetY - sourceY) / 2
  const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset
  return [centerX, centerY, xOffset, yOffset]
}

/** 把 VueFlow 的 position 字符串归一成 Position；无法识别回 null */
export function normalizePosition(position?: string | null): Position | null {
  const v = String(position || '').toLowerCase()
  if (v.includes('left')) return Position.Left
  if (v.includes('right')) return Position.Right
  if (v.includes('top')) return Position.Top
  if (v.includes('bottom')) return Position.Bottom
  return null
}

/** source 端口位置：handle==='source' → Right，否则取 position ?? Right */
export function getSourcePosition(position?: string | null, handle?: string | null): Position {
  if (handle === 'source') return Position.Right
  return normalizePosition(position) ?? Position.Right
}

/** target 端口位置：handle==='target' → Left，否则取 position ?? Left */
export function getTargetPosition(position?: string | null, handle?: string | null): Position {
  if (handle === 'target') return Position.Left
  return normalizePosition(position) ?? Position.Left
}

/**
 * Port of vue-flow getPoints — computes intermediate junction points for step/smoothstep edges.
 */
function getPoints({
  source, sourcePosition, target, targetPosition, center, offset,
}: {
  source: XYPosition; sourcePosition: Position; target: XYPosition; targetPosition: Position
  center: Partial<XYPosition>; offset: number
}): [XYPosition[], number, number] {
  const sourceDir = handleDirections[sourcePosition]
  const targetDir = handleDirections[targetPosition]
  const sourceGapped: XYPosition = { x: source.x + sourceDir.x * offset, y: source.y + sourceDir.y * offset }
  const targetGapped: XYPosition = { x: target.x + targetDir.x * offset, y: target.y + targetDir.y * offset }
  const dir = getDirection({ source: sourceGapped, sourcePosition, target: targetGapped })
  const dirAccessor = dir.x !== 0 ? 'x' : 'y'
  const currDir = dir[dirAccessor]

  let points: XYPosition[]
  let labelX: number, labelY: number

  const sourceGapOffset: XYPosition = { x: 0, y: 0 }
  const targetGapOffset: XYPosition = { x: 0, y: 0 }

  const [defaultCenterX, defaultCenterY] = getSimpleEdgeCenter({
    sourceX: source.x, sourceY: source.y, targetX: target.x, targetY: target.y,
  })

  // opposite handle positions
  if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
    const cx = center.x ?? defaultCenterX
    const cy = center.y ?? defaultCenterY
    const verticalSplit: XYPosition[] = [
      { x: cx, y: sourceGapped.y },
      { x: cx, y: targetGapped.y },
    ]
    const horizontalSplit: XYPosition[] = [
      { x: sourceGapped.x, y: cy },
      { x: targetGapped.x, y: cy },
    ]
    if (sourceDir[dirAccessor] === currDir) {
      points = dirAccessor === 'x' ? verticalSplit : horizontalSplit
    } else {
      points = dirAccessor === 'x' ? horizontalSplit : verticalSplit
    }
    labelX = cx
    labelY = cy
  } else {
    // same side or mixed handle positions
    const sourceTarget: XYPosition[] = [{ x: sourceGapped.x, y: targetGapped.y }]
    const targetSource: XYPosition[] = [{ x: targetGapped.x, y: sourceGapped.y }]

    if (dirAccessor === 'x') {
      points = sourceDir.x === currDir ? targetSource : sourceTarget
    } else {
      points = sourceDir.y === currDir ? sourceTarget : targetSource
    }

    if (sourcePosition === targetPosition) {
      const diff = Math.abs(source[dirAccessor] - target[dirAccessor])
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff)
        if (sourceDir[dirAccessor] === currDir) {
          const sign = sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1
          sourceGapOffset[dirAccessor] = sign * gapOffset
        } else {
          const sign = targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1
          targetGapOffset[dirAccessor] = sign * gapOffset
        }
      }
    }

    if (sourcePosition !== targetPosition) {
      const dirAccOpp = dirAccessor === 'x' ? 'y' : 'x'
      const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccOpp]
      const sourceGt = sourceGapped[dirAccOpp] > targetGapped[dirAccOpp]
      const sourceLt = sourceGapped[dirAccOpp] < targetGapped[dirAccOpp]
      const flip =
        (sourceDir[dirAccessor] === 1 && ((!isSameDir && sourceGt) || (isSameDir && sourceLt))) ||
        (sourceDir[dirAccessor] !== 1 && ((!isSameDir && sourceLt) || (isSameDir && sourceGt)))
      if (flip) {
        points = dirAccessor === 'x' ? sourceTarget : targetSource
      }
    }

    const sourceGapPoint = { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y }
    const targetGapPoint = { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y }
    const maxX = Math.max(Math.abs(sourceGapPoint.x - points[0].x), Math.abs(targetGapPoint.x - points[0].x))
    const maxY = Math.max(Math.abs(sourceGapPoint.y - points[0].y), Math.abs(targetGapPoint.y - points[0].y))
    if (maxX >= maxY) {
      labelX = (sourceGapPoint.x + targetGapPoint.x) / 2
      labelY = points[0].y
    } else {
      labelX = points[0].x
      labelY = (sourceGapPoint.y + targetGapPoint.y) / 2
    }
  }

  const pathPoints = [
    source,
    { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y },
    ...points,
    { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y },
    target,
  ]

  return [pathPoints, labelX, labelY]
}

function getBend(a: XYPosition, b: XYPosition, c: XYPosition, size: number): string {
  const bendSize = Math.min(dist(a, b) / 2, dist(b, c) / 2, size)
  const { x, y } = b
  if ((a.x === x && x === c.x) || (a.y === y && y === c.y)) {
    return `L${x} ${y}`
  }
  // first segment is horizontal, bend to vertical
  if (a.y === y) {
    const xDir = a.x < c.x ? -1 : 1
    const yDir = a.y < c.y ? 1 : -1
    return `L ${x + bendSize * xDir},${y}Q ${x},${y} ${x},${y + bendSize * yDir}`
  }
  // first segment is vertical, bend to horizontal
  const xDir = a.x < c.x ? 1 : -1
  const yDir = a.y < c.y ? -1 : 1
  return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`
}

function buildStepPath(
  params: {
    sourceX: number; sourceY: number; sourcePosition: Position
    targetX: number; targetY: number; targetPosition: Position
    borderRadius: number; centerX?: number; centerY?: number; offset?: number
  },
  borderRadius: number,
): [string, XYPosition[]] {
  const app = { ...DEFAULT_APPEARANCE, ...params }
  const offset = params.offset ?? app.stepOffset
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, centerX, centerY } = params

  const [points] = getPoints({
    source: { x: sourceX, y: sourceY },
    sourcePosition,
    target: { x: targetX, y: targetY },
    targetPosition,
    center: { x: centerX, y: centerY },
    offset,
  })

  const path = points.reduce((res, p, i) => {
    let segment: string
    if (i > 0 && i < points.length - 1) {
      segment = getBend(points[i - 1], p, points[i + 1], borderRadius)
    } else {
      segment = `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`
    }
    return res + segment
  }, '')

  return [path, points]
}

/** 生成边的 path d 数据（v1 buildCustomEdgePath 参数化版） */
export function buildEdgePath(
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  sourcePosition: Position, targetPosition: Position,
  edgeType: EdgeType,
  appearance?: EdgeAppearance,
): string {
  const app: Required<EdgeAppearance> = { ...DEFAULT_APPEARANCE, ...(appearance || {}) }
  switch (edgeType) {
    case 'straight':
      return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
    case 'step': {
      const [path] = buildStepPath(
        { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0, offset: app.stepOffset },
        0,
      )
      return path
    }
    case 'smoothstep': {
      const [path] = buildStepPath(
        {
          sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
          borderRadius: app.smoothRadius, offset: app.stepOffset,
        },
        app.smoothRadius,
      )
      return path
    }
    case 'bezier':
    default: {
      const sourceSign = sourcePosition === Position.Left ? -1 : 1
      const targetSign = targetPosition === Position.Left ? -1 : 1
      const distX = Math.max(Math.abs(targetX - sourceX) * 0.5, app.minCurvature)
      const c1x = sourceX + sourceSign * distX
      const c2x = targetX + targetSign * distX
      return `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${targetX} ${targetY}`
    }
  }
}

/** 按 t∈[0,1] 采样路径上的点（v1 sampleCustomEdgePath 参数化版，供箭头/剪切钮） */
export function sampleEdgePath(
  t: number,
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  sourcePosition: Position, targetPosition: Position,
  edgeType: EdgeType,
  appearance?: EdgeAppearance,
): XYPosition {
  const app: Required<EdgeAppearance> = { ...DEFAULT_APPEARANCE, ...(appearance || {}) }
  switch (edgeType) {
    case 'straight':
      return {
        x: sourceX + (targetX - sourceX) * t,
        y: sourceY + (targetY - sourceY) * t,
      }
    case 'step':
    case 'smoothstep': {
      const borderRadius = edgeType === 'smoothstep' ? app.smoothRadius : 0
      const [, points] = buildStepPath(
        {
          sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
          borderRadius, offset: app.stepOffset,
        },
        borderRadius,
      )
      const total = points.length - 1
      const segment = Math.min(total - 1, Math.floor(t * total))
      const segStart = segment / total
      const segT = (t - segStart) * total
      const from = points[segment]
      const to = points[segment + 1]
      return {
        x: from.x + (to.x - from.x) * segT,
        y: from.y + (to.y - from.y) * segT,
      }
    }
    case 'bezier':
    default: {
      const sourceSign = sourcePosition === Position.Left ? -1 : 1
      const targetSign = targetPosition === Position.Left ? -1 : 1
      const distX = Math.max(Math.abs(targetX - sourceX) * 0.5, app.minCurvature)
      const c1x = sourceX + sourceSign * distX
      const c2x = targetX + targetSign * distX
      const mt = 1 - t
      return {
        x: mt ** 3 * sourceX + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * targetX,
        y: mt ** 3 * sourceY + 3 * mt ** 2 * t * sourceY + 3 * mt * t ** 2 * targetY + t ** 3 * targetY,
      }
    }
  }
}

/** 在路径上找离屏幕点(mx,my)最近的点（双击剪切钮锚点用，采样 51 点） */
export function findClosestPointOnPath(
  mx: number, my: number,
  sourceX: number, sourceY: number, targetX: number, targetY: number,
  sourcePosition: Position, targetPosition: Position,
  edgeType: EdgeType,
  appearance?: EdgeAppearance,
): XYPosition {
  let best = { x: 0, y: 0, dist: Infinity }
  for (let i = 0; i <= 50; i++) {
    const p = sampleEdgePath(i / 50, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, edgeType, appearance)
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2
    if (d < best.dist) {
      best = { ...p, dist: d }
    }
  }
  return { x: best.x, y: best.y }
}

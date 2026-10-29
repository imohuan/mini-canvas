export interface ScreenPoint {
  x: number
  y: number
}

function distancePointToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): number {
  const vx = end.x - start.x
  const vy = end.y - start.y
  const wx = point.x - start.x
  const wy = point.y - start.y
  const lengthSquared = vx * vx + vy * vy
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared))
  const x = start.x + vx * t
  const y = start.y + vy * t
  return Math.hypot(point.x - x, point.y - y)
}

function orientation(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) < Number.EPSILON) return 0
  return value > 0 ? 1 : 2
}

function isPointOnSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): boolean {
  return point.x <= Math.max(start.x, end.x)
    && point.x >= Math.min(start.x, end.x)
    && point.y <= Math.max(start.y, end.y)
    && point.y >= Math.min(start.y, end.y)
}

export function doSegmentsIntersect(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && isPointOnSegment(c, a, b)) return true
  if (o2 === 0 && isPointOnSegment(d, a, b)) return true
  if (o3 === 0 && isPointOnSegment(a, c, d)) return true
  if (o4 === 0 && isPointOnSegment(b, c, d)) return true
  return false
}

export function segmentDistance(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint): number {
  if (doSegmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    distancePointToSegment(a, c, d),
    distancePointToSegment(b, c, d),
    distancePointToSegment(c, a, b),
    distancePointToSegment(d, a, b),
  )
}

export function isPolylineHitByCut(edgePoints: ScreenPoint[], cutPoints: ScreenPoint[], tolerancePx: number): boolean {
  if (edgePoints.length < 2 || cutPoints.length < 2) return false

  for (let edgeIndex = 0; edgeIndex < edgePoints.length - 1; edgeIndex++) {
    for (let cutIndex = 0; cutIndex < cutPoints.length - 1; cutIndex++) {
      if (segmentDistance(
        edgePoints[edgeIndex],
        edgePoints[edgeIndex + 1],
        cutPoints[cutIndex],
        cutPoints[cutIndex + 1],
      ) <= tolerancePx) {
        return true
      }
    }
  }

  return false
}
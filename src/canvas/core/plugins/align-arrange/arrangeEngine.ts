import type { ArrangeDirection } from './types'

interface NodeRect { id: string; x: number; y: number; w: number; h: number }

export function computeArrange(
  nodes: NodeRect[], direction: ArrangeDirection, gap: number,
): Map<string, { x: number; y: number }> {
  if (nodes.length <= 1) return new Map()
  const result = new Map<string, { x: number; y: number }>()

  const minX = Math.min(...nodes.map(n => n.x))
  const minY = Math.min(...nodes.map(n => n.y))
  const maxX = Math.max(...nodes.map(n => n.x + n.w))
  const maxY = Math.max(...nodes.map(n => n.y + n.h))

  const sorted = [...nodes].sort((a, b) => {
    switch (direction) {
      case 'ArrowLeft':  return a.x - b.x
      case 'ArrowRight': return (b.x + b.w) - (a.x + a.w)
      case 'ArrowUp':    return a.y - b.y
      case 'ArrowDown':  return (b.y + b.h) - (a.y + a.h)
      default:           return 0
    }
  })

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]
    if (i === 0) { result.set(curr.id, { x: curr.x, y: curr.y }); continue }

    const obstacles = sorted.slice(0, i).filter(prev => {
      if (direction === 'ArrowLeft' || direction === 'ArrowRight')
        return !(curr.y + curr.h <= prev.y || curr.y >= prev.y + prev.h)
      else
        return !(curr.x + curr.w <= prev.x || curr.x >= prev.x + prev.w)
    })

    let newX = curr.x, newY = curr.y
    if (obstacles.length > 0) {
      switch (direction) {
        case 'ArrowLeft':  newX = Math.max(...obstacles.map(o => result.get(o.id)!.x + o.w)) + gap; break
        case 'ArrowRight': newX = Math.min(...obstacles.map(o => result.get(o.id)!.x)) - curr.w - gap; break
        case 'ArrowUp':    newY = Math.max(...obstacles.map(o => result.get(o.id)!.y + o.h)) + gap; break
        case 'ArrowDown':  newY = Math.min(...obstacles.map(o => result.get(o.id)!.y)) - curr.h - gap; break
      }
    } else {
      switch (direction) {
        case 'ArrowLeft':  newX = minX; break
        case 'ArrowRight': newX = maxX - curr.w; break
        case 'ArrowUp':    newY = minY; break
        case 'ArrowDown':  newY = maxY - curr.h; break
      }
    }
    result.set(curr.id, { x: newX, y: newY })
  }
  return result
}

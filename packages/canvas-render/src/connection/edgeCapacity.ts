/**
 * connection/edgeCapacity.ts —— 输入口容量 + 满额挤出（纯函数，Node 可测）。
 *
 * 语义：某目标节点输入口声明 capacity=N 时，它最多接 N 条入边。当新连接使入边数将超 N，
 * 由调用方在 commit 时"挤最老一条"（FIFO：按 edgeStore 加入序，先入先挤）再加新边。
 *
 * 本模块只做"该挤哪条"的纯决策，不碰 DOM/state；CanvasHost commitEdge 调用它后在同一个
 * history 记录里先 remove 再 addEdge，保证原子、可 undo。
 */
import type { CanvasEdge } from '@mini-canvas/canvas-core-v2'

/**
 * 给定现有边 + 目标节点 + 输入容量，决定要挤掉哪条最老入边。
 * @returns 应移除的边 id；容量未满/无入边可挤 → null。
 */
export function oldestIncomingToEvict(input: {
  edges: CanvasEdge[]
  target: string
  capacity: number
}): string | null {
  const cap = input.capacity > 0 ? input.capacity : 1
  // 目标节点的入边（edge.target === target），按加入序（getEdges 数组序）排列
  const incoming = input.edges.filter((e) => e.target === input.target)
  // 未满（含已等于容量-1 即将满）时新边可直接加，无需挤
  if (incoming.length < cap) return null
  // 满额：挤最老一条（数组序第一）
  const oldest = incoming[0]
  return oldest ? oldest.id : null
}

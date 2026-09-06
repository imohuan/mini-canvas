/**
 * NodeLayoutService —— 节点布局只读服务（渲染层提供、插件/工具消费）。
 *
 * 背景（用户拍板 3A）：节点动态实测宽高不入存储。内核 nodeStore 只存声明/默认尺寸；
 * 渲染层用 ResizeObserver 量测真实 DOM 尺寸后经 setMeasuredSize 注入本服务（内存态，不落盘）。
 *
 * 矩形坐标一律 flow 绝对坐标：子节点 position 相对父，逐级累加父链得绝对坐标。
 */
import type { NodeStoreService } from '@mini-canvas/canvas-core-v2'

export interface LayoutRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export class NodeLayoutService {
  private measured = new Map<string, { w: number; h: number }>()

  constructor(private store: NodeStoreService) {}

  /** 渲染层 ResizeObserver 上报实测尺寸（内存态，不入 store / 不落盘）。 */
  setMeasuredSize(id: string, w: number, h: number): void {
    if (w <= 0 || h <= 0) return
    this.measured.set(id, { w, h })
  }

  /** 节点卸载/消失时清除实测值，防悬挂。 */
  clearMeasuredSize(id: string): void {
    this.measured.delete(id)
  }

  /** 清空全部实测值（重灌/刷新用）。 */
  reset(): void {
    this.measured.clear()
  }

  /** 取某节点的实际尺寸：实测 > node.size > type.defaultSize。 */
  nodeSize(id: string): { w: number; h: number } {
    const m = this.measured.get(id)
    if (m) return { ...m }
    const node = this.store.getNode(id)
    if (!node) return { w: 0, h: 0 }
    if (node.size) return { ...node.size }
    const def = this.store.types.get(node.type)
    if (def?.defaultSize) return { ...def.defaultSize }
    return { w: 0, h: 0 }
  }

  /** 绝对坐标（累加父链 position）。无父即自身 position。 */
  absolutePosition(id: string): { x: number; y: number } {
    let node = this.store.getNode(id)
    if (!node) return { x: 0, y: 0 }
    let x = node.position.x
    let y = node.position.y
    const seen = new Set<string>([id])
    while (node?.parentId) {
      if (seen.has(node.parentId)) break // 环保护
      seen.add(node.parentId)
      const parent = this.store.getNode(node.parentId)
      if (!parent) break
      x += parent.position.x
      y += parent.position.y
      node = parent
    }
    return { x, y }
  }

  /** 某节点矩形（绝对坐标 + 实际尺寸）。节点不存在返回 null。 */
  getNodeRect(id: string): LayoutRect | null {
    const node = this.store.getNode(id)
    if (!node) return null
    const { x, y } = this.absolutePosition(id)
    const { w, h } = this.nodeSize(id)
    return { id, x, y, w, h }
  }

  /** 全部存活节点矩形（含子节点；顺序同 store）。 */
  getAllRects(): LayoutRect[] {
    return this.store.getNodes().map((n) => this.getNodeRect(n.id)!).filter(Boolean)
  }

  /** 某父节点直属子节点矩形。 */
  childrenOf(parentId: string): LayoutRect[] {
    return this.store
      .getNodes()
      .filter((n) => n.parentId === parentId)
      .map((n) => this.getNodeRect(n.id)!)
      .filter(Boolean)
  }
}




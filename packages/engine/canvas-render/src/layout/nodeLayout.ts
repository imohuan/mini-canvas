/**
 * NodeLayoutService —— 节点布局只读服务（渲染层提供、插件/工具消费）。
 *
 * 尺寸唯一来源：`node.size`（用户 2026-11-14 拍板，不再有 data.cardWidth 镜像）。
 * 渲染层用 ResizeObserver 量测真实 DOM 尺寸，仅用于**一致性诊断**（DOM 与 size 不一致时告警），
 * 不再用实测值覆盖读口 —— 否则“卡片 400、布局 390”这类偏差会再次出现。
 *
 * 矩形坐标一律 flow 绝对坐标：子节点 position 相对父，逐级累加父链得绝对坐标。
 *
 * 对外类型面见 canvas-data 的 NodeLayoutContract（服务名 → 类型的唯一事实源在作者 SDK 上游）：
 * 插件只看到读口（nodeSize/absolutePosition/getNodeRect/getAllRects/childrenOf）；
 * 实测写口（setMeasuredSize/clearMeasuredSize/reset）是渲染层内部面，不进契约。
 */
import type { NodeStoreService } from '@plume-canvas/canvas-data'
import type { NodeLayoutContract, LayoutRect } from '@plume-canvas/canvas-data'

export type { LayoutRect }

export class NodeLayoutService implements NodeLayoutContract {
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

  /**
   * 清掉 store 里已经不存在的实测值。
   *
   * 为什么需要：可见剔除会先把 DOM 拿掉（元素从 observed 里移除），之后用户真删节点时，
   * DOM 早已不在，量测层收不到“元素消失”那一次回调。只靠 DOM 生命周期会留下永久实测值。
   */
  pruneMissing(): void {
    for (const id of [...this.measured.keys()]) {
      if (!this.store.getNode(id)) this.measured.delete(id)
    }
  }

  /**
   * 取某节点的**实际尺寸**：`node.size` 有就用，没有跟类型默认值走。
   *
   * 图片/视频这类「尺寸由内容决定」的类型，没画面时故意不写 size ——
   * 这样设置面板改默认宽高时它们能实时跟着变（用户 2026-11-18）。
   * 实测值不参与计算，见文件头。
   */
  nodeSize(id: string): { w: number; h: number } {
    return this.store.effectiveSize(id)
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



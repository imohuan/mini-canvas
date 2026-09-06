/**
 * connection/geometry.ts —— 拖线吸附/命中判定的纯几何（零 Vue、零 DOM，Node 可单测）。
 *
 * 坐标系约定：输入输出全部是 **flow（画布）坐标**（与节点 position 同空间），不做 DOM/屏幕换算。
 * 调用方(CanvasHost/CanvasSurface)负责从 VueFlow 把节点抽成 NodeRect（computedPosition + dimensions，
 * 缺尺寸回落 nodeStore.types.defaultSize）再喂进来。
 *
 * 几何源自 v1 useCanvasConnection 的吸附带公式（v1 是屏幕 px + DOM；这里改用 flow 坐标，去掉 zoomScale 换算）：
 *   - 端口吸附带(snap zone)：以目标/源端口锚点(卡片左/右缘中点)为中心的一竖条：
 *       宽 = snapOuter + snapInner，高 = snapHeight(=handleRadius×heightRatio)
 *       横向范围 [anchorX∓…]：target 口锚点=左缘 → 向左扩 snapOuter、向右扩 snapInner；
 *                               source 口锚点=右缘 → 向左扩 snapInner、向右扩 snapOuter。
 *   - body 区：整张卡片矩形。
 */
import type { FlowPoint } from '../contracts/connectionContext'

/** 节点吸附比例常量（默认对齐 v1 core-node-contract） */
export interface SnapRatios {
  /** 朝节点外侧的吸附带宽倍率（×handleRadius） */
  outer: number
  /** 朝节点内侧的吸附带深倍率（×handleRadius） */
  inner: number
  /** 吸附带高度倍率（×handleRadius） */
  height: number
}

/** 默认吸附比例（v1 默认值） */
export const DEFAULT_SNAP_RATIOS: SnapRatios = { outer: 0.75, inner: 0.6, height: 1.35 }

/** 供能力层计算的节点矩形（flow 坐标） */
export interface NodeRect {
  id: string
  type?: string
  x: number
  y: number
  width: number
  height: number
}

/** 端口吸附带 */
export interface SnapZone extends NodeRect {
  /** 端口锚点(吸附终点) */
  anchorX: number
  anchorY: number
}

/** 节点卡片 body 区 */
export interface BodyZone {
  nodeId: string
  x: number
  y: number
  width: number
  height: number
}

/** 连边方向：source→target 或 反向 target→source */
export type ConnectDirection = 'forward' | 'reverse'

/**
 * 依 direction 决定端口锚点在卡片哪侧：
 * forward(source→target)：目标口在左缘，锚点 (x, 中点)；吸附带向左扩。
 * reverse(target→source)：目标口在右缘，锚点 (x+width, 中点)；吸附带向右扩。
 */
export function zoneDirectionAnchor(
  n: NodeRect,
  dir: ConnectDirection,
): { anchorX: number; anchorY: number } {
  return dir === 'forward'
    ? { anchorX: n.x, anchorY: n.y + n.height / 2 }
    : { anchorX: n.x + n.width, anchorY: n.y + n.height / 2 }
}

/** 计算所有候选节点的端口吸附带 */
export function computeSnapZones(
  nodes: NodeRect[],
  dir: ConnectDirection,
  handleRadius: number,
  ratios: SnapRatios = DEFAULT_SNAP_RATIOS,
): SnapZone[] {
  const snapOuter = handleRadius * ratios.outer
  const snapInner = handleRadius * ratios.inner
  const snapWidth = snapOuter + snapInner
  const snapHeight = handleRadius * ratios.height
  return nodes.map((n) => {
    const { anchorX, anchorY } = zoneDirectionAnchor(n, dir)
    // 吸附带横跨范围：向内 snapInner、向外 snapOuter
    const snapX = dir === 'forward' ? anchorX - snapOuter : anchorX - snapInner
    return {
      id: n.id,
      type: n.type,
      x: snapX,
      y: anchorY - snapHeight / 2,
      width: snapWidth,
      height: snapHeight,
      anchorX,
      anchorY,
    }
  })
}

/** 计算所有反馈节点的卡片 body 区 */
export function computeBodyZones(nodes: NodeRect[]): BodyZone[] {
  return nodes.map((n) => ({
    nodeId: n.id,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
  }))
}

/** 点在矩形内（含边界） */
export function hitTest(
  z: { x: number; y: number; width: number; height: number },
  p: FlowPoint,
): boolean {
  return p.x >= z.x && p.x <= z.x + z.width && p.y >= z.y && p.y <= z.y + z.height
}

/** 命中列表里到锚点最近的那个（用于多带重叠取最近） */
export function closestZone(
  zones: SnapZone[],
  p: FlowPoint,
): SnapZone | null {
  let best: SnapZone | null = null
  let bestDist = Infinity
  for (const z of zones) {
    if (!hitTest(z, p)) continue
    const d = Math.hypot(p.x - z.anchorX, p.y - z.anchorY)
    if (d < bestDist) {
      bestDist = d
      best = z
    }
  }
  return best
}

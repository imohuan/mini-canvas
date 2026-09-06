/**
 * connection/geometry.ts —— 拖线吸附/命中判定的纯几何（零 Vue、零 DOM，Node 可单测）。
 *
 * 坐标系约定：输入输出全部是 **flow（画布）坐标**（与节点 position 同空间），不做 DOM/屏幕换算。
 * 调用方(CanvasHost/CanvasSurface)负责从 VueFlow 把节点抽成 NodeRect（computedPosition + dimensions，
 * 缺尺寸回落 nodeStore.types.defaultSize）再喂进来。
 *
 * 几何模型（v2 吸附带 SnapZoneConfig 重设计）：
 *   - 端口吸附带(snap zone)：以端口锚点(卡片左缘 target 输入口 / 右缘 source 输出口)为中心的一竖带：
 *       高 = min(节点高, 节点高 × heightRatio)（默认 heightRatio=0.8 → 占节点高 80%）
 *       宽 = width（默认 handleRadius）
 *       offset：>0 向节点外移、<0 向节点内移（默认 0，带紧贴锚点向外侧伸 width）
 *       shape：rect | arc（仅视觉，命中一律按矩形）
 *   - body 区：整张卡片矩形。
 *
 * 旧 SnapRatios（outer/inner/height × handleRadius）保留为 deprecated 导出，避免破坏历史调用方/测试；
 * 新代码一律用 SnapZoneConfig。
 */
import type { FlowPoint } from '../contracts/connectionContext'

// ======================== 旧比例常量（deprecated，保留兼容） ========================

/** 节点吸附比例常量（**deprecated**：v1 outer/inner×handleRadius 模型。新代码用 SnapZoneConfig） */
export interface SnapRatios {
  /** 朝节点外侧的吸附带宽倍率（×handleRadius） */
  outer: number
  /** 朝节点内侧的吸附带深倍率（×handleRadius） */
  inner: number
  /** 吸附带高度倍率（×handleRadius） */
  height: number
}

/** 默认吸附比例（v1 默认值，**deprecated**） */
export const DEFAULT_SNAP_RATIOS: SnapRatios = { outer: 0.75, inner: 0.6, height: 1.35 }

// ======================== 新 SnapZoneConfig 吸附带配置 ========================

/** 吸附带视觉形状 */
export type SnapZoneShape = 'rect' | 'arc'

/** 吸附带配置：高度占节点比例 / 宽 / 横向偏移 / 形状 */
export interface SnapZoneConfig {
  /** 带高 = 节点高 × heightRatio（0~1，默认 0.8） */
  heightRatio: number
  /** 带宽 px（默认 handleRadius；缺省用 handleRadius 兜底） */
  width?: number
  /** 锚点横向偏移：>0 向节点外、<0 向节点内（默认 0） */
  offset?: number
  /** 视觉形状：rect=矩形 / arc=半椭圆弧（圆心在端口锚点；不影响命中） */
  shape?: SnapZoneShape
}

/** 默认吸附带配置 */
export const DEFAULT_SNAP_ZONE_CONFIG: SnapZoneConfig = {
  heightRatio: 0.8,
  shape: 'rect',
}

// ======================== 基础矩形 / 方向 ========================

/** 供能力层计算的节点矩形（flow 坐标） */
export interface NodeRect {
  id: string
  type?: string
  x: number
  y: number
  width: number
  height: number
}

/** 端口所在侧：target(输入口,卡片左缘) / source(输出口,卡片右缘) */
export type SnapZoneSide = 'target' | 'source'

/** 端口吸附带（NodeRect 子集 + 锚点 + 侧 + 视觉形状） */
export interface SnapZone extends NodeRect {
  /** 端口锚点(吸附终点) */
  anchorX: number
  /** 端口锚点 y */
  anchorY: number
  /** 端口所在侧 */
  side: SnapZoneSide
  /** 视觉形状（rect/arc） */
  shape: SnapZoneShape
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
 * 依 direction 决定端口锚点所在卡片侧：
 * forward(拖 source→target)：目标口在左缘(target 输入)，锚点 (x, 中点)。
 * reverse(拖 target→source)：目标口在右缘(source 输出)，锚点 (x+width, 中点)。
 */
export function zoneDirectionAnchor(
  n: NodeRect,
  dir: ConnectDirection,
): { anchorX: number; anchorY: number; side: SnapZoneSide } {
  return dir === 'forward'
    ? { anchorX: n.x, anchorY: n.y + n.height / 2, side: 'target' }
    : { anchorX: n.x + n.width, anchorY: n.y + n.height / 2, side: 'source' }
}

/** 依据配置算出某端口侧吸附带矩形（锚点已知），不依赖 direction。 */
function bandRectForSide(
  n: NodeRect,
  side: SnapZoneSide,
  handleRadius: number,
  cfg: SnapZoneConfig,
  anchorX: number,
  anchorY: number,
): { x: number; y: number; width: number; height: number } {
  const heightRatio = Math.min(Math.max(cfg.heightRatio || 0.8, 0), 1)
  const height = n.height * heightRatio
  const width = cfg.width && cfg.width > 0 ? cfg.width : handleRadius
  const offset = cfg.offset ?? 0
  // target(左缘)向外=向左(width-offset)、向节点内=+offset；source(右缘)对称
  const x = side === 'target' ? anchorX - (width - offset) : anchorX - offset
  return { x, y: anchorY - height / 2, width, height }
}

/**
 * 计算所有候选节点"当前拖拽方向对应侧"的端口吸附带（方向只取一侧：forward→左 target / reverse→右 source）。
 * @param cfg 吸附带配置；缺省用 DEFAULT_SNAP_ZONE_CONFIG。
 */
export function computeSnapZones(
  nodes: NodeRect[],
  dir: ConnectDirection,
  handleRadius: number,
  cfg: SnapZoneConfig = DEFAULT_SNAP_ZONE_CONFIG,
): SnapZone[] {
  return nodes.map((n) => {
    const { anchorX, anchorY, side } = zoneDirectionAnchor(n, dir)
    const shape = cfg.shape ?? 'rect'
    const rect = bandRectForSide(n, side, handleRadius, cfg, anchorX, anchorY)
    return { id: n.id, type: n.type, side, shape, ...rect, anchorX, anchorY }
  })
}

/**
 * 计算某节点的"双侧"端口吸附带（target 左缘 + source 右缘），供调试叠加(useNodeDebugOverlay)常显两侧带用。
 * 与 resolveFeedback 拖拽判定无关（拖拽只取 computeSnapZones 的方向侧）。
 */
export function computeSnapZoneSides(
  n: NodeRect,
  handleRadius: number,
  cfg: SnapZoneConfig = DEFAULT_SNAP_ZONE_CONFIG,
): { left: SnapZone; right: SnapZone } {
  const ly = n.y + n.height / 2
  const shape = cfg.shape ?? 'rect'
  const leftRect = bandRectForSide(n, 'target', handleRadius, cfg, n.x, ly)
  const rightRect = bandRectForSide(n, 'source', handleRadius, cfg, n.x + n.width, ly)
  return {
    left: { id: n.id, type: n.type, side: 'target', shape, ...leftRect, anchorX: n.x, anchorY: ly },
    right: { id: n.id, type: n.type, side: 'source', shape, ...rightRect, anchorX: n.x + n.width, anchorY: ly },
  }
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

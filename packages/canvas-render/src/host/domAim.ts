/**
 * host/domAim.ts —— 从真实渲染 DOM 探出"当前瞄准目标"(Aim)，替代后端复制几何吸附命中。
 *
 * 依据：吸附区就是前端 UI 画出来的可交互区域 —— MovingHandle 的 .moving-handle-zone(端口吸附区，
 * 自带 --target(输入)/--source(输出) 修饰)与 .v2-node(卡片主体)。浏览器对真实 DOM 的几何命中即"唯一真相"，
 * render 不再用 flow 坐标 + bandRect 数学模型复刻一遍。
 *
 * 用法：在拖线 document mousemove(捕获) 回调里，用 elementFromPoint 取鼠标下真实元素，向上定位：
 *   - 命中某节点的 .moving-handle-zone → { nodeId, side: input|output }（snap）
 *   - 命中某节点卡片(.v2-node/.vue-flow__node) → { nodeId, side:'body' }
 * 返回 null = 不在任何节点/端口上（空白）。
 *
 * 注意：elementFromPoint 依赖浏览器 DOM，无法在 node/vitest 环境跑；此模块只在宿主运行时 import，
 * 纯判定逻辑仍放 connection/aim.ts 保证可单测。
 */
import type { Aim, AimSide } from '../connection/aim'

/** VueFlow 节点外层容器 data-id 选择器（id 是用户给的节点 id） */
const NODE_SELECTOR = '.vue-flow__node'
/** 端口吸附区容器（MovingHandle zone） */
const ZONE_SELECTOR = '.moving-handle-zone'
/** MovingHandle 锚点容器（其内 zone/button 都算端口命中；button 是 zone 的兄弟，需一并认作端口侧） */
const ANCHOR_SELECTOR = '.moving-handle-anchor'
/** 卡片主体（BaseNode 根） */
const CARD_SELECTOR = '.v2-node'

/** 从 DOM 元素向上找最近的节点容器，返回节点 id；找不到返回 null */
function nodeIdOf(el: Element | null): string | null {
  if (!el) return null
  const node = el.closest<HTMLElement>(NODE_SELECTOR)
  if (!node) return null
  return node.getAttribute('data-id') || node.dataset?.id || null
}

/** 由端口锚点判断其侧：锚点/zone 有 --source/--target 修饰 → 输出/输入；默认按 target=输入 */
function anchorSide(el: Element | null): AimSide {
  if (!el) return 'input'
  const cls = el.classList
  if (cls.contains('moving-handle-zone--source') || cls.contains('moving-handle-anchor--source')) return 'output'
  return 'input'
}

/**
 * 在给定 client 坐标下解析当前瞄准目标。
 * @param clientX/clientY 屏幕坐标（与 elementsFromPoint 同一坐标系）
 * @param excludeId 拖线源节点 id（自身不算目标；传空则不过滤）
 */
export function aimAtClient(
  clientX: number,
  clientY: number,
  excludeId: string | null,
): Aim | null {
  const doc = typeof document === 'undefined' ? null : document
  if (!doc) return null
  // 用 elementsFromPoint 拿元素栈最上层一组：拖线临时线是 pointer-events:none，不会被它挡住。
  const els = doc.elementsFromPoint(clientX, clientY)
  for (const el of els) {
    // 命中某端口（zone 或锚点/按钮）→ snap（input/output）
    const portHost = el.closest<HTMLElement>(ZONE_SELECTOR) ?? el.closest<HTMLElement>(ANCHOR_SELECTOR)
    if (portHost) {
      const nodeId = nodeIdOf(portHost)
      if (nodeId && nodeId !== excludeId) return { nodeId, side: anchorSide(portHost) }
      if (!nodeId) return null
      // 命中自己源节点端口：不算目标，继续看下面层(卡片/其它)
      continue
    }
  }
  // 无端口命中 → 看是否落在某节点卡片 body
  for (const el of els) {
    const card = el.closest<HTMLElement>(CARD_SELECTOR)
    if (card) {
      const nodeId = nodeIdOf(card)
      if (nodeId && nodeId !== excludeId) return { nodeId, side: 'body' }
      return null
    }
    const n = el.closest<HTMLElement>(NODE_SELECTOR)
    if (n) {
      const nodeId = nodeIdOf(n)
      if (nodeId && nodeId !== excludeId) return { nodeId, side: 'body' }
      return null
    }
  }
  return null
}

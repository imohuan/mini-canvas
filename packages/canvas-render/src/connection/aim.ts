/**
 * connection/aim.ts —— 拖线吸附目标的"前端上报判定"纯逻辑（零 DOM、Node 可测）。
 *
 * v2 架构：吸附区几何归前端 UI（MovingHandle 的 .moving-handle-zone / 卡片 body 就是真实可点击命中区），
 * render 不再复刻一套 bandRect 吸附带数学模型去算"鼠标落没落在哪个节点的哪侧"。
 * render 只需拿到前端/DOM 给的"当前瞄准目标"(Aim：nodeId + 落在 input/output 端口侧还是 body)，
 * 再用它做连接校验与落边。本模块负责"把 Aim + 拖拽方向 规整成规范 (source,target) 候选"。
 *
 * 方向规整规则（对齐原 resolveFeedback 的 forward/reverse 语义）：
 *   - forward  = 从 source 口拖出（主动连别人）→ 候选 source=拖线源, target=瞄准节点；
 *   - reverse  = 从 target 口拖出（反向连别人）→ 候选 source=瞄准节点, target=拖线源。
 *   瞄准命中端口侧(portSide)仅用于 UI 高亮，不改变候选朝向（朝向由拖拽源 handle 决定）。
 */
import type { FlowPoint } from '../contracts/connectionContext'

/** 当前"瞄准到"哪个接收区的上报形状（前端 DOM/UI 提供；render 消费做校验落边） */
export type AimSide = 'input' | 'output' | 'body'

export interface Aim {
  /** 瞄准到的节点 id */
  nodeId: string
  /** 落点侧：input=端口输入区 / output=端口输出区 / body=卡片主体 */
  side: AimSide
}

export type DragOrientation = 'forward' | 'reverse'

/** 依据拖线源 handle 判定本次是正向连(reverse=false)还是反向连 */
export function aimOrientation(sourceHandle: 'source' | 'target'): DragOrientation {
  return sourceHandle === 'target' ? 'reverse' : 'forward'
}

/** 规整后的建边候选：source→target + 落点侧（供校验/落边；zone 供日志/UI 参考） */
export interface AimCandidate {
  source: string
  target: string
  zone: 'snap' | 'body'
}

/** 规整落在某节点 body 的候选（与吸附带命中一致：方向决定谁 source/target） */
export function aimBodyCandidate(aim: Aim, sourceId: string, sourceHandle: 'source' | 'target'): AimCandidate {
  const orient = aimOrientation(sourceHandle)
  return orient === 'reverse'
    ? { source: aim.nodeId, target: sourceId, zone: 'body' }
    : { source: sourceId, target: aim.nodeId, zone: 'body' }
}

/** 规整命中端口区/吸附带 的候选（zone='snap'） */
export function aimSnapCandidate(aim: Aim, sourceId: string, sourceHandle: 'source' | 'target'): AimCandidate {
  const orient = aimOrientation(sourceHandle)
  return orient === 'reverse'
    ? { source: aim.nodeId, target: sourceId, zone: 'snap' }
    : { source: sourceId, target: aim.nodeId, zone: 'snap' }
}

/** 该拖拽方向是否接受此命中侧：forward 只接 input 或 body，reverse 只接 output 或 body（body 两侧都收）。 */
export function aimAcceptsSide(aim: Aim, sourceHandle: 'source' | 'target'): boolean {
  if (aim.side === 'body') return true
  return aimOrientation(sourceHandle) === 'reverse' ? aim.side === 'output' : aim.side === 'input'
}

/** 把 Aim 规整成候选；side='body' 落 body，其余(端口 input/output)落 snap */
export function aimToCandidate(
  aim: Aim,
  sourceId: string,
  sourceHandle: 'source' | 'target',
): AimCandidate {
  return aim.side === 'body'
    ? aimBodyCandidate(aim, sourceId, sourceHandle)
    : aimSnapCandidate(aim, sourceId, sourceHandle)
}

/** 命中端口侧的口语化/侧（供 enrichHover.portSide，forward=想进输入口、reverse=想到输出口） */
export function aimPortSide(aim: Aim, sourceHandle: 'source' | 'target'): 'input' | 'output' | null {
  if (aim.side === 'body') return null
  return aimOrientation(sourceHandle) === 'reverse' ? 'output' : 'input'
}

/** 把 Aim 转成供 enrichHover 用的决策点（hover 反馈的 flowPosition 缺省给不到，调用方自行补） */
export interface AimHoverSeed {
  nodeId: string
  zone: 'snap' | 'body'
  portSide: 'input' | 'output' | null
  flowPosition?: FlowPoint
}

export function aimToHoverSeed(aim: Aim, sourceHandle: 'source' | 'target', flowPosition: FlowPoint): AimHoverSeed {
  return {
    nodeId: aim.nodeId,
    zone: aim.side === 'body' ? 'body' : 'snap',
    portSide: aimPortSide(aim, sourceHandle),
    flowPosition,
  }
}

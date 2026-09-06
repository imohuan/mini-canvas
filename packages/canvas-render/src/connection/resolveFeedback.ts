/**
 * connection/resolveFeedback.ts —— 拖线反馈决策（纯函数，Node 可测）。
 *
 * 移植自 v1 useCanvasConnection.buildConnectionEdgeProps 的决策部分：给定源端口方向 + 鼠标 flow 坐标 +
 * 存活节点矩形，判定命中吸附带/卡片 body，得出：
 *   - 连接线终点(end)：命中合法吸附带或合法卡片 body → 对齐端口锚点；否则跟随鼠标。
 *   - hover 反馈：悬停到哪个节点、valid/invalid、落在 snap/body、非法文案。
 *
 * 与 Vue/VueFlow 解耦：validate 由调用方注入（封装内核 validateConnection + reasonText），
 * 本模块只做几何命中与决策，方便单测。
 */
import type { FlowPoint } from '../contracts/connectionContext'
import {
  computeSnapZones,
  computeBodyZones,
  hitTest,
  zoneDirectionAnchor,
  type NodeRect,
  type SnapZoneConfig,
  DEFAULT_SNAP_ZONE_CONFIG,
} from './geometry'

/** 候选连接校验回调：给定规范(源,目标)返回非法文案；空串=合法（调用方包 validateConnection+reasonText） */
export type ValidateEdge = (sourceId: string, targetId: string) => string

export interface ResolveFeedbackInput {
  /** 拖线源节点 */
  sourceId: string
  /** 从 source(正向连向 target)还是 target(反向连向 source)拖出 */
  sourceHandle: 'source' | 'target'
  /** 存活节点矩形（供吸附判定；排除源自身 + 无对应端口能力的由调用方过滤好） */
  nodeRects: NodeRect[]
  /** 鼠标当前画布坐标 */
  flowPoint: FlowPoint
  handleRadius: number
  config?: SnapZoneConfig
  validate: ValidateEdge
}

export interface HoverDecision {
  nodeId: string
  status: 'valid' | 'invalid'
  zone: 'snap' | 'body'
  /** invalid 文案；valid 时 undefined */
  reason?: string
}

export interface ResolveResult {
  /** 连接线终点：命中合法吸附带或合法卡片 body → 对齐该节点端口锚点，否则原鼠标点 */
  end: FlowPoint
  /** 吸附到的节点 id（无则 null） */
  snappedToId: string | null
  /** hover 反馈（悬空无目标 = null） */
  hover: HoverDecision | null
}

/** 判定当前源端口方向是否"反向连"(拖 target 口去找 source) */
export function isReverse(sourceHandle: 'source' | 'target'): boolean {
  return sourceHandle === 'target'
}

export function resolveFeedback(input: ResolveFeedbackInput): ResolveResult {
  const { sourceId, sourceHandle, nodeRects, flowPoint, handleRadius, config, validate } = input
  const reverse = isReverse(sourceHandle)
  const dir = reverse ? 'reverse' : 'forward'

  // —— 吸附带 / body 区 ——
  const snapZones = computeSnapZones(nodeRects, dir, handleRadius, config ?? DEFAULT_SNAP_ZONE_CONFIG)
  const bodyZones = computeBodyZones(nodeRects)

  let endX = flowPoint.x
  let endY = flowPoint.y
  let bestDist = Infinity
  let invalidNodeId: string | null = null
  let invalidMessage: string | undefined
  let snappedNodeId: string | null = null
  let feedbackNodeId: string | null = null
  let feedbackZone: 'snap' | 'body' | null = null

  // 1) 吸附带命中：合法→就近对齐锚点；非法→记 invalid
  for (const zone of snapZones) {
    if (!hitTest(zone, flowPoint)) continue
    // 候选规范边（reverse 时源/目标互换）
    const candidate = reverse
      ? { source: zone.id, target: sourceId }
      : { source: sourceId, target: zone.id }
    const msg = validate(candidate.source, candidate.target)
    if (msg) {
      invalidNodeId = zone.id
      invalidMessage = msg
      feedbackNodeId = zone.id
      feedbackZone = 'snap'
      continue
    }
    const d = Math.hypot(flowPoint.x - zone.anchorX, flowPoint.y - zone.anchorY)
    if (d < bestDist) {
      bestDist = d
      endX = zone.anchorX
      endY = zone.anchorY
      snappedNodeId = zone.id
      feedbackNodeId = zone.id
      feedbackZone = 'snap'
    }
  }

  // 2) 未吸附到合法口时，看是否落在某卡片 body（供 3D/气泡反馈）
  //    body 合法命中时也把 end 对齐该节点对应端口锚点，使临时拖线与 hover 判定的落点一致
  //    （否则 3D 已亮、线终点却停在鼠标偏远处，用户会以为线没对准）。
  let bodyNodeId: string | null = null
  for (const z of bodyZones) {
    if (hitTest(z, flowPoint)) {
      bodyNodeId = z.nodeId
      break
    }
  }
  if (!snappedNodeId && bodyNodeId) {
    const candidate = reverse
      ? { source: bodyNodeId, target: sourceId }
      : { source: sourceId, target: bodyNodeId }
    const msg = validate(candidate.source, candidate.target)
    if (msg) {
      invalidNodeId = bodyNodeId
      invalidMessage = msg
    } else {
      // 合法 body 命中：把线终点吸到本节点端口锚点（forward=target 左缘 / reverse=source 右缘）
      const { anchorX, anchorY } = zoneDirectionAnchor(
        nodeRects.find((n) => n.id === bodyNodeId) as NodeRect,
        dir,
      )
      endX = anchorX
      endY = anchorY
    }
    feedbackNodeId = bodyNodeId
    feedbackZone = 'body'
  }

  // 3) 组装 hover
  const effectiveFeedback = feedbackNodeId && feedbackZone ? feedbackNodeId : null
  const effectiveInvalid = effectiveFeedback !== null && invalidNodeId === effectiveFeedback

  const hover: HoverDecision | null = effectiveFeedback
    ? {
        nodeId: effectiveFeedback,
        status: effectiveInvalid ? 'invalid' : 'valid',
        zone: feedbackZone as 'snap' | 'body',
        reason: effectiveInvalid ? invalidMessage || '无法连接' : undefined,
      }
    : null

  return {
    end: { x: endX, y: endY },
    snappedToId: snappedNodeId,
    hover,
  }
}

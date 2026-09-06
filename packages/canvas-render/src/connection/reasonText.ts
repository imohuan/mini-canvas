/**
 * connection/reasonText.ts —— 把内核连接校验的 InvalidReason 枚举映射成给用户看的中文文案。
 *
 * 纯函数、零依赖（Node 可测）。放在能力层：UI(BaseNode 非法气泡/ConnectionLine)只消费字符串文案，
 * 不直接拿内核枚举拼 UI，避免把内核语义字符串当展示文案。
 *
 * v1 对应：useCanvasConnection.getInvalidConnectionReason 返回中文；v2 内核给了结构化 reason，
 * 这里做"枚举 → 文案"映射。
 */
import type { InvalidReason } from '@mini-canvas/canvas-core-v2'

const REASON_TEXT: Record<InvalidReason, string> = {
  'missing-node': '目标不存在',
  'self-loop': '不能连自己',
  'bad-orientation': '连接方向有误',
  'no-source-port': '源节点没有输出口',
  'no-target-port': '目标节点没有输入口',
  'type-not-accepted': '类型不匹配',
  'limit-reached': '已达连接上限',
  duplicate: '已存在同一条连线',
  cycle: '会形成环',
}

/** 默认兜底文案 */
export const DEFAULT_REASON_TEXT = '无法连接'

/** InvalidReason → 中文文案；'ok'/未知给空串表示合法 */
export function reasonText(reason: InvalidReason | 'ok' | undefined | null): string {
  if (!reason || reason === 'ok') return ''
  return REASON_TEXT[reason] ?? DEFAULT_REASON_TEXT
}

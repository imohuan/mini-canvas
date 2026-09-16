/**
 * batchConnectTransient —— 批量连线期间"临时节点/临时边"的数据标记（纯逻辑，Node 可单测）。
 *
 * 拖动中需要一条跟着鼠标走的连线；最简单的做法是建一个**临时节点**放在鼠标处 + 连到它的一条边，
 * 松手时再删掉。但这两个东西绝不能留痕：
 * - 不能落盘（刷新后不该复活）；
 * - 不能进历史（撤销栈里不该有它）；
 * - 不能被当成真边参与连接校验（不算重复边、不算环）。
 * 内核为此提供了通用契约 `data.transient`（见 canvas-data 的 transient.ts），本文件只负责
 * 把该标记拼出来，避免组件的建边/建节点处处手抄字符串而漂移。
 */
import { TRANSIENT_KEY } from '@mini-canvas/canvas-data'

/** 批量连线临时节点/边的 data（标记为中间态 + 起个能认出来的名字便于调试） */
export function transientBatchData(): Record<string, unknown> {
  return { [TRANSIENT_KEY]: true, _batchConnect: true }
}

/** 临时边的 data（与临时节点同一标记语义；建边时用它，删边时靠 id 记着，不必反查） */
export const transientEdgeData = transientBatchData

/**
 * splitSession —— 宫格切分的会话状态（纯 Vue 响应式，零 DOM）。
 *
 * 与 plugin-node-image 的 cropSession 同一条规矩：纯 UI 状态，不写节点 data、
 * 不进撤销栈；组件直接 import 本模块（同包内共享），卸载插件即消失。
 */
import { reactive, watch } from 'vue'

/** 一次切分会话：行列 + 勾选（默认全选） */
export interface SplitState {
  rows: number
  cols: number
  /** 勾选的格子索引集合（reactive Set；默认 = 全部） */
  selected: Set<number>
}

/** 节点 id → 当前会话（一个节点同时只有一份；退出清掉） */
const sessions = reactive(new Map<string, SplitState>())

/** 全选集合 */
function fullSelection(rows: number, cols: number): Set<number> {
  const s = new Set<number>()
  for (let i = 0; i < rows * cols; i++) s.add(i)
  return s
}

/** 该节点是否正在切分 */
export function isSplitting(nodeId: string): boolean {
  return sessions.has(nodeId)
}

/** 进入切分（幂等；重进同一节点保持旧会话，换行列则重建勾选） */
export function beginSplit(nodeId: string, rows: number, cols: number): void {
  if (!nodeId) return
  const cur = sessions.get(nodeId)
  if (cur && cur.rows === rows && cur.cols === cols) return
  sessions.set(nodeId, { rows, cols, selected: fullSelection(rows, cols) })
}

/** 结束切分（幂等） */
export function endSplit(nodeId: string): void {
  sessions.delete(nodeId)
}

/** 读会话（没有返回 undefined） */
export function splitState(nodeId: string): SplitState | undefined {
  return sessions.get(nodeId)
}

/** 勾/取消一格（越界忽略；已经不存在时是加选） */
export function toggleCell(nodeId: string, index: number): void {
  const s = sessions.get(nodeId)
  if (!s) return
  // 越界索引不是"加一个新格子"：本会话只有 rows*cols 格，越界一律忽略
  if (index < 0 || index >= s.rows * s.cols) return
  if (s.selected.has(index)) s.selected.delete(index)
  else s.selected.add(index)
}

/** 订阅会话变化（给插件侧同步 nodeToolbar 模式用；返回取消函数） */
export function onSplitChange(cb: (nodeId: string, active: boolean) => void): () => void {
  let prev = new Set(sessions.keys())
  const stop = watch(
    () => [...sessions.keys()].sort(),
    (next) => {
      const now = new Set(next)
      for (const id of now) if (!prev.has(id)) cb(id, true)
      for (const id of prev) if (!now.has(id)) cb(id, false)
      prev = now
    },
  )
  return stop
}

/** 当前全部会话节点 id（快照；诊断与卸载清理用） */
export function splitNodeIds(): string[] {
  return [...sessions.keys()]
}

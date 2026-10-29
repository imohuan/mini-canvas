/**
 * 宫格工作台的会话状态（纯 Vue 响应式，零 DOM）。
 *
 * 为什么单独成文件：入口下拉、全屏工作台、分镜组节点是三处 UI，只有这张会话能保证
 * “在入口选了 4×3”与“工作台里看到的是 4×3”是同一份数据；把状态塞进节点 data 会污染撤销栈，
 * 塞进 window 又违反插件边界。
 */
import { shallowRef } from 'vue'
import { allCellKeys, type GridSize } from './gridLogic'

export interface GridSession {
  /** 源图片节点 id */
  nodeId: string
  /** 源图当前可显示地址（本会话分析用，不写回 data） */
  imageUrl: string
  width: number
  height: number
  rows: number
  cols: number
  /** 勾选集合；默认 = 全部选中 */
  selected: Set<string>
}

export const gridSession = shallowRef<GridSession | null>(null)

/** 打开工作台：重新全选，避免上一次的点选残留到另一张图 */
export function openGridSession(input: {
  nodeId: string
  imageUrl: string
  width: number
  height: number
  size: GridSize
}): void {
  gridSession.value = {
    nodeId: input.nodeId,
    imageUrl: input.imageUrl,
    width: input.width,
    height: input.height,
    rows: input.size.rows,
    cols: input.size.cols,
    selected: new Set(allCellKeys(input.size.rows, input.size.cols)),
  }
}

export function closeGridSession(): void {
  gridSession.value = null
}

/** 切换一个格子的勾选状态；越界键会被忽略 */
export function toggleGridCell(key: string): void {
  const cur = gridSession.value
  if (!cur) return
  const next = new Set(cur.selected)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  gridSession.value = { ...cur, selected: next }
}

export function setGridSelection(keys: Iterable<string>): void {
  const cur = gridSession.value
  if (!cur) return
  gridSession.value = { ...cur, selected: new Set(keys) }
}

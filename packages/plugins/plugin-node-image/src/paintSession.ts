/**
 * paintSession —— 图片节点「正在绘制」的会话状态（组件本地态，不写进节点 data）。
 *
 * 与 cropSession 同一条规矩：会话是纯 UI 状态，不落盘、不进撤销栈。
 * 笔迹等草稿数据也留在内存里，确认保存时一次性生成两张图再清掉。
 *
 * 工具模型（用户口径 2026-10-30）：三种模式 —— 画笔 / 矩形填充 / 橡皮擦。
 * 之前的「圆形/方形笔刷」是笔刷形状，不是模式，已删除（用户明确指出是错的）。
 * 撤销/重做是会话内的笔迹历史（不进内核撤销栈，不影响画布数据）。
 */

import { reactive, watch } from 'vue'
import type { PaintStroke } from './imagePaint'

/** 绘制工具：画笔（自由笔迹）/ 矩形填充 / 橡皮擦 */
export type PaintTool = 'brush' | 'rect' | 'erase'

/** 绘制会话里每个节点的草稿与笔刷状态 */
export interface PaintSessionState {
  /** 笔刷大小（滑块 1~100，保存时按显示区宽换算成比例） */
  brushSize: number
  /** 当前工具 */
  tool: PaintTool
  /** 绘制颜色（预览标记色；预置色与自定义色都写这里） */
  color: string
  /** 笔迹草稿（浮层画的内容都在这里；保存命令从这里取） */
  strokes: PaintStroke[]
  /** 重做栈（被撤销的笔迹；新画一笔就清空） */
  redo: PaintStroke[]
}

const sessions = reactive(new Map<string, PaintSessionState>())

function blank(): PaintSessionState {
  return { brushSize: 40, tool: 'brush', color: '#ffffff', strokes: [], redo: [] }
}

/**
 * 读会话（纯读，不写 Map —— 与 cropSession.editDraft 同一条规矩）。
 * 没有时返回一份游离的默认值：调用方只读不写时拿到的字段完整；
 * 要写就先 beginPaint（那里才真正往 Map 里放条目）。
 * 为什么不能懒建：over:inset 段对每个 image 节点都挂载浮层，
 * setup 里读一次 state 就把 Map 塞满 —— 所有点进来的节点都会被误判成「正在绘制」。
 */
export function paintState(nodeId: string): PaintSessionState {
  return sessions.get(nodeId) ?? blank()
}

/** 该节点是否在绘制模式里 */
export function isPainting(nodeId: string): boolean {
  return sessions.has(nodeId)
}

/** 进入绘制模式（幂等；新建干净会话，默认从画笔开始） */
export function beginPaint(nodeId: string): void {
  if (!nodeId) return
  sessions.set(nodeId, blank())
}

/** 退出绘制模式（清掉整个会话；幂等） */
export function endPaint(nodeId: string): void {
  sessions.delete(nodeId)
}

/** 追加一笔（同时清空重做栈：新动作之后原来的重做分支就作废了） */
export function pushStroke(nodeId: string, stroke: PaintStroke): void {
  const s = sessions.get(nodeId)
  if (!s) return
  s.strokes.push(stroke)
  s.redo = []
}

/** 撤销一笔：从笔迹栈挪到重做栈 */
export function undoStroke(nodeId: string): boolean {
  const s = sessions.get(nodeId)
  if (!s || s.strokes.length === 0) return false
  const last = s.strokes.pop()
  if (last) s.redo.push(last)
  return true
}

/** 重做一笔：从重做栈挪回笔迹栈 */
export function redoStroke(nodeId: string): boolean {
  const s = sessions.get(nodeId)
  if (!s || s.redo.length === 0) return false
  const last = s.redo.pop()
  if (last) s.strokes.push(last)
  return true
}

/** 清空全部笔迹（重做栈一起清） */
export function clearStrokes(nodeId: string): void {
  const s = sessions.get(nodeId)
  if (!s) return
  s.strokes = []
  s.redo = []
}

/**
 * 订阅「某人进/出了绘制态」——给插件侧同步 nodeToolbar 功能模式用。
 * 回调只报"变化了的节点"：进入报 mode=paint，退出报 null。
 */
export function onPaintModeChange(cb: (nodeId: string, mode: string | null) => void): () => void {
  let prev = new Set<string>()
  const stop = watch(
    () => [...sessions.keys()].sort(),
    (next) => {
      const now = new Set(next)
      for (const id of now) if (!prev.has(id)) cb(id, 'paint')
      for (const id of prev) if (!now.has(id)) cb(id, null)
      prev = now
    },
  )
  return stop
}

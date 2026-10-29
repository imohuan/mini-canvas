/**
 * paintSession —— 图片节点「正在绘制」的会话状态（组件本地态，**不写进节点 data**）。
 *
 * 与 cropSession 同一条规矩：会话是纯 UI 状态，不落盘、不进撤销栈。
 * 笔迹等草稿数据也留在内存里，确认保存时一次性生成两张图再清掉。
 */

import { reactive, watch } from 'vue'
import type { PaintStroke } from './imagePaint'

/** 绘制会话里每个节点的草稿与笔刷状态 */
export interface PaintSessionState {
  /** 笔刷大小（CSS px，相对显示尺寸，保存时按原图缩放换算） */
  brushSize: number
  /** 笔刷形状：圆 / 方 */
  brushShape: 'round' | 'square'
  /** 当前笔刷模式：画（标记区域）或擦（取消已标记区域） */
  brushMode: 'paint' | 'erase'
  /** 笔迹草稿（浮层画的内容都在这里；保存命令从这里取） */
  strokes: PaintStroke[]
}

const sessions = reactive(new Map<string, PaintSessionState>())

function blank(): PaintSessionState {
  return { brushSize: 40, brushShape: 'round', brushMode: 'paint', strokes: [] }
}

/**
 * 读会话（**纯读，不写 Map** —— 与 cropSession.editDraft 同一条规矩）。
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

/** 进入绘制模式（幂等；新建干净会话，默认从「画」开始） */
export function beginPaint(nodeId: string): void {
  if (!nodeId) return
  sessions.set(nodeId, blank())
}

/** 退出绘制模式（清掉整个会话；幂等） */
export function endPaint(nodeId: string): void {
  sessions.delete(nodeId)
}

/**
 * 订阅「某人进/出了绘制态」——给插件侧同步 nodeToolbar 功能模式用。
 * 回调只报"变化了的节点"：进入报 mode='paint'，退出报 null。
 */
export function onPaintModeChange(cb: (nodeId: string, mode: 'paint' | null) => void): () => void {
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

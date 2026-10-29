/**
 * videoClipStore —— 剪辑会话的组件间共享态（会话级，不进节点 data、不进撤销栈）。
 *
 * 与 videoSession 同一个理由：底栏的剪辑面板和节点内容区是两个兄弟组件，只共享 nodeId。
 * 播放头位置来自内容区的 <video> 元素，面板要跟着走 —— 放这里按 nodeId 记。
 *
 * 吸附/循环这类「用户偏好」存模块级（刷新前的本次会话内保持），
 * 不写 localStorage：每个节点独立会话，写盘会让设置跨节点串味。
 */
import { reactive } from 'vue'

/** 节点 id → 当前播放位置（秒） */
const playheads = reactive(new Map<string, number>())

/** 内容区 timeupdate / seek 时上报（节流由调用方控制：只在值变化超过 0.05s 时写） */
export function publishPlayhead(nodeId: string, seconds: number): void {
  if (!nodeId || !Number.isFinite(seconds)) return
  const prev = playheads.get(nodeId)
  // 0.05s 以内的抖动不写，避免拖动时每帧触发面板重渲染
  if (prev !== undefined && Math.abs(prev - seconds) < 0.05) return
  playheads.set(nodeId, seconds)
}

/** 面板每帧读（跟随当前播放位置；节点没有上报过返回 null） */
export function readPlayhead(nodeId: string): number | null {
  const v = playheads.get(nodeId)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 节点卸载时清掉（内存卫生） */
export function resetPlayhead(nodeId: string): void {
  playheads.delete(nodeId)
}

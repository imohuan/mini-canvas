import type { Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import { clampClipRange } from '../videoClip'
import type { ClipPrefs } from '../videoClipStore'

export interface ClipActionsOptions {
  ctx: CanvasRenderContext['ctx']
  nodeId: string
  pending: Readonly<Ref<boolean>>
  range: Ref<{ start: number; end: number }>
  duration: Ref<number>
  minClip: Ref<number>
  prefs: ClipPrefs
  commit: (next: { start: number; end: number }) => void
  snapLength: (length: number) => number
}

/**
 * 剪辑条上的开关与确认/取消命令。
 */
export function useClipActions(options: ClipActionsOptions) {
  const { ctx, nodeId, pending, range, duration, minClip, prefs, commit, snapLength } = options

  function toggleSnap(): void {
    prefs.snap = !prefs.snap
    if (prefs.snap && duration.value > 0) {
      const len = snapLength(range.value.end - range.value.start)
      const safe = Math.max(minClip.value, Math.min(len, duration.value))
      const anchor = Math.max(0, Math.min(range.value.start, duration.value - safe))
      commit(clampClipRange({ start: anchor, end: anchor + safe, duration: duration.value, minDuration: minClip.value }))
    }
  }

  function toggleLoop(): void {
    prefs.loop = !prefs.loop
    // 循环是内容区的行为：关掉时立刻清 loop（开着不影响确认后的回放起始）
    // ★ 不再动 video 元素的 loop：它只能循环整段视频，管不到剪辑段尾。
    //   真正的区间循环由内容区的 timeupdate 按会话偏好处理（见 VideoContent.onTimeUpdate）。
  }

  function onConfirm(): void {
    // 后台转码中再点一次会重复提交（后台对同节点返回 busy），本地先拦住
    if (pending.value) return
    ctx.get('canvas').runCommand('video:clip-confirm', { nodeId, start: range.value.start, end: range.value.end })
  }

  function onCancel(): void {
    ctx.get('canvas').runCommand('video:clip-cancel', { nodeId })
  }

  return {
    toggleSnap,
    toggleLoop,
    onConfirm,
    onCancel,
  }
}

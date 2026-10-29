/**
 * videoFilmstrip —— 剪辑胶片条的抽帧逻辑（纯函数，零 Vue）。
 *
 * 复刻 packages/ui/public/video-clip-demo.html 的胶片条：把整段视频按目标格数
 * 均匀抽帧，每格一张小图。抽帧复用同包的 captureFrame（临时 video 元素 seek +
 * canvas），不依赖播放中的元素 —— 面板与内容区是兄弟组件，抓不到它的 video。
 *
 * 并发有闸门（同时最多 2 个视频在抽帧），格与格之间顺序生成、每格完成立即回调：
 * 面板可以一格一格显示，不用等整条抽完。
 */
import { captureFrame } from './videoTransform'

/** 抽帧结果：格中心对应的时间点 + 可显示的 dataURL */
export interface FilmstripFrame {
  /** 这一格代表的时刻（秒）：格子按「每格覆盖一段」均分，取值是各段的中心点 */
  at: number
  dataUrl: string
}

/** 目标格数：宽度 ÷ 每格 56px，再夹到 [6, 14]（demo 同款） */
export function frameCountFor(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 8
  return Math.min(14, Math.max(6, Math.round(width / 56)))
}

/** 每一帧的时间点：格 i 的中心 = duration × (i + 0.5) / count */
export function frameTimes(duration: number, count: number): number[] {
  if (!(duration > 0) || !(count > 0)) return []
  return Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count)
}

/** 同一时刻最多几个视频在抽帧（demo 没限流，但画布上几十个节点同时进剪辑会炸 CPU） */
const MAX_CONCURRENT = 2
let running = 0
const queue: Array<() => void> = []
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r))
  running += 1
  try {
    return await fn()
  } finally {
    running -= 1
    queue.shift()?.()
  }
}

/** 逐格抽帧：每格完成就调 onFrame（顺序、不并发）；中途作废通过 jobToken */
export async function grabStrip(
  url: string,
  duration: number,
  count: number,
  onFrame: (frame: FilmstripFrame, index: number) => void,
  isCancelled: () => boolean,
): Promise<void> {
  if (!url || !(duration > 0)) return
  await withSlot(async () => {
    const times = frameTimes(duration, count)
    for (let i = 0; i < times.length; i++) {
      if (isCancelled()) return
      const frame = await captureFrame(url, times[i])
      if (isCancelled()) return
      if (frame) onFrame({ at: times[i], dataUrl: frame.dataUrl }, i)
    }
  })
}

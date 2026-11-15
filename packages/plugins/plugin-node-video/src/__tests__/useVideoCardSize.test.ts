/**
 * useVideoCardSize —— 卡片尺寸跟着视频比例走。
 *
 * 用户 2026-11-10：后台/脚本建的节点把卡片写死成 440×260，装 1280×720 的 16:9 视频，
 * contain 留下黑边。视频节点不允许手动 resize，卡片尺寸本就该由画面比例决定。
 *
 * 用户 2026-11-11：从资源面板拖入视频，卡片先按默认 480×320 画、上下留黑边，
 * 要平移缩放才恢复。做法是**监听显示的 URL，一变就量尺寸，再按尺寸显示宽高**。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { useVideoCardSize } from '../video-content/useVideoCardSize'
import { videoCardSizePatch } from '../videoFit'
import { readVideoMeta } from '../videoTransform'
import type { VideoOpsContext } from '../videoOps'

/** 量尺寸要真实解码视频：单测里换成固定元数据（1280×720） */
vi.mock('../videoTransform', () => ({
  readVideoMeta: vi.fn(async () => ({ width: 1280, height: 720, duration: 10 })),
}))

/** 测试里把 node.size 单独存一份（尺寸唯一来源） */
function makeOps(data: Record<string, unknown>, state: { size: { w: number; h: number } | null }): VideoOpsContext {
  const apply = (_id: string, next: Record<string, unknown>, size?: { w: number; h: number }): void => {
    Object.assign(data, next)
    if (size) state.size = { w: size.w, h: size.h }
  }
  return {
    read: () => data,
    write: apply,
    writeMeasured: apply,
  }
}

describe('useVideoCardSize.mountSize', () => {
  it('尺寸缺失 → 补算', async () => {
    const data: Record<string, unknown> = { videoWidth: 1280, videoHeight: 720 }
    const state: { size: { w: number; h: number } | null } = { size: null }
    const { mountSize } = useVideoCardSize({
      nodeId: () => 'v1',
      data: () => data,
      ops: makeOps(data, state),
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    mountSize()
    await new Promise((r) => setTimeout(r, 0))
    expect(state.size).toEqual(videoCardSizePatch(1280, 720)!.size)
  })

  it('尺寸存在但比例不对 → 挂载时纠正（440×260 装 16:9 的实测场景）', async () => {
    const data: Record<string, unknown> = { videoWidth: 1280, videoHeight: 720 }
    const state: { size: { w: number; h: number } | null } = { size: { w: 440, h: 260 } }
    const { mountSize } = useVideoCardSize({
      nodeId: () => 'v2',
      data: () => data,
      ops: makeOps(data, state),
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    mountSize()
    await new Promise((r) => setTimeout(r, 0))
    expect(state.size).toEqual(videoCardSizePatch(1280, 720)!.size)
  })

  it('尺寸已正确 → 不写（幂等，不产生多余写入）', async () => {
    const fit = videoCardSizePatch(1280, 720)!.size
    const data: Record<string, unknown> = {
      videoWidth: 1280,
      videoHeight: 720,
    }
    const state: { size: { w: number; h: number } | null } = { size: { w: fit.w, h: fit.h } }
    let writes = 0
    const ops = makeOps(data, state)
    const measured = ops.writeMeasured!
    ops.writeMeasured = (...args) => {
      writes++
      measured(...args)
    }
    const { mountSize } = useVideoCardSize({
      nodeId: () => 'v3',
      data: () => data,
      ops,
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    mountSize()
    await new Promise((r) => setTimeout(r, 0))
    expect(writes).toBe(0)
  })
})

describe('useVideoCardSize.onMeta：拿到视频真实宽高后立即对齐卡片', () => {
  /**
   * 用户 2026-11-11 实测：从资源面板拖入视频，节点先按默认 480×320 画出来，
   * 上下各留一条黑边；要平移缩放一次才恢复。根因是 onMeta 只在"卡片还没有尺寸"时
   * 才写回，而拖入时卡片已经有默认尺寸（480×320），真实宽高被忽略。
   */
  it('卡片已有默认尺寸、比例不对 → 按真实视频比例纠正', () => {
    const data: Record<string, unknown> = {}
    const state: { size: { w: number; h: number } | null } = { size: { w: 480, h: 320 } }
    let writes = 0
    const ops = makeOps(data, state)
    const orig = ops.writeMeasured!
    ops.writeMeasured = (...args) => {
      writes++
      orig(...args)
    }
    const { onMeta } = useVideoCardSize({
      nodeId: () => 'v4',
      data: () => data,
      ops,
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    onMeta({ videoWidth: 1280, videoHeight: 720 })
    const fit = videoCardSizePatch(1280, 720)!.size
    expect(state.size).toEqual(fit)
    expect(data.videoWidth).toBe(1280)
    expect(data.videoHeight).toBe(720)
    expect(writes).toBe(1)
  })

  it('重复触发（loadedmetadata 多次）只写一次 —— 不会自己触发自己', () => {
    const data: Record<string, unknown> = {}
    const state: { size: { w: number; h: number } | null } = { size: { w: 480, h: 320 } }
    let writes = 0
    const ops = makeOps(data, state)
    const measured = ops.writeMeasured!
    ops.writeMeasured = (...args) => {
      writes++
      measured(...args)
    }
    const { onMeta } = useVideoCardSize({
      nodeId: () => 'v5',
      data: () => data,
      ops,
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    const el = { videoWidth: 1280, videoHeight: 720 }
    onMeta(el)
    onMeta(el)
    onMeta(el)
    expect(writes).toBe(1)
  })

  it('拖动中拿到宽高 → 先不改卡片尺寸，松手后补上（节点不在指针下跳）', async () => {
    const data: Record<string, unknown> = {}
    const state: { size: { w: number; h: number } | null } = { size: { w: 480, h: 320 } }
    // 真实组件里这里读的是 interaction.activity（响应式）；测试用 ref 模拟同一个依赖
    const dragging = ref(true)
    const { onMeta } = useVideoCardSize({
      nodeId: () => 'v6',
      data: () => data,
      ops: makeOps(data, state),
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
      dragging: () => dragging.value,
    })
    onMeta({ videoWidth: 1280, videoHeight: 720 })
    // 拖动中：尺寸原样不动（改了会让节点在指针下跳）
    expect(state.size).toEqual({ w: 480, h: 320 })
    dragging.value = false
    // 拖动结束的 watch 是异步刷新的（默认 pre），等一拍
    await nextTick()
    expect(state.size).toEqual(videoCardSizePatch(1280, 720)!.size)
  })
})

describe('useVideoCardSize.measure：URL 一变就量尺寸，再按尺寸显示', () => {
  beforeEach(() => { vi.mocked(readVideoMeta).mockClear() })

  it('量到 1280×720 → 宽高与卡片尺寸一起写（不用等悬停播放）', async () => {
    const data: Record<string, unknown> = {}
    const state: { size: { w: number; h: number } | null } = { size: { w: 480, h: 320 } }
    const { measure } = useVideoCardSize({
      nodeId: () => 'm1',
      data: () => data,
      ops: makeOps(data, state),
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '/api/assets/a.mp4' } } as never,
      onSourceChanged: () => {},
    })
    await measure('/api/assets/a.mp4')
    const fit = videoCardSizePatch(1280, 720)!.size
    expect(data.videoWidth).toBe(1280)
    expect(data.videoHeight).toBe(720)
    expect(state.size).toEqual(fit)
  })

  it('同一地址不重复解码（loadedmetadata 与 URL 监听会重复触发）', async () => {
    const data: Record<string, unknown> = {}
    const state: { size: { w: number; h: number } | null } = { size: null }
    const { measure } = useVideoCardSize({
      nodeId: () => 'm2',
      data: () => data,
      ops: makeOps(data, state),
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '/api/assets/a.mp4' } } as never,
      onSourceChanged: () => {},
    })
    await measure('/api/assets/a.mp4')
    await measure('/api/assets/a.mp4')
    expect(readVideoMeta).toHaveBeenCalledTimes(1)
  })

  it('量不到尺寸 → 什么都不写（不猜数字），下次还能重试', async () => {
    vi.mocked(readVideoMeta).mockResolvedValueOnce(null)
    const data: Record<string, unknown> = {}
    const state: { size: { w: number; h: number } | null } = { size: { w: 480, h: 320 } }
    const { measure } = useVideoCardSize({
      nodeId: () => 'm3',
      data: () => data,
      ops: makeOps(data, state),
      currentSize: () => state.size,
      sourceFields: { value: { resourceId: '', legacyUrl: '/api/assets/a.mp4' } } as never,
      onSourceChanged: () => {},
    })
    await measure('/api/assets/a.mp4')
    expect(state.size).toEqual({ w: 480, h: 320 })
    expect(data.videoWidth).toBeUndefined()
    await measure('/api/assets/a.mp4')
    expect(readVideoMeta).toHaveBeenCalledTimes(2)
  })
})

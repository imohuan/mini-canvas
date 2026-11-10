/**
 * useVideoCardSize —— 卡片尺寸兜底的挂载补算契约。
 *
 * 用户 2026-11-10 实测（loading-ui-demo 画布）：后台/脚本建的节点把卡片写死成
 * 440×260，里面装的是 1280×720 的 16:9 视频 —— 卡片没有贴着画面比例，
 * 画面被 contain 留了黑边。视频节点不允许手动 resize（resizable:false），
 * 所以挂载兜底也应该把「比例不对」的尺寸一并纠正，而不是只补「缺失」的。
 */
import { describe, it, expect } from 'vitest'
import { useVideoCardSize } from '../video-content/useVideoCardSize'
import { videoCardSizePatch } from '../videoFit'
import type { VideoOpsContext } from '../videoOps'

function makeOps(data: Record<string, unknown>): VideoOpsContext {
  return {
    read: () => data,
    write: (_id, next, size) => {
      if (size) {
        data.cardWidth = size.w
        data.cardHeight = size.h
      }
      Object.assign(data, next)
    },
  }
}

describe('useVideoCardSize.mountSize', () => {
  it('尺寸缺失 → 补算', async () => {
    const data: Record<string, unknown> = { videoWidth: 1280, videoHeight: 720 }
    const { mountSize } = useVideoCardSize({
      nodeId: () => 'v1',
      data: () => data,
      ops: makeOps(data),
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    mountSize()
    await new Promise((r) => setTimeout(r, 0))
    expect(data.cardWidth).toBe(videoCardSizePatch(1280, 720)!.size.w)
    expect(data.cardHeight).toBe(videoCardSizePatch(1280, 720)!.size.h)
  })

  it('尺寸存在但比例不对 → 挂载时纠正（440×260 装 16:9 的实测场景）', async () => {
    const data: Record<string, unknown> = {
      videoWidth: 1280,
      videoHeight: 720,
      cardWidth: 440,
      cardHeight: 260,
    }
    const { mountSize } = useVideoCardSize({
      nodeId: () => 'v2',
      data: () => data,
      ops: makeOps(data),
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    mountSize()
    await new Promise((r) => setTimeout(r, 0))
    expect(data.cardWidth).toBe(videoCardSizePatch(1280, 720)!.size.w)
    expect(data.cardHeight).toBe(videoCardSizePatch(1280, 720)!.size.h)
  })

  it('尺寸已正确 → 不写（幂等，不产生多余写入）', async () => {
    const fit = videoCardSizePatch(1280, 720)!.size
    const data: Record<string, unknown> = {
      videoWidth: 1280,
      videoHeight: 720,
      cardWidth: fit.w,
      cardHeight: fit.h,
    }
    let writes = 0
    const ops = makeOps(data)
    const orig = ops.write
    ops.write = (...args) => {
      writes++
      orig(...args)
    }
    const { mountSize } = useVideoCardSize({
      nodeId: () => 'v3',
      data: () => data,
      ops,
      sourceFields: { value: { resourceId: '', legacyUrl: '' } } as never,
      onSourceChanged: () => {},
    })
    mountSize()
    await new Promise((r) => setTimeout(r, 0))
    expect(writes).toBe(0)
  })
})

/**
 * videoRefs —— 视频节点“资源引用 → 播放地址”的解析契约。
 *
 * 锁住三件事：引用优先、旧地址兜底、资源服务异常不拖垮渲染。
 */
import { describe, it, expect } from 'vitest'
import { readVideoSourceFields, resolveVideoSrc } from '../videoRefs'

function ctxWith(resolve: ((ref: string) => Promise<string | undefined>) | undefined) {
  return { tryGet: (name: string) => (name === 'resources' ? { resolve } : undefined) }
}

describe('readVideoSourceFields', () => {
  it('读出 resourceId 与旧地址；非字符串一律当没有', () => {
    expect(readVideoSourceFields({ resourceId: 'res-2', videoUrl: 'blob:v' })).toEqual({
      resourceId: 'res-2',
      legacyUrl: 'blob:v',
    })
    expect(readVideoSourceFields({ resourceId: null, videoUrl: 1 })).toEqual({ resourceId: '', legacyUrl: '' })
  })
})

describe('resolveVideoSrc', () => {
  it('有 resourceId → 用解析出来的地址（不直接用旧 videoUrl）', async () => {
    expect(
      await resolveVideoSrc(ctxWith(async (ref) => 'blob:v-' + ref), {
        resourceId: 'res-9',
        videoUrl: 'blob:stale',
      }),
    ).toBe('blob:v-res-9')
  })

  it('没有 resourceId → 用旧 videoUrl', async () => {
    expect(await resolveVideoSrc(undefined, { videoUrl: 'https://x/a.mp4' })).toBe('https://x/a.mp4')
  })

  it('取不到 → 回退旧 videoUrl（资源已删时仍要能播旧地址）', async () => {
    expect(
      await resolveVideoSrc(ctxWith(async () => undefined), { resourceId: 'res-gone', videoUrl: 'blob:fallback' }),
    ).toBe('blob:fallback')
  })

  it('资源服务抛错 / 两个字段都没有 → 不抛；后者给空串', async () => {
    const throwing = ctxWith(async () => {
      throw new Error('x')
    })
    expect(await resolveVideoSrc(throwing, { resourceId: 'res-1', videoUrl: 'blob:y' })).toBe('blob:y')
    expect(await resolveVideoSrc(throwing, {})).toBe('')
  })
})


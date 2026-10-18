/**
 * audioRefs —— 音频节点“资源引用 → 播放地址”的解析契约。
 *
 * 锁住三件事：引用优先、旧地址兜底、资源服务异常不拖垮渲染。
 */
import { describe, it, expect } from 'vitest'
import { readAudioSourceFields, resolveAudioSrc } from '../audioRefs'

function ctxWith(resolve: ((ref: string) => Promise<string | undefined>) | undefined) {
  return { tryGet: (name: string) => (name === 'resources' ? { resolve } : undefined) }
}

describe('readAudioSourceFields', () => {
  it('读出 resourceId 与旧地址；非字符串一律当没有', () => {
    expect(readAudioSourceFields({ resourceId: 'res-3', audioUrl: 'blob:a' })).toEqual({
      resourceId: 'res-3',
      legacyUrl: 'blob:a',
    })
    expect(readAudioSourceFields({ resourceId: 0, audioUrl: {} })).toEqual({ resourceId: '', legacyUrl: '' })
  })
})

describe('resolveAudioSrc', () => {
  it('有 resourceId → 用解析出来的地址（不直接用旧 audioUrl）', async () => {
    expect(
      await resolveAudioSrc(ctxWith(async (ref) => 'blob:a-' + ref), {
        resourceId: 'res-4',
        audioUrl: 'blob:stale',
      }),
    ).toBe('blob:a-res-4')
  })

  it('没有 resourceId → 用旧 audioUrl', async () => {
    expect(await resolveAudioSrc(undefined, { audioUrl: 'https://x/a.mp3' })).toBe('https://x/a.mp3')
  })

  it('取不到 → 回退旧 audioUrl', async () => {
    expect(
      await resolveAudioSrc(ctxWith(async () => undefined), { resourceId: 'res-gone', audioUrl: 'blob:f' }),
    ).toBe('blob:f')
  })

  it('资源服务抛错 → 回退旧 audioUrl，不抛', async () => {
    const throwing = ctxWith(async () => {
      throw new Error('x')
    })
    expect(await resolveAudioSrc(throwing, { resourceId: 'res-1', audioUrl: 'blob:y' })).toBe('blob:y')
  })
})


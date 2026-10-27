import { describe, it, expect } from 'vitest'
import { isDisplayUrl, resolveImageSrc } from '../imageRefs'

/** 只提供 resolve 的最小 ctx */
function ctxWithResolve(resolve: (ref: string) => Promise<string | undefined>) {
  return { get: (name: string) => (name === 'resources' ? { resolve } : undefined) }
}

describe('resolveImageSrc：3D 贴图引用 → 可显示地址', () => {
  it('引用走资源服务解析', async () => {
    const ctx = ctxWithResolve(async (ref) => '/api/canvases/c1/resources/' + ref)
    expect(await resolveImageSrc(ctx, { resourceId: '824e/abc.png' })).toBe('/api/canvases/c1/resources/824e/abc.png')
  })

  it('引用本身就是可显示地址（旧写入方双写）→ 直接用，不再问资源服务', async () => {
    let called = false
    const ctx = ctxWithResolve(async () => {
      called = true
      return undefined
    })
    expect(await resolveImageSrc(ctx, { resourceId: '/api/canvases/c1/resources/a.png' })).toBe('/api/canvases/c1/resources/a.png')
    expect(called).toBe(false)
    expect(isDisplayUrl('https://x/a.png')).toBe(true)
    expect(isDisplayUrl('blob:http://x/1')).toBe(true)
    expect(isDisplayUrl('824e/a.png')).toBe(false)
  })

  it('没有引用时回退旧 imageUrl；解析失败也回退（不能让卡片白屏）', async () => {
    expect(await resolveImageSrc(ctxWithResolve(async () => undefined), { imageUrl: '/api/x/old.png' })).toBe('/api/x/old.png')
    expect(await resolveImageSrc(ctxWithResolve(async () => undefined), { resourceId: 'r1', imageUrl: '/api/x/old.png' })).toBe(
      '/api/x/old.png',
    )
    const throwing = ctxWithResolve(async () => {
      throw new Error('boom')
    })
    expect(await resolveImageSrc(throwing, { resourceId: 'r1', imageUrl: '/api/x/old.png' })).toBe('/api/x/old.png')
  })

  it('两样都没有 → 空串（显示空态）', async () => {
    expect(await resolveImageSrc(undefined, {})).toBe('')
  })
})

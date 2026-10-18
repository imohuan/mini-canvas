/**
 * imageRefs —— 图片节点“资源引用 → 显示地址”的解析契约。
 *
 * 锁住三件事（用户口径：节点数据只保存资源引用，不保存地址）：
 * 1. 有 resourceId → 交给资源服务现取，旧 imageUrl 一律不参与；
 * 2. 资源服务取不到 → 迁移期回退旧 imageUrl（旧存档仍要能显示）；
 * 3. 资源服务抛错 → 按取不到处理，不让整张卡片渲染失败。
 */
import { describe, it, expect } from 'vitest'
import { readImageSourceFields, resolveImageSrc } from '../imageRefs'

/** 造一个只提供 resources.resolve 的 ctx */
function ctxWith(resolve: ((ref: string) => Promise<string | undefined>) | undefined) {
  return { tryGet: (name: string) => (name === 'resources' ? { resolve } : undefined) }
}

describe('readImageSourceFields：只认两个字段', () => {
  it('读出 resourceId 与旧地址；非字符串一律当没有', () => {
    expect(readImageSourceFields({ resourceId: 'res-1', imageUrl: 'blob:a' })).toEqual({
      resourceId: 'res-1',
      legacyUrl: 'blob:a',
    })
    expect(readImageSourceFields({ resourceId: 7, imageUrl: null })).toEqual({ resourceId: '', legacyUrl: '' })
    expect(readImageSourceFields(undefined)).toEqual({ resourceId: '', legacyUrl: '' })
  })
})

describe('resolveImageSrc：引用优先、旧地址兜底', () => {
  it('有 resourceId → 用资源服务解析出来的地址（不直接用旧 imageUrl）', async () => {
    const url = await resolveImageSrc(
      ctxWith(async (ref) => 'blob:resolved-' + ref),
      { resourceId: 'res-7', imageUrl: 'blob:stale' },
    )
    expect(url).toBe('blob:resolved-res-7')
  })

  it('没有 resourceId → 直接用旧 imageUrl（旧存档）', async () => {
    let called = false
    const url = await resolveImageSrc(
      ctxWith(async () => {
        called = true
        return 'blob:nope'
      }),
      { imageUrl: 'https://x/a.png' },
    )
    expect(url).toBe('https://x/a.png')
    expect(called).toBe(false)
  })

  it('资源服务取不到（资源已删）→ 迁移期回退旧 imageUrl', async () => {
    const url = await resolveImageSrc(ctxWith(async () => undefined), {
      resourceId: 'res-gone',
      imageUrl: 'blob:fallback',
    })
    expect(url).toBe('blob:fallback')
  })

  it('没有资源服务（极简宿主）→ 回退旧 imageUrl，不抛', async () => {
    const url = await resolveImageSrc(undefined, { resourceId: 'res-1', imageUrl: 'blob:x' })
    expect(url).toBe('blob:x')
  })

  it('资源服务抛错 → 按取不到处理，回退旧 imageUrl', async () => {
    const url = await resolveImageSrc(
      ctxWith(async () => {
        throw new Error('network')
      }),
      { resourceId: 'res-1', imageUrl: 'blob:x' },
    )
    expect(url).toBe('blob:x')
  })

  it('两个字段都没有 → 空串（调用方显示空态）', async () => {
    expect(await resolveImageSrc(ctxWith(async () => 'blob:x'), {})).toBe('')
  })
})


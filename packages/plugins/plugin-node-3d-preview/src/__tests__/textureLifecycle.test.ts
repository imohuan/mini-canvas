import { describe, it, expect } from 'vitest'
import { shouldClearTexture, shouldShowTexture } from '../textureLifecycle'
import { readFileSync } from 'node:fs'

const contentSrc = readFileSync(new URL('../PanoramaContent.vue', import.meta.url), 'utf8')

describe('shouldShowTexture：3D 画面什么时候该出现', () => {

  it('换图时必须同步 textureUrl —— 否则球体贴上了图，空状态还盖在上面（用户实测 bug）', () => {
    // 图片是异步解析的：挂载时 ownImageUrl 还是空串，解析完成后才 watch 到地址。
    // 空状态读的是 textureUrl，只调 updateTexture 不改它 → 画面有了、空态永远不消失。
    const at = contentSrc.indexOf('watch(ownImageUrl')
    expect(at).toBeGreaterThan(0)
    const block = contentSrc.slice(at, contentSrc.indexOf('\n})', at))
    expect(block, '换图分支没有把 textureUrl 同步成新地址').toMatch(/textureUrl\.value\s*=\s*url/)
  })

  it('有地址 + 已加载 → 显示', () => {
    expect(shouldShowTexture({ url: '/a.png', loaded: true, error: '' })).toBe(true)
  })

  it('地址被撤掉 → 即使还记着"加载过"也不显示（旧贴图不许残留）', () => {
    expect(shouldShowTexture({ url: '', loaded: true, error: '' })).toBe(false)
    expect(shouldShowTexture({ url: '   ', loaded: true, error: '' })).toBe(false)
  })

  it('新地址还没加载完 → 先显示空状态（避免挂着上一张图冒充新图）', () => {
    expect(shouldShowTexture({ url: '/b.png', loaded: false, error: '' })).toBe(false)
  })

  it('渲染器失败 → 永远不显示', () => {
    expect(shouldShowTexture({ url: '/a.png', loaded: true, error: 'WebGL 不可用' })).toBe(false)
  })
})

describe('shouldClearTexture：什么时候卸载旧纹理', () => {
  it('从有图变没图 → 清', () => {
    expect(shouldClearTexture('/a.png', '')).toBe(true)
  })

  it('换另一张图 / 本来就没图 → 不清（换图交给加载器覆盖）', () => {
    expect(shouldClearTexture('/a.png', '/b.png')).toBe(false)
    expect(shouldClearTexture('', '')).toBe(false)
  })
})

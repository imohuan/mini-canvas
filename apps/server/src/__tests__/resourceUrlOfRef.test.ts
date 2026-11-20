/**
 * 引用 → 地址：地址必须是引用的**投影**，不能是另一份独立事实。
 *
 * 用户实测 2026-11-20「图片 17 重新生成还是旧图」：产物写入只换了地址、没换引用，
 * 于是画面按旧引用显示旧图。这里锁住那条推导关系本身。
 */
import { describe, it, expect } from 'vitest'
import { resourceUrlOfRef, toResourceUrl } from '../store/canvasResources'
// 直接读数据层源文件（server 不依赖 canvas-data，只在测试里按相对路径拿来比对，不参与打包）
import {
  resourceUrlOfRef as sharedResourceUrlOfRef,
  resourceRefOfUrl,
} from '../../../../packages/engine/canvas-data/src/resourceRefs'

const HASH = '181b08e5281278b6.jpeg'

describe('resourceUrlOfRef', () => {
  it('逻辑引用 → 同源地址', () => {
    expect(resourceUrlOfRef('59343957e74b4ce9/' + HASH)).toBe(
      '/api/canvases/59343957e74b4ce9/resources/' + HASH,
    )
  })

  it('与写入侧 toResourceUrl 同一结果（不许两套拼法）', () => {
    expect(resourceUrlOfRef('default/' + HASH)).toBe(toResourceUrl('default', HASH))
  })

  it('槽位资源同样能推', () => {
    expect(resourceUrlOfRef('default/slot-frame-1.webp')).toBe(
      '/api/canvases/default/resources/slot-frame-1.webp',
    )
  })

  it('空 / 多段斜杠 / 非法段名 → 不猜', () => {
    expect(resourceUrlOfRef('')).toBeUndefined()
    expect(resourceUrlOfRef('a/b/c.png')).toBeUndefined()
    expect(resourceUrlOfRef('default/../x.png')).toBeUndefined()
    expect(resourceUrlOfRef('default/not-a-resource.png')).toBeUndefined()
  })
})

/**
 * 防漂移：后台是能独立 npx 的包（不依赖 canvas-data），所以这份推导**必须**与数据层那份
 * 逐条一致。以后谁改了规则、只改一边，这里立刻红。
 */
describe('与 canvas-data 的 resourceRefs 同口径', () => {
  const refs = [
    'default/0123456789abcdef.png',
    '59343957e74b4ce9/181b08e5281278b6.jpeg',
    'default/slot-frame-1.webp',
    '',
    'a/b/c.png',
    'default/../x.png',
    'default/not-a-resource.png',
    '中文/0123456789abcdef.png',
  ]

  it('同一组引用 → 同一组地址（或同样拒绝）', () => {
    for (const ref of refs) {
      expect(resourceUrlOfRef(ref), ref).toBe(sharedResourceUrlOfRef(ref))
    }
  })

  it('地址反解引用：认 query 与绝对地址，外链 / 资产地址拒绝', () => {
    expect(resourceRefOfUrl('/api/canvases/default/resources/0123456789abcdef.png'))
      .toBe('default/0123456789abcdef.png')
    expect(resourceRefOfUrl('http://localhost:8865/api/canvases/default/resources/0123456789abcdef.png'))
      .toBe('default/0123456789abcdef.png')
    expect(resourceRefOfUrl('/api/canvases/default/resources/0123456789abcdef.png?v=1700000000000'))
      .toBe('default/0123456789abcdef.png')
    expect(resourceRefOfUrl('/api/assets/files/0123456789abcdef.png')).toBeUndefined()
    expect(resourceRefOfUrl('https://example.com/x.png')).toBeUndefined()
  })

  it('引用 → 地址 → 引用 是闭环（同一份字节换个写法）', () => {
    for (const ref of refs) {
      const url = resourceUrlOfRef(ref)
      if (!url) continue
      expect(resourceRefOfUrl(url), ref).toBe(ref)
    }
  })
})

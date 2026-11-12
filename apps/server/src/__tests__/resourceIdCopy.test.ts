/**
 * 复制画布：逻辑资源 ID 的画布作用域必须换掉。
 *
 * 节点里存的是 `<canvasId>/<hashName>`（不是 URL）。若复制只替换 URL，
 * 副本会指回原画布的资源 —— 原画布一删，副本全裂。
 * 这里直接测纯函数，锁定"只换整个字符串值、不误伤路径与普通文本"。
 */
import { describe, it, expect } from 'vitest'
import { rewriteResourceIdPrefix } from '../store/canvasStore'

const HASH = '0123456789abcdef.png'

describe('rewriteResourceIdPrefix', () => {
  it('换成新画布前缀', () => {
    const json = JSON.stringify({ resourceId: 'c1/' + HASH })
    expect(rewriteResourceIdPrefix(json, 'c1', 'c2')).toBe(JSON.stringify({ resourceId: 'c2/' + HASH }))
  })

  it('槽位资源（slot-…）同样换', () => {
    const json = JSON.stringify({ frameResourceId: 'c1/slot-frame-1.webp' })
    expect(rewriteResourceIdPrefix(json, 'c1', 'c2')).toContain('c2/slot-frame-1.webp')
  })

  it('不误伤旧 URL（地址里也有画布 id）', () => {
    const json = JSON.stringify({ imageUrl: '/api/canvases/c1/resources/' + HASH })
    expect(rewriteResourceIdPrefix(json, 'c1', 'c2')).toBe(json)
  })

  it('不误伤普通文本与其它画布', () => {
    const json = JSON.stringify({
      text: '看这张 c1/' + HASH,
      id: 'c2/' + HASH,
      other: 'c3/' + HASH,
    })
    const out = rewriteResourceIdPrefix(json, 'c1', 'c2') as string
    expect(out).toContain('看这张 c1/' + HASH) // 嵌在文本里不换
    expect(out).toContain('"c3/' + HASH + '"') // 别的画布不动
    expect(out).toContain('"c2/' + HASH + '"')
  })

  it('非资源形态的第二段不换（不是哈希、不是槽位）', () => {
    const json = JSON.stringify({ resourceId: 'c1/not-a-resource.png' })
    expect(rewriteResourceIdPrefix(json, 'c1', 'c2')).toBe(json)
  })
})

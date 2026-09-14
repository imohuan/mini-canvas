import { describe, it, expect } from 'vitest'
import { pickTextureUrl, findUpstreamImageUrl } from '../textureSource'

describe('pickTextureUrl', () => {
  it('上游有图时优先用上游图', () => {
    expect(pickTextureUrl('own.png', 'up.png')).toBe('up.png')
  })

  it('没有上游时用自身图', () => {
    expect(pickTextureUrl('own.png', '')).toBe('own.png')
    expect(pickTextureUrl('own.png', undefined)).toBe('own.png')
  })

  it('都没有时返回空串（显示占位）', () => {
    expect(pickTextureUrl('', '')).toBe('')
    expect(pickTextureUrl(undefined, null)).toBe('')
  })

  it('忽略只有空白的地址', () => {
    expect(pickTextureUrl('   ', ' up.png ')).toBe('up.png')
    expect(pickTextureUrl('  ', '   ')).toBe('')
  })
})

describe('findUpstreamImageUrl', () => {
  const data = {
    a: { imageUrl: 'a.png' },
    b: { imageUrl: 'b.png' },
    empty: {},
  }
  const getData = (id: string) => data[id as keyof typeof data]

  it('找到连到本节点的上游图片地址', () => {
    expect(findUpstreamImageUrl([{ source: 'a', target: 'me' }], 'me', getData)).toBe('a.png')
  })

  it('忽略不是连到本节点的边', () => {
    expect(findUpstreamImageUrl([{ source: 'a', target: 'other' }], 'me', getData)).toBe('')
  })

  it('上游节点没有图时跳过、继续找下一个', () => {
    const edges = [
      { source: 'empty', target: 'me' },
      { source: 'b', target: 'me' },
    ]
    expect(findUpstreamImageUrl(edges, 'me', getData)).toBe('b.png')
  })

  it('没有入边时返回空串', () => {
    expect(findUpstreamImageUrl([], 'me', getData)).toBe('')
  })
})

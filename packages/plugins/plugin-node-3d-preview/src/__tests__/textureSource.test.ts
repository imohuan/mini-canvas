import { describe, it, expect } from 'vitest'
import {
  pickTextureUrl,
  findUpstreamImageUrl,
  findUpstreamImageRef,
  upstreamSourceFields,
  resolveUpstreamImageFields,
} from '../textureSource'

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

describe('findUpstreamImageRef：新节点只有引用时也算有图', () => {
  const data: Record<string, Record<string, unknown>> = {
    legacy: { imageUrl: 'old.png' },
    modern: { resourceId: 'res-9' },
    empty: {},
  }
  const getData = (id: string) => data[id]

  it('只有 resourceId 的上游也能被选中，并带回引用', () => {
    expect(findUpstreamImageRef([{ source: 'modern', target: 'me' }], 'me', getData)).toEqual({
      url: '',
      resourceId: 'res-9',
    })
  })

  it('旧节点带回地址；没有图的边跳过', () => {
    const edges = [
      { source: 'empty', target: 'me' },
      { source: 'legacy', target: 'me' },
    ]
    expect(findUpstreamImageRef(edges, 'me', getData)).toEqual({ url: 'old.png', resourceId: '' })
  })

  it('没有入边 / 一条都没有图 → null', () => {
    expect(findUpstreamImageRef([], 'me', getData)).toBeNull()
    expect(findUpstreamImageRef([{ source: 'empty', target: 'me' }], 'me', getData)).toBeNull()
  })

  it('引用字段被写坏（数组/对象/空白）时不会被当成有效引用', () => {
    const broken: Record<string, Record<string, unknown>> = {
      array: { resourceId: ['a', 'b'] },
      object: { resourceId: { id: 'x' } },
      blank: { resourceId: '   ' },
      good: { resourceId: ' 824e/abc.png ' },
    }
    expect(findUpstreamImageRef([{ source: 'array', target: 'me' }], 'me', (id) => broken[id])).toBeNull()
    expect(findUpstreamImageRef([{ source: 'object', target: 'me' }], 'me', (id) => broken[id])).toBeNull()
    expect(findUpstreamImageRef([{ source: 'blank', target: 'me' }], 'me', (id) => broken[id])).toBeNull()
    expect(findUpstreamImageRef([{ source: 'good', target: 'me' }], 'me', (id) => broken[id])).toEqual({
      url: '',
      resourceId: '824e/abc.png',
    })
  })
})

describe('upstreamSourceFields：上游能力给什么就收什么', () => {
  it('只给引用 → 只交引用（地址由 resolve 现取）', () => {
    expect(upstreamSourceFields({ resourceId: '824e/abc.png' })).toEqual({ resourceId: '824e/abc.png' })
  })

  it('只有旧地址也给（极简上游 / 旧节点）', () => {
    expect(upstreamSourceFields({ url: '/api/x/a.png' })).toEqual({ imageUrl: '/api/x/a.png' })
  })

  it('两样都有就都带上；空白字段不算数', () => {
    expect(upstreamSourceFields({ resourceId: ' 824e/abc.png ', url: ' /api/x/a.png ' })).toEqual({
      resourceId: '824e/abc.png',
      imageUrl: '/api/x/a.png',
    })
    expect(upstreamSourceFields({ resourceId: ' ', url: '' })).toBeNull()
  })

  it('没有上游 → null（组件回到自己的字段 / 空态）', () => {
    expect(upstreamSourceFields(undefined)).toBeNull()
    expect(upstreamSourceFields(null)).toBeNull()
  })
})

describe('resolveUpstreamImageFields：能力优先、扫边兜底（新节点只有引用也要有图）', () => {
  it('能力只给 resourceId → 直接用它（这是当前图片插件的常态）', () => {
    expect(resolveUpstreamImageFields({ media: { resourceId: '824e/abc.png' } })).toEqual({
      resourceId: '824e/abc.png',
    })
  })

  it('能力缺席 → 用扫边结果；只有引用的上游同样算有图', () => {
    expect(
      resolveUpstreamImageFields({ media: null, legacy: { resourceId: '824e/abc.png', url: '' } }),
    ).toEqual({ resourceId: '824e/abc.png' })
    expect(resolveUpstreamImageFields({ legacy: { resourceId: '', url: 'old.png' } })).toEqual({
      imageUrl: 'old.png',
    })
  })

  it('两边都没有 → null（显示空态，不拼假地址）', () => {
    expect(resolveUpstreamImageFields({ media: null, legacy: null })).toBeNull()
  })
})

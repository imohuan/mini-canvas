/**
 * assetModel —— 后端资产形状 → 抽屉项（纯函数）。
 */
import { describe, it, expect } from 'vitest'
import { toAssetItems, countByKind } from '../composables/assetModel'

describe('toAssetItems', () => {
  it('把后端形状映射成抽屉项（保留 id/name/kind/url/source）', () => {
    const out = toAssetItems([
      { id: 'a', name: 'x.png', kind: 'image', url: '/api/assets/files/abc.png', source: 'upload', createdAt: 1 },
    ])
    expect(out).toEqual([{ id: 'a', name: 'x.png', kind: 'image', url: '/api/assets/files/abc.png', source: 'upload' }])
  })
  it('空 / 缺失输入 → 空数组（不抛）', () => {
    expect(toAssetItems([])).toEqual([])
    expect(toAssetItems(undefined as never)).toEqual([])
  })
})

describe('countByKind', () => {
  it('按类型计数', () => {
    const c = countByKind([
      { id: '1', name: 'a', kind: 'image', url: '', source: 'generated' },
      { id: '2', name: 'b', kind: 'image', url: '', source: 'generated' },
      { id: '3', name: 'c', kind: 'audio', url: '', source: 'generated' },
    ])
    expect(c).toEqual({ image: 2, audio: 1 })
  })
})

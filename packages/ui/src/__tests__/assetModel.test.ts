/**
 * assetModel —— 后端资产形状 → 抽屉项（纯函数）。
 */
import { describe, it, expect } from 'vitest'
import { toAssetItems, countByKind, assetKindOf, isAssetUsable } from '../composables/assetModel'

describe('isAssetUsable（能否被「添加到 Agent/画布」）', () => {
  it('有本机绝对路径 → 可用', () => {
    expect(isAssetUsable({ path: 'D:/data/assets/files/ab12.png' })).toBe(true)
  })
  it('没有路径（字节不在本机，如已下线服务的死链）→ 不可用', () => {
    expect(isAssetUsable({})).toBe(false)
    expect(isAssetUsable({ path: '' })).toBe(false)
  })
  it('空输入不抛', () => {
    expect(isAssetUsable(null)).toBe(false)
    expect(isAssetUsable(undefined)).toBe(false)
  })
})

describe('toAssetItems', () => {
  it('把后端形状映射成抽屉项（保留 id/name/kind/url/source）', () => {
    const out = toAssetItems([
      { id: 'a', name: 'x.png', kind: 'image', url: '/api/assets/files/abc.png', source: 'upload', createdAt: 1 },
    ])
    expect(out).toEqual([{ id: 'a', name: 'x.png', kind: 'image', url: '/api/assets/files/abc.png', tags: [], source: 'upload' }])
  })
  it('空 / 缺失输入 → 空数组（不抛）', () => {
    expect(toAssetItems([])).toEqual([])
    expect(toAssetItems(undefined as never)).toEqual([])
  })
})

describe('countByKind', () => {
  it('按类型计数', () => {
    const c = countByKind([
      { id: '1', name: 'a', kind: 'image', url: '', tags: [], source: 'generated' },
      { id: '2', name: 'b', kind: 'image', url: '', tags: [], source: 'generated' },
      { id: '3', name: 'c', kind: 'audio', url: '', tags: [], source: 'generated' },
    ])
    expect(c).toEqual({ image: 2, audio: 1 })
  })
})

describe('assetKindOf（资产类型单一来源）', () => {
  it('后端/AssetItem 形状用 kind', () => {
    expect(assetKindOf({ kind: 'image' })).toBe('image')
  })
  it('列表行形状用 assetKind（抽屉/弹窗的 assetRows）', () => {
    expect(assetKindOf({ assetKind: 'video' })).toBe('video')
  })
  it('两者都有时 assetKind 优先', () => {
    expect(assetKindOf({ kind: 'image', assetKind: 'audio' })).toBe('audio')
  })
  it('都没有 / 空输入 → other（不抛）', () => {
    expect(assetKindOf({})).toBe('other')
    expect(assetKindOf(null)).toBe('other')
    expect(assetKindOf(undefined)).toBe('other')
  })
})

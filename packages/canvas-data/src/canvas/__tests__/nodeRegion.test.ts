import { describe, it, expect } from 'vitest'
import { RegistryImpl } from '@mini-canvas/kernel'
import { NodeRegistry } from '../registry/nodeRegistry'
import { nodeSegmentStackEntries } from '../registry/nodeRenderer'
import { NODE_REGIONS, regionKey, isRegion, assertRegion, nodeRegionStackEntries } from '../region'

const Comp = { name: 'Comp' }
const Other = { name: 'Other' }

describe('NodeRegion 十个区域词（设计文档 §五）', () => {
  it('词表闭合 = 十个，顺序与设计文档一致', () => {
    expect(NODE_REGIONS).toHaveLength(10)
    expect([...NODE_REGIONS]).toEqual([
      'in',
      'title',
      'out:top',
      'out:bottom',
      'out:left',
      'out:right',
      'on:top',
      'on:bottom',
      'over:inset',
      'over:outset',
    ])
  })

  it('键形：regionKey = type/region（type 可为 *）', () => {
    expect(regionKey('image', 'out:top')).toBe('image/out:top')
    expect(regionKey('*', 'in')).toBe('*/in')
  })

  it('isRegion 只认这十个词（老五段名一律 false）', () => {
    for (const r of NODE_REGIONS) expect(isRegion(r)).toBe(true)
    for (const old of ['content', 'top-toolbar', 'bottom-toolbar', 'overlay']) {
      expect(isRegion(old)).toBe(false)
    }
    expect(isRegion('out:middle')).toBe(false)
  })

  it('assertRegion（步骤 9）：十个区域词放行；老五段名与表外词一律抛错', () => {
    expect(assertRegion('in')).toBe('in')
    expect(assertRegion('over:outset')).toBe('over:outset')
    // 老词不再是"可用入参"：当场抛错，报错给出十词全表与"老词已下线"的定性（不静默、不错位）
    for (const old of ['content', 'top-toolbar', 'bottom-toolbar', 'overlay']) {
      expect(() => assertRegion(old)).toThrow(/不是合法区域词/)
      expect(() => assertRegion(old)).toThrow(/已下线/)
      expect(() => assertRegion(old)).toThrow(/in \/ title \/ out:top/)
    }
    // 表外的未知词同样拒绝（不是"原样透传"）
    expect(() => assertRegion('nowhere')).toThrow(/不是合法区域词/)
  })
})

describe('nodeRegionStackEntries：区域读取与 NodeRegistry 同源', () => {
  it('基座 + 贡献：与 nodeSegmentStackEntries 逐项一致（十个区域全查）', () => {
    const r = new NodeRegistry()
    r.register('text', { in: Comp, 'out:top': Other })
    r.registerContribution('text', 'out:top', { id: 'x', component: Comp })
    for (const region of NODE_REGIONS) {
      expect(nodeRegionStackEntries(r, undefined, 'text', region)).toEqual(
        nodeSegmentStackEntries(r, 'text', region),
      )
    }
  })

  it('attach 场条目按 order 排在映射层之后；* 通配条目对该 type 可见', () => {
    const r = new NodeRegistry()
    r.register('text', { in: Comp })
    const field = new RegistryImpl<{ component: unknown }>()
    field.add('text/in', { component: Other }, { id: 'a', order: 5 })
    field.add('*/in', { component: Comp }, { id: 'star', order: 9 })
    const entries = nodeRegionStackEntries(r, field, 'text', 'in')
    expect(entries.map((e) => e.id)).toEqual(['base', 'a', 'star'])
    expect(entries[1].component).toBe(Other)
    expect(entries[2].component).toBe(Comp)
  })

  it('on:top 同时读 NodeRegistry 区域槽与场（具体键 + 通配键），按 order 合并', () => {
    const r = new NodeRegistry()
    r.register('text', { in: Comp })
    const field = new RegistryImpl<{ component: unknown }>()
    field.add('text/on:top', { component: Other }, { id: 'p', order: 2 })
    field.add('*/on:top', { component: Comp }, { id: 's', order: 3 })
    const entries = nodeRegionStackEntries(r, field, 'text', 'on:top')
    expect(entries.map((e) => e.id)).toEqual(['p', 's'])
  })

  it('老段词传进来 → 当场抛错（不做归一、不静默返回空摞）', () => {
    const r = new NodeRegistry()
    r.register('text', { in: Comp })
    expect(() => nodeRegionStackEntries(r, undefined, 'text', 'content')).toThrow(/不是合法区域词/)
  })
})

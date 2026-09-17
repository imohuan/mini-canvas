import { describe, it, expect } from 'vitest'
import { RegistryImpl } from '@mini-canvas/kernel'
import { NodeRegistry } from '../registry/nodeRegistry'
import { nodeSegmentStackEntries } from '../registry/nodeRenderer'
import {
  NODE_REGIONS,
  regionOfSegment,
  regionKey,
  legacySegmentKey,
  normalizeRegionKey,
  isLegacyRegion,
  nodeRegionStackEntries,
} from '../region'

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

  it('老五段映射：content→in / title→title / top→out:top / bottom→out:bottom / overlay→over:inset', () => {
    expect(regionOfSegment('content')).toBe('in')
    expect(regionOfSegment('title')).toBe('title')
    expect(regionOfSegment('top-toolbar')).toBe('out:top')
    expect(regionOfSegment('bottom-toolbar')).toBe('out:bottom')
    expect(regionOfSegment('overlay')).toBe('over:inset')
    expect(isLegacyRegion('in')).toBe(true)
    expect(isLegacyRegion('title')).toBe(true)
    expect(isLegacyRegion('out:top')).toBe(true)
    expect(isLegacyRegion('out:bottom')).toBe(true)
    expect(isLegacyRegion('over:inset')).toBe(true)
    expect(isLegacyRegion('out:left')).toBe(false)
    expect(isLegacyRegion('on:top')).toBe(false)
  })

  it('键形：regionKey = type/region（type 可为 *）；legacySegmentKey = type/老段词', () => {
    expect(regionKey('image', 'out:top')).toBe('image/out:top')
    expect(regionKey('*', 'in')).toBe('*/in')
    expect(legacySegmentKey('image', 'top-toolbar')).toBe('image/top-toolbar')
  })

  it('normalizeRegionKey 容忍老段词当区域传入；未知词原样透传', () => {
    expect(normalizeRegionKey('top-toolbar')).toBe('out:top')
    expect(normalizeRegionKey('bottom-toolbar')).toBe('out:bottom')
    expect(normalizeRegionKey('overlay')).toBe('over:inset')
    expect(normalizeRegionKey('content')).toBe('in')
    expect(normalizeRegionKey('title')).toBe('title')
    expect(normalizeRegionKey('on:top')).toBe('on:top')
    expect(normalizeRegionKey('over:outset')).toBe('over:outset')
  })
})

describe('nodeRegionStackEntries：映射层读出与老路径等价', () => {
  it('基座 + 贡献：与 nodeSegmentStackEntries(老段) 逐项一致（五个老段全查）', () => {
    const r = new NodeRegistry()
    r.register('text', { content: Comp, 'top-toolbar': Other })
    r.registerContribution('text', 'top-toolbar', { id: 'x', component: Comp })
    const pairs = [
      ['content', 'in'],
      ['title', 'title'],
      ['top-toolbar', 'out:top'],
      ['bottom-toolbar', 'out:bottom'],
      ['overlay', 'over:inset'],
    ] as const
    for (const [seg, region] of pairs) {
      expect(nodeRegionStackEntries(r, undefined, 'text', region)).toEqual(
        nodeSegmentStackEntries(r, 'text', seg),
      )
    }
  })

  it('attach 场条目按 order 排在映射层之后；* 通配条目对该 type 可见', () => {
    const r = new NodeRegistry()
    r.register('text', { content: Comp })
    const field = new RegistryImpl<{ component: unknown }>()
    field.add('text/in', { component: Other }, { id: 'a', order: 5 })
    field.add('*/in', { component: Comp }, { id: 'star', order: 9 })
    const entries = nodeRegionStackEntries(r, field, 'text', 'in')
    expect(entries.map((e) => e.id)).toEqual(['base', 'a', 'star'])
    expect(entries[1].component).toBe(Other)
    expect(entries[2].component).toBe(Comp)
  })

  it('非老段区域（如 on:top）不读 NodeRegistry，只读场（具体键 + 通配键）', () => {
    const r = new NodeRegistry()
    r.register('text', { content: Comp })
    const field = new RegistryImpl<{ component: unknown }>()
    field.add('text/on:top', { component: Other }, { id: 'p', order: 2 })
    field.add('*/on:top', { component: Comp }, { id: 's', order: 3 })
    const entries = nodeRegionStackEntries(r, field, 'text', 'on:top')
    expect(entries.map((e) => e.id)).toEqual(['p', 's'])
  })
})

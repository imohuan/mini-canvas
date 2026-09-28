import { describe, it, expect } from 'vitest'
import { BarRegistry } from '../barRegistry'
import type { BarAction } from '../barTypes'

function action(id: string, types?: string[]): BarAction {
  return { id, types, title: id, run: () => ({ ok: true }) }
}

describe('BarRegistry：按节点类型筛选 + 排序（纯逻辑）', () => {
  it('types 省略 = 所有类型都适用', () => {
    const reg = new BarRegistry()
    reg.add(action('all'))
    reg.add(action('img-only', ['image']))
    expect(reg.list({ type: 'image' }).map((a) => a.id)).toEqual(['all', 'img-only'])
    expect(reg.list({ type: 'text' }).map((a) => a.id)).toEqual(['all'])
  })

  it('排序：显式 order 升序在前，没给 order 的一律排最后（保插入序）', () => {
    const reg = new BarRegistry()
    reg.add({ id: 'no-order-1', title: 'a', run: () => ({ ok: true }) })
    reg.add({ id: 'late', title: 'b', order: 10, run: () => ({ ok: true }) })
    reg.add({ id: 'no-order-2', title: 'c', run: () => ({ ok: true }) })
    reg.add({ id: 'early', title: 'd', order: -5, run: () => ({ ok: true }) })
    expect(reg.list().map((a) => a.id)).toEqual(['early', 'late', 'no-order-1', 'no-order-2'])
  })
})


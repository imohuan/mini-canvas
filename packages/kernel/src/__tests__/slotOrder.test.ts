/**
 * orderSlotItems —— 槽内顺序（order + before/after）的纯逻辑契约。
 *
 * 锁六件事：
 * 1. 没有 before/after 时仍是 order 升序、同 order 保持传入序；
 * 2. before / after 指向**条目 id**（不是槽名）；
 * 3. 目标不存在 → 忽略约束、退回 order；
 * 4. 自引用 / 重复 id / 环 → 报告问题且不丢条目不崩；
 * 5. 本地锚点同 id 优先（传入顺序先者赢）；
 * 6. 缺省 order 用统一兜底值。
 */
import { describe, expect, it } from 'vitest'
import { orderSlotItems, SLOT_ORDER_FALLBACK, type SlotOrderIssue } from '../registry/slotOrder'

describe('orderSlotItems · 基础 order', () => {
  it('order 升序；同 order 保持传入序', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/b', order: 20 },
      { id: 'host/a', order: 10 },
      { id: 'host/c', order: 20 },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/a', 'host/b', 'host/c'])
    expect(issues).toEqual([])
  })

  it('没有 order 的条目落在显式 order 之后，并保持传入序', () => {
    const { items } = orderSlotItems([
      { id: 'plugin/x' },
      { id: 'host/a', order: 100 },
      { id: 'plugin/y' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/a', 'plugin/x', 'plugin/y'])
  })

  it('兜底 order 可配置', () => {
    const { items } = orderSlotItems(
      [{ id: 'host/a' }, { id: 'host/b', order: 1 }],
      { fallbackOrder: -1 },
    )
    expect(items.map((e) => e.id)).toEqual(['host/a', 'host/b'])
    expect(SLOT_ORDER_FALLBACK).toBe(1000)
  })
})

describe('orderSlotItems · before / after', () => {
  it('before 把条目插到目标条目之前（即使 order 更大）', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/add', order: 100 },
      { id: 'host/agent', order: 800 },
      { id: 'my-plugin/export', order: 900, before: 'host/agent' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/add', 'my-plugin/export', 'host/agent'])
    expect(issues).toEqual([])
  })

  it('after 把条目插到目标条目之后', () => {
    const { items } = orderSlotItems([
      { id: 'host/history', order: 500 },
      { id: 'host/agent', order: 800 },
      { id: 'my-plugin/a', order: 900, after: 'host/history' },
    ])
    // after = 紧挨着目标之后：a 插到 history 正后，agent 顺延
    expect(items.map((e) => e.id)).toEqual(['host/history', 'my-plugin/a', 'host/agent'])
  })

  it('after + 更小的 order = 紧跟在目标后面', () => {
    const { items } = orderSlotItems([
      { id: 'host/history', order: 500 },
      { id: 'host/agent', order: 800 },
      { id: 'my-plugin/a', order: 900, after: 'host/history' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/history', 'my-plugin/a', 'host/agent'])
  })

  it('多个条目 after 同一目标：它们之间按 order 排，紧跟目标之后', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/a', order: 100 },
      { id: 'host/b', order: 200 },
      { id: 'host/c', order: 300 },
      { id: 'host/d', order: 400 },
      { id: 'plugin/x', order: 30, after: 'host/b' },
      { id: 'plugin/y', order: 20, after: 'host/b' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/a', 'host/b', 'plugin/y', 'plugin/x', 'host/c', 'host/d'])
    expect(issues).toEqual([])
  })

  it('多个条目 before 同一目标：它们之间按 order 排，紧贴目标之前', () => {
    const { items } = orderSlotItems([
      { id: 'host/a', order: 100 },
      { id: 'host/b', order: 200 },
      { id: 'plugin/x', order: 30, before: 'host/b' },
      { id: 'plugin/y', order: 20, before: 'host/b' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/a', 'plugin/y', 'plugin/x', 'host/b'])
  })

  it('多个 after 同目标且 order 都很大：依然只在目标之后，不被甩到最前', () => {
    const { items } = orderSlotItems([
      { id: 'host/zoom', order: 600 },
      { id: 'plugin/a', order: 40, after: 'host/zoom' },
      { id: 'plugin/b', order: 41, after: 'host/zoom' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/zoom', 'plugin/a', 'plugin/b'])
  })

  it('同时写 before 与 after：只认 before，并报告 conflict', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/a', order: 100 },
      { id: 'host/c', order: 300 },
      { id: 'my-plugin/b', order: 900, after: 'host/c', before: 'host/a' },
    ])
    expect(items.map((e) => e.id)).toEqual(['my-plugin/b', 'host/a', 'host/c'])
    expect(issues).toEqual([{ id: 'my-plugin/b', kind: 'conflict', target: 'host/a' }])
  })

  it('目标不存在：忽略该约束，按 order 排，并报告 missing-target', () => {
    const seen: SlotOrderIssue[] = []
    const { items, issues } = orderSlotItems(
      [
        { id: 'host/a', order: 100 },
        { id: 'host/z', order: 800 },
        { id: 'my-plugin/x', order: 900, before: 'host/not-installed' },
      ],
      { onIssue: (i) => seen.push(i) },
    )
    expect(items.map((e) => e.id)).toEqual(['host/a', 'host/z', 'my-plugin/x'])
    expect(issues).toEqual([{ id: 'my-plugin/x', kind: 'missing-target', target: 'host/not-installed' }])
    expect(seen).toEqual(issues)
  })

  it('before 的目标写成槽名（带点、没有斜杠）同样按目标不存在处理', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/agent', order: 800 },
      { id: 'my-plugin/x', order: 900, before: 'shell.dock.agent' },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/agent', 'my-plugin/x'])
    expect(issues.map((i) => i.kind)).toEqual(['missing-target'])
  })
})

describe('orderSlotItems · 异常输入', () => {
  it('自引用：忽略并报告', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/a', order: 100, before: 'host/a' },
      { id: 'host/b', order: 200 },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/a', 'host/b'])
    expect(issues).toEqual([{ id: 'host/a', kind: 'self-reference', target: 'host/a' }])
  })

  it('重复 id：保留传入顺序里的第一条并报告', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/a', order: 900 },
      { id: 'host/a', order: 1 },
      { id: 'host/b', order: 100 },
    ])
    expect(items.map((e) => e.id)).toEqual(['host/b', 'host/a'])
    expect(issues).toEqual([{ id: 'host/a', kind: 'duplicate-id' }])
  })

  it('环：报告环上的条目，并按 order 兜底输出全部条目', () => {
    const { items, issues } = orderSlotItems([
      { id: 'host/a', order: 100, before: 'host/b' },
      { id: 'host/b', order: 200, before: 'host/a' },
      { id: 'host/c', order: 300 },
    ])
    expect(items).toHaveLength(3)
    expect(items.map((e) => e.id).sort()).toEqual(['host/a', 'host/b', 'host/c'])
    expect(issues.map((i) => i.kind)).toEqual(['cycle', 'cycle'])
  })

  it('空输入返回空数组', () => {
    expect(orderSlotItems([])).toEqual({ items: [], issues: [] })
  })
})

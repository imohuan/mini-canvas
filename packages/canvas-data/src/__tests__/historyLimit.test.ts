/**
 * 撤销栈上限的契约（性能 / 内存风险，扫描 2026-10-30 C 类）。
 *
 * 现状：History 每次 withRecord 都把「操作前的整图快照」深拷贝进 undoStack，且**没有上限**。
 * 一张 200 节点的画布，快照约几十 KB～上百 KB；连续拖 100 次就是几十 MB 常驻内存，
 * 而且每次 withRecord 还要 JSON.stringify 两遍整图（O(n) 文本比较）。
 * 用户报的「画布用久了越来越卡、最后崩掉」里，这是持续增长的那一部分。
 *
 * 这里钉两条：
 *   1. 栈有上限，且超限后丢的是**最旧**的那条（不是最新的）；
 *   2. 上限可配（不同宿主/单测可以调小），但必须有个保守默认值。
 */
import { describe, expect, it } from 'vitest'
import { History } from '../history'

/** 最小可用的快照替身：状态就是一个数 */
function makeStore() {
  let value = 0
  return {
    get value() { return value },
    set value(v: number) { value = v },
    snapshot: () => ({ value }),
    restore: (s: unknown) => { value = (s as { value: number }).value },
  }
}

describe('撤销栈有上限（防长时间使用内存持续增长）', () => {
  it('默认上限存在且是有限值', () => {
    expect(History.DEFAULT_LIMIT, '没有默认上限 → 长时间使用会无限增长').toBeTypeOf('number')
    expect(History.DEFAULT_LIMIT).toBeGreaterThan(0)
    expect(Number.isFinite(History.DEFAULT_LIMIT)).toBe(true)
  })

  it('操作次数超过上限后，栈深度停在上限', () => {
    const store = makeStore()
    const history = new History(store, { limit: 3 })
    for (let i = 1; i <= 10; i += 1) {
      history.withRecord(() => { store.value = i })
    }
    expect(history.undoDepth, '栈没有上限，会一直涨').toBe(3)
  })

  it('超限丢的是最旧的一条：还能连续撤销到剩下那批的起点', () => {
    const store = makeStore()
    const history = new History(store, { limit: 2 })
    for (let i = 1; i <= 4; i += 1) {
      history.withRecord(() => { store.value = i })
    }
    // 只有 3→4、2→3 这两步还留着；撤到底应回到 2（不是 0）
    history.undo()
    expect(store.value).toBe(3)
    history.undo()
    expect(store.value, '丢错了端：应丢最旧，不是丢最新').toBe(2)
    expect(history.canUndo()).toBe(false)
  })

  it('上限不影响 redo：撤销后重做仍能回到最新态', () => {
    const store = makeStore()
    const history = new History(store, { limit: 2 })
    store.value = 0
    history.withRecord(() => { store.value = 1 })
    history.withRecord(() => { store.value = 2 })
    history.undo()
    expect(store.value).toBe(1)
    history.redo()
    expect(store.value).toBe(2)
  })

  it('limit 非法（0 / 负数 / NaN）时回落默认值，不会把栈禁掉', () => {
    const store = makeStore()
    for (const bad of [0, -5, Number.NaN]) {
      const history = new History(store, { limit: bad })
      history.withRecord(() => { store.value += 1 })
      expect(history.canUndo(), 'limit=' + String(bad) + ' 把撤销功能整个关掉了').toBe(true)
    }
  })
})

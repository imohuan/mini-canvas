/**
 * 浮层互斥契约（用户口径 2026-11-03：「2个下拉可以同时打开」）。
 *
 * 这条规则以前散在三处：Agent 输入区手写的 6 键表、底栏 Select、参数面板 Popover，
 * 彼此不通，于是模型下拉和比例面板能同时挂着。现在统一由组件库根组件执行。
 *
 * 这里测的是纯逻辑：登记表本身 + 父子豁免。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimExclusive,
  closeAllExclusives,
  openExclusiveCount,
  releaseExclusive,
} from '../popup/exclusive'

/** 造一个登记项，close 只是记一笔 */
function entry(name: string, parentChain: object[] = []): {
  token: object
  chain: object[]
  close: () => void
  closed: string[]
} {
  const closed: string[] = []
  const token = { name }
  return {
    token,
    chain: [...parentChain, token],
    close: () => {
      closed.push(name)
    },
    closed,
  }
}

beforeEach(() => {
  closeAllExclusives()
})

describe('浮层互斥', () => {
  it('打开第二个时，第一个自动关闭', () => {
    const a = entry('a')
    const b = entry('b')
    claimExclusive(a)
    claimExclusive(b)
    expect(a.closed).toEqual(['a'])
    expect(b.closed).toEqual([])
    // 被关掉的那个会先摘出登记表，避免同一次 claim 里重复关闭
    expect(openExclusiveCount()).toBe(1)
  })

  it('父子豁免：子浮层打开不会关掉父浮层', () => {
    const parent = entry('panel')
    claimExclusive(parent)
    // 子浮层是在父面板里打开的：它的链包含父的 token
    const child = entry('inside', [parent.token])
    claimExclusive(child)
    expect(parent.closed).toEqual([])
    expect(child.closed).toEqual([])
  })

  it('兄弟浮层仍互斥：子浮层会关掉另一个父级下的浮层', () => {
    const other = entry('other')
    claimExclusive(other)
    const parent = entry('panel')
    claimExclusive(parent)
    // parent 打开时已经把 other 关掉
    expect(other.closed).toEqual(['other'])
    const child = entry('inside', [parent.token])
    claimExclusive(child)
    expect(other.closed).toEqual(['other'])
    expect(parent.closed).toEqual([])
  })

  it('关闭后摘除登记；重复摘除无副作用', () => {
    const a = entry('a')
    claimExclusive(a)
    expect(openExclusiveCount()).toBe(1)
    releaseExclusive(a)
    releaseExclusive(a)
    expect(openExclusiveCount()).toBe(0)
  })

  it('全关会关掉所有还开着的浮层', () => {
    const a = entry('a')
    const b = entry('b', [])
    claimExclusive(a)
    // b 与 a 无父子关系 → 打开 b 时 a 已经被关，重新登记两个模拟「都开着」
    claimExclusive(b)
    claimExclusive(a)
    expect(a.closed.length + b.closed.length).toBeGreaterThan(0)
    closeAllExclusives()
    expect(openExclusiveCount()).toBe(0)
  })
})

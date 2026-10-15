/**
 * 主题默认件的浮层链与互斥表 —— **本插件自己那份实现**。
 *
 * 用户口径（2026-10-15）：「他们每一个插件都是独立的……你就需要单独的对他们两个库里面
 * 单独的进行一个实现，你复制成两份，放在这两个地方都行，但是你不能动核心层」。
 *
 * 这条测试钉住两件事：
 *   ① 实现确实住在本插件里（不从核心层转发 —— 转发就等于又把逻辑放回核心层）；
 *   ② 行为成立（祖先豁免：内层下拉不关掉自己所在的父面板）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { floatingChainOf, isInFloatingGroup, childChainFor, isChainAncestorOf, FLOATING_CHAIN_ATTR } from '../floatingChain'
import { claimDropdownExclusive, releaseDropdown, openDropdownCount, closeAllDropdowns } from '../dropdownRegistry'

const CHAIN_SRC = readFileSync(new URL('../floatingChain.ts', import.meta.url), 'utf-8')
const REGISTRY_SRC = readFileSync(new URL('../dropdownRegistry.ts', import.meta.url), 'utf-8')

describe('实现住在本插件里（不动核心层）', () => {
  it('floatingChain.ts 是自己的实现，不是从 canvas-render 转发', () => {
    expect(CHAIN_SRC).toMatch(/export function floatingChainOf/)
    expect(CHAIN_SRC).toMatch(/export function isChainAncestorOf/)
    expect(CHAIN_SRC).not.toMatch(/from '@mini-canvas\/canvas-render'/)
  })

  it('dropdownRegistry.ts 是自带登记表，不再从 canvas-render 转发', () => {
    expect(REGISTRY_SRC).toMatch(/export function claimDropdownExclusive/)
    expect(REGISTRY_SRC).not.toMatch(/from '@mini-canvas\/canvas-render'/)
  })

  it('共享的只有 DOM 契约（data-floating-chain），两处实现都读它', () => {
    expect(FLOATING_CHAIN_ATTR).toBe('data-floating-chain')
    expect(CHAIN_SRC).toMatch(/data-floating-chain|FLOATING_CHAIN_ATTR/)
  })
})

/** 最小假 DOM：只需要「往上找最近的浮层根」这一件事 */
function el(chain?: string, parent: unknown = null): unknown {
  const node: Record<string, unknown> = {
    parentElement: parent,
    closest(selector: string) {
      if (selector !== '[' + FLOATING_CHAIN_ATTR + ']') return null
      let cur: Record<string, unknown> | null = node
      while (cur) {
        if (cur.chain) return { dataset: { floatingChain: cur.chain } }
        cur = cur.parentElement as Record<string, unknown> | null
      }
      return null
    },
    chain,
  }
  return node
}

describe('浮层链判定（本插件那份）', () => {
  it('从后代读回整条链；嵌套时读最近那层', () => {
    expect(floatingChainOf(el('dd-a', el()))).toEqual(['dd-a'])
    expect(floatingChainOf(el())).toEqual([])
  })

  it('组内判定：自己派生的子面板算组内，别人家的算组外', () => {
    expect(isInFloatingGroup(el('dd-a dd-b', el()), 'dd-a')).toBe(true)
    expect(isInFloatingGroup(el('dd-x', el()), 'dd-a')).toBe(false)
  })

  it('子链 = 锚点所在链 + 自己', () => {
    expect(childChainFor(el('dd-a', el()), 'dd-b')).toBe('dd-a dd-b')
    expect(childChainFor(el(), 'dd-c')).toBe('dd-c')
  })

  it('祖先判定：严格前缀才算祖先；空链谁都不豁免', () => {
    expect(isChainAncestorOf(['dd-p'], ['dd-p', 'dd-c'])).toBe(true)
    expect(isChainAncestorOf(['dd-b'], ['dd-a'])).toBe(false)
    expect(isChainAncestorOf([], ['dd-a'])).toBe(false)
  })
})

describe('互斥表（本插件那份）：祖先豁免', () => {
  // 登记表是模块级单例，用例之间清干净（closer 会自摘，所以关完就该是空的）
  beforeEach(() => closeAllDropdowns())

  function fakeFloating(chain: string[]) {
    const state = { open: true }
    const close = (): void => {
      state.open = false
      releaseDropdown(close)
    }
    claimDropdownExclusive(close, () => chain)
    return state
  }

  it('平级互斥：后开的把先开的关掉', () => {
    const a = fakeFloating(['dd-a'])
    const b = fakeFloating(['dd-b'])
    expect(a.open).toBe(false)
    expect(b.open).toBe(true)
    expect(openDropdownCount()).toBe(1)
  })

  it('祖先豁免：内层下拉不关掉自己所在的父面板', () => {
    const parent = fakeFloating(['dd-parent'])
    const child = fakeFloating(['dd-parent', 'dd-child'])
    expect(parent.open, '父面板必须留着').toBe(true)
    expect(child.open).toBe(true)
    expect(openDropdownCount()).toBe(2)
  })
})

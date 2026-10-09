/**
 * 浮层「组」判定（用户报「嵌套菜单无法点击」的回归防线）。
 *
 * 真机事故链（2026-10-07 实测复现）：
 *   二级菜单的面板 teleport 到 body，DOM 上**不在**父菜单面板里；
 *   父级下拉的 click-outside 只认自己的触发器 + 面板 → 点在二级菜单项上被判成「点了外面」
 *   → 父菜单先关、二级面板随父卸载 → click 派发时目标已脱离文档，Vue 的 click 回调不再执行。
 *   用户看到的现象：嵌套菜单能展开，但点下去什么也不发生。
 *
 * 契约：每个浮层根写 data-floating-chain = 「父链 + 自己 id」；
 * 「这一点算不算我这一组」= 命中的链里有没有我的 id。
 */
import { describe, it, expect } from 'vitest'
import { floatingChainOf, isInFloatingGroup, childChainFor } from '../components/hooks/floatingGroup'

/**
 * 最小假 DOM：只实现本模块用到的两件事 —— closest(选择器) 与 dataset.floatingChain。
 * ui 包的 vitest 跑在 node 环境（没有 document），而本模块是纯函数，用假对象测更稳。
 */
interface FakeEl {
  tag: string
  chain?: string
  parent: FakeEl | null
  dataset: { floatingChain?: string } | undefined
  closest(selector: string): { dataset?: { floatingChain?: string } } | null
  parentElement: FakeEl | null
}

function el(tag: string, chain?: string): FakeEl {
  const node = {
    tag,
    chain,
    parent: null as FakeEl | null,
    get dataset() {
      return chain ? { floatingChain: chain } : undefined
    },
    closest(selector: string) {
      // 只支持这一种选择器：找最近的「带 data-floating-chain 的祖先（含自己）」
      if (selector !== '[data-floating-chain]') return null
      let cur: FakeEl | null = node
      while (cur) {
        if (cur.chain) return { dataset: { floatingChain: cur.chain } }
        cur = cur.parent
      }
      return null
    },
    get parentElement() {
      return node.parent
    },
  }
  return node
}

/** 造一条链：panel(chain) > … > leaf（depth 层，最里面是按钮） */
function panelWith(chain: string, depth = 2): FakeEl {
  const panel = el('div', chain)
  let cur: FakeEl = panel
  for (let i = 0; i < depth; i++) {
    const child = el(i === depth - 1 ? 'button' : 'div')
    child.parent = cur
    cur = child
  }
  return cur
}

describe('floatingChainOf', () => {
  it('没有浮层祖先 → 空数组（不能误判成组内）', () => {
    expect(floatingChainOf(el('div'))).toEqual([])
    expect(floatingChainOf(null)).toEqual([])
  })

  it('从后代读回整条链（一级面板 = 自己一个 id）', () => {
    expect(floatingChainOf(panelWith('dd-a', 2))).toEqual(['dd-a'])
  })

  it('三级嵌套：子面板链 = 父链 + 自己，读的是最近的浮层根', () => {
    expect(floatingChainOf(panelWith('dd-a dd-b', 1))).toEqual(['dd-a', 'dd-b'])
  })
})

describe('isInFloatingGroup', () => {
  it('点在自己派生出的二级面板里 → 组内（父菜单不许关）', () => {
    const leaf = panelWith('dd-a dd-b', 1)
    expect(isInFloatingGroup(leaf, 'dd-a')).toBe(true)
    expect(isInFloatingGroup(leaf, 'dd-b')).toBe(true)
  })

  it('点在自己面板里的普通元素 → 组内', () => {
    expect(isInFloatingGroup(panelWith('dd-a', 1), 'dd-a')).toBe(true)
  })

  it('点在别人家的浮层里 → 组外（该关）', () => {
    expect(isInFloatingGroup(panelWith('dd-x', 1), 'dd-a')).toBe(false)
  })

  it('点在画布/普通 DOM 上 → 组外；空目标也不炸', () => {
    expect(isInFloatingGroup(el('div'), 'dd-a')).toBe(false)
    expect(isInFloatingGroup(null, 'dd-a')).toBe(false)
  })

  it('事件目标是 Text 节点时用父元素判定（真实点击的 target 可能是文本）', () => {
    const leaf = panelWith('dd-a', 1)
    expect(isInFloatingGroup({ parentElement: leaf }, 'dd-a')).toBe(true)
  })
})

describe('childChainFor', () => {
  it('子面板链 = 锚点所在链 + 自己 id', () => {
    expect(childChainFor(panelWith('dd-a', 1), 'dd-b')).toBe('dd-a dd-b')
  })

  it('锚点不在任何浮层里 → 只有自己（一级浮层/独立使用都不崩）', () => {
    expect(childChainFor(el('div'), 'dd-c')).toBe('dd-c')
    expect(childChainFor(null, 'dd-c')).toBe('dd-c')
  })
})


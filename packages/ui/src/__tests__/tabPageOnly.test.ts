/**
 * Tab 落点规则（tabPageOnly.ts）的单测。
 *
 * 用户口径（2026-10-14）：
 *   ①「整个页面的内容都不支持聚焦，除了弹出框最底下的几个按钮」；
 *   ②「你 CSS 是关闭了，看不见了，但是它的实际功能依然存在。比如说 table 的时候，
 *      它依然会进行一个聚焦」—— 所以这里测的是**行为**（Tab 到底动不动），不是样式。
 *
 * 测试环境是 node（没有 jsdom），所以这里手搓一个极小的 DOM 桩，只实现被用到的四件事：
 *   querySelectorAll(选择器) / classList.contains / tagName / getAttribute。
 * 用桩而不是塞 jsdom：仓库现在没装 jsdom，为了一条单测引入整个 DOM 实现对不上收益
 * （真实浏览器的行为另用 Chrome MCP 在真机上验）。
 */
import { describe, it, expect } from 'vitest'
import { handleTab, isTextEntryElement, topOverlay, OVERLAY_ROOT_CLASS } from '../tabPageOnly'

// ==================== 极小 DOM 桩 ====================

interface StubEl {
  tagName: string
  classes: string[]
  attrs: Record<string, string>
  children: StubEl[]
  classList: { contains: (c: string) => boolean }
  getAttribute: (n: string) => string | null
  contains: (n: StubEl) => boolean
  querySelectorAll: (sel: string) => StubEl[]
  isConnected: boolean
  focus: () => void
  disabled: boolean
}

function el(tagName: string, classes: string[] = [], attrs: Record<string, string> = {}): StubEl {
  const node: StubEl = {
    tagName: tagName.toUpperCase(),
    classes,
    attrs,
    children: [],
    isConnected: true,
    disabled: false,
    classList: { contains: (c: string) => classes.includes(c) },
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    contains: (n: StubEl) => {
      if (n === node) return true
      return node.children.some((c) => c.contains(n))
    },
    querySelectorAll: (sel: string) => {
      const one = (x: StubEl, s: string): boolean => {
        if (s.startsWith('.')) return x.classList.contains(s.slice(1))
        return x.tagName === s.toUpperCase()
      }
      const match = (x: StubEl): boolean => {
        const s = sel.trim()
        if (s.includes(',')) return s.split(',').some((part) => one(x, part.trim()))
        return one(x, s)
      }
      const out: StubEl[] = []
      const walk = (list: StubEl[]) => {
        for (const c of list) {
          if (match(c)) out.push(c)
          walk(c.children)
        }
      }
      walk(node.children)
      return out
    },
    focus: () => {
      doc.activeElement = node as unknown as Element
    },
  }
  return node
}

interface StubDoc {
  activeElement: Element | null
  querySelectorAll: (sel: string) => StubEl[]
}

let doc: StubDoc
function mount(...nodes: StubEl[]): void {
  const body = el('body')
  body.children = nodes
  doc = {
    activeElement: null,
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
  }
}
const asDoc = () => doc as unknown as Document
const asEl = (x: StubEl | null) => x as unknown as Element | null

// ==================== 用例 ====================

describe('Tab 落点：页面上不漫游', () => {
  it('没有浮层时 Tab 被接管（焦点不动）', () => {
    const a = el('button')
    const b = el('button')
    mount(a, b)
    doc.activeElement = asEl(a)
    expect(handleTab(asDoc(), asEl(a), false)).toBe(true)
    expect(doc.activeElement).toBe(a as unknown as Element)
  })

  it('没有浮层时 Shift+Tab 同样被接管', () => {
    const a = el('button')
    mount(a)
    doc.activeElement = asEl(a)
    expect(handleTab(asDoc(), asEl(a), true)).toBe(true)
    expect(doc.activeElement).toBe(a as unknown as Element)
  })

  it('输入框里按 Tab 不劫持（那里的 Tab 是补全 / 缩进）', () => {
    const input = el('input', [], { type: 'text' })
    const overlay = el('div', ['axdlg-panel'])
    const btn = el('button')
    overlay.children = [input, btn]
    mount(overlay)
    doc.activeElement = asEl(input)
    expect(handleTab(asDoc(), asEl(input), false)).toBe(false)
  })

  it('文本域与可编辑区里的 Tab 也不劫持', () => {
    expect(isTextEntryElement(asEl(el('textarea')))).toBe(true)
    expect(isTextEntryElement(asEl(el('div', ['ProseMirror'])))).toBe(true)
    expect(isTextEntryElement(asEl(el('div', [], { contenteditable: 'true' })))).toBe(true)
    expect(isTextEntryElement(asEl(el('input', [], { type: 'checkbox' })))).toBe(false)
    expect(isTextEntryElement(asEl(el('button')))).toBe(false)
  })
})

describe('Tab 落点：浮层里循环', () => {
  it('模态打开时 Tab 只在面板内走（走到末尾回到第一个）', () => {
    const b1 = el('button')
    const b2 = el('button')
    const panel = el('div', ['axdlg-panel'])
    panel.children = [b1, b2]
    mount(panel)
    doc.activeElement = asEl(b1)
    expect(handleTab(asDoc(), asEl(b1), false)).toBe(true)
    expect(doc.activeElement).toBe(b2 as unknown as Element)
    expect(handleTab(asDoc(), asEl(b2), false)).toBe(true)
    expect(doc.activeElement).toBe(b1 as unknown as Element)
    expect(handleTab(asDoc(), asEl(b1), true)).toBe(true)
    expect(doc.activeElement).toBe(b2 as unknown as Element)
  })

  it('焦点不在面板内时，Tab 把焦点收进面板第一个', () => {
    const b1 = el('button')
    const panel = el('div', ['axdlg-panel'])
    panel.children = [b1]
    const outer = el('button')
    mount(panel, outer)
    doc.activeElement = asEl(outer)
    expect(handleTab(asDoc(), asEl(outer), false)).toBe(true)
    expect(doc.activeElement).toBe(b1 as unknown as Element)
  })

  it('多层浮层时用 DOM 最后那个（= 最新打开 / 叠在最上）', () => {
    const first = el('div', ['axdlg-panel'])
    const last = el('div', ['axdlg-panel'])
    const b = el('button')
    last.children = [b]
    mount(first, last)
    expect(topOverlay(asDoc())).toBe(last as unknown as Element)
  })

  it('显式标了最高层的那个优先（即使 DOM 顺序在前）', () => {
    const top = el('div', [OVERLAY_ROOT_CLASS, 'tab-scope-top'])
    const later = el('div', ['axdlg-panel'])
    mount(top, later)
    expect(topOverlay(asDoc())).toBe(top as unknown as Element)
  })

  it('禁用与 tabindex=-1 的元素不参与循环', () => {
    const dead = el('button')
    dead.disabled = true
    const skip = el('button', [], { tabindex: '-1' })
    const ok = el('button')
    const panel = el('div', ['axdlg-panel'])
    panel.children = [dead, skip, ok]
    mount(panel)
    doc.activeElement = asEl(ok)
    expect(handleTab(asDoc(), asEl(ok), false)).toBe(true)
    expect(doc.activeElement).toBe(ok as unknown as Element)
  })
})

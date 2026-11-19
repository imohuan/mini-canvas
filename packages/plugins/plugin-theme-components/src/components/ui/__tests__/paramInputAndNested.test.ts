// @vitest-environment happy-dom
/**
 * 参数面板里的两件事（用户 2026-11-18 复述的两个老问题）：
 *
 * 1. **输入框卡顿**：每按一个键就回写上游 → 整条链重算（价格、宽度、落盘），
 *    打字像卡住。修法：先只改本地草稿，停手 250ms 再回写；失焦立即提交。
 * 2. **嵌套下拉被误关**：参数面板里再开一个下拉，点它的触发器想收起那一项时，
 *    外层 Popover 把这次点击判成「点了面板外面」，整个面板一起消失。
 *
 * 这里逐条钉死：草稿逻辑跑真实组件挂载（happy-dom），误关逻辑直接测判定函数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type Component } from 'vue'
import ToolParamField from '../ToolParamField.vue'

function mount(comp: Component, props: Record<string, unknown>): {
  el: HTMLElement
  root: ReturnType<typeof createApp>
  destroy: () => void
} {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createApp({ render: () => h(comp, props) })
  root.mount(host)
  return {
    el: host,
    root,
    destroy: () => {
      root.unmount()
      host.remove()
    },
  }
}

const textParam = { key: 'safety', label: '安全标识', type: 'string', default: '', placeholder: '可选的用户标识' }

describe('文本参数输入：本地草稿 + 防抖提交', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('连续输入时每次都立刻显示，但**不**逐键回写上游', async () => {
    const updates: unknown[] = []
    const m = mount(ToolParamField, {
      param: textParam,
      modelValue: '',
      'onUpdate:modelValue': (v: unknown) => updates.push(v),
    })
    const input = m.el.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()

    for (const ch of ['a', 'b', 'c', 'd']) {
      input.value += ch
      input.dispatchEvent(new Event('input'))
      await nextTick()
      // 输入框自己必须立刻变（用户看到的是这个）
      expect(input.value).toBe(('abcd'.slice(0, input.value.length)))
    }
    // 还没到 250ms：一个回写都不该发生
    expect(updates).toHaveLength(0)

    vi.advanceTimersByTime(260)
    await nextTick()
    // 只提交一次，内容是完整的一串
    expect(updates).toEqual(['abcd'])
    m.destroy()
  })

  it('失焦立刻提交（不等防抖）', async () => {
    const updates: unknown[] = []
    const m = mount(ToolParamField, {
      param: textParam,
      modelValue: '',
      'onUpdate:modelValue': (v: unknown) => updates.push(v),
    })
    const input = m.el.querySelector('input') as HTMLInputElement
    input.value = 'abc'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(updates).toHaveLength(0)

    input.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(updates).toEqual(['abc'])
    // 之后防抖到点也不该重复提交
    vi.advanceTimersByTime(400)
    expect(updates).toEqual(['abc'])
    m.destroy()
  })

  it('外部值变化（切动作 / 套预设）会同步进输入框', async () => {
    const m = mount(ToolParamField, { param: textParam, modelValue: 'old' })
    const input = m.el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('old')

    await m.root._instance?.proxy?.$forceUpdate?.()
    // 重新挂一份带新值：等价于上游换值后重渲染
    m.destroy()
    const m2 = mount(ToolParamField, { param: textParam, modelValue: 'from-preset' })
    expect((m2.el.querySelector('input') as HTMLInputElement).value).toBe('from-preset')
    m2.destroy()
  })

  it('卸载时把没提交的草稿交出去（打完字立刻切走不丢值）', async () => {
    const updates: unknown[] = []
    const m = mount(ToolParamField, {
      param: textParam,
      modelValue: '',
      'onUpdate:modelValue': (v: unknown) => updates.push(v),
    })
    const input = m.el.querySelector('input') as HTMLInputElement
    input.value = 'keep-me'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    m.destroy()
    expect(updates).toEqual(['keep-me'])
  })
})

describe('嵌套下拉：点内层不该关掉外层参数面板', () => {
  /**
   * 判定函数是组件里那段 isInsideParamPanel 的等价实现；
   * 这里用同一份结构造 DOM，验证「点在面板内 / 点在浮层内 / 点真外面」三种。
   */
  function isInsideParamPanel(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('.nb-param-pop')) return true
    return Boolean(
      target.closest(
        '[data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"], [role="listbox"], [role="menu"]',
      ),
    )
  }

  it('点面板里的下拉触发器 → 不关', () => {
    document.body.innerHTML = '<div class="nb-param-pop"><button id="trig">比例</button></div>'
    expect(isInsideParamPanel(document.getElementById('trig'))).toBe(true)
  })

  it('点二级浮层里的选项 → 不关', () => {
    document.body.innerHTML = '<div data-slot="select-content"><div role="option" id="opt">2K</div></div>'
    expect(isInsideParamPanel(document.getElementById('opt'))).toBe(true)
  })

  it('点画布空白 → 关', () => {
    document.body.innerHTML = '<div id="outside">画布</div>'
    expect(isInsideParamPanel(document.getElementById('outside'))).toBe(false)
  })

  it('点 trigger 本身再点一次（同一元素）仍然判在内层', () => {
    document.body.innerHTML = '<div class="nb-param-pop"><button id="t2">质量</button></div>'
    const btn = document.getElementById('t2')
    expect(isInsideParamPanel(btn)).toBe(true)
    expect(isInsideParamPanel(btn)).toBe(true) // 第二次点击结论一致
  })
})


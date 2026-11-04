/**
 * 设置字段桥：provide 出去的必须是**组件**，且换目录赢家时已挂载的子树要跟着换。
 *
 * 回归的是实际 bug：provide 了 ComputedRef（不是组件），下游 <component :is> 静默空白；
 * 以及把组件对象在 provide 时拍成快照后，主题热替换不再生效。
 */
import { describe, expect, it } from 'vitest'
import { createRenderer, defineComponent, h, nextTick, shallowRef, type Component } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { createSettingsFieldBridge } from '../settingsFieldBridge'

interface HNode { tag: string; props: Record<string, unknown>; children: HNode[]; parent: HNode | null; text: string }
function hnode(tag: string): HNode { return { tag, props: {}, children: [], parent: null, text: '' } }

const { createApp } = createRenderer<HNode, HNode>({
  patchProp(el, key, _prev, next) { el.props[key] = next },
  insert(child, parent, anchor) {
    if (child.parent) {
      const at = child.parent.children.indexOf(child)
      if (at >= 0) child.parent.children.splice(at, 1)
    }
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
    child.parent = parent
  },
  remove(child) {
    if (!child.parent) return
    const at = child.parent.children.indexOf(child)
    if (at >= 0) child.parent.children.splice(at, 1)
    child.parent = null
  },
  createElement: (type: string) => hnode(type),
  createText(text) { const n = hnode('#text'); n.text = text; return n },
  createComment(text) { const n = hnode('#comment'); n.text = text; return n },
  setText(n, text) { n.text = text },
  setElementText(el, text) { el.children = []; el.text = text },
  parentNode: (n) => n.parent,
  nextSibling(n) {
    if (!n.parent) return null
    const at = n.parent.children.indexOf(n)
    return n.parent.children[at + 1] ?? null
  },
})

function textOf(n: HNode): string {
  return n.text + n.children.map(textOf).join('')
}

const settings = { groupOf: () => [], onChange: () => ({ dispose() {} }) } as unknown as SettingsPanelSource

describe('设置字段桥', () => {
  it('provide 的是组件：渲染时真的画出字段控件的内容', () => {
    const Target = defineComponent({
      name: 'TargetField',
      props: { group: String, fieldKey: String },
      setup(props) { return () => h('field', { 'data-key': props.fieldKey }, '字段内容') },
    })
    const Bridge = createSettingsFieldBridge(() => Target as Component, defineComponent({ render: () => h('fallback') }))
    const root = hnode('root')
    const app = createApp({ render: () => h(Bridge, { group: 'g', fieldKey: 'k', settings }) })
    app.mount(root)
    const all = textOf(root)
    expect(all).toContain('字段内容')
    app.unmount()
  })

  it('目录赢家热替换后，已挂载的字段跟着换', async () => {
    const A = defineComponent({ name: 'FieldA', render: () => h('field-a') })
    const B = defineComponent({ name: 'FieldB', render: () => h('field-b') })
    const winner = shallowRef<Component>(A)
    const Bridge = createSettingsFieldBridge(() => winner.value, A)
    const root = hnode('root')
    const app = createApp({ render: () => h(Bridge, { group: 'g', fieldKey: 'k', settings }) })
    app.mount(root)
    expect(root.children[0]?.tag).toBe('field-a')
    winner.value = B
    await nextTick()
    expect(root.children[0]?.tag).toBe('field-b')
    app.unmount()
  })
})

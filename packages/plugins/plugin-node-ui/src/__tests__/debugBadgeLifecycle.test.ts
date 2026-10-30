/**
 * DebugBadge 的卸载契约：组件从标题栏消失后，事件总线上不能留下它的监听。
 *
 * 为什么值得单测：总线的监听集合是模块级的，挂在每个节点标题右侧的标签都会订阅一次。
 * 用户反复开关画布 / 切画布时组件不停地挂载拆卸，若退订句柄被丢掉，监听器只增不减 ——
 * 纯内存泄漏，界面上看不出来，只能靠计数锁住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as vue from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import * as bus from '../debugEventBus'
import { uiDebugListenerCount } from '../debugEventBus'

/**
 * 现场编译 DebugBadge.vue（客户端版）。
 *
 * 为什么不直接 `import '../DebugBadge.vue'`：本包 vitest 跑在 node 环境，
 * 直接 import 会走 vite 的 SSR 分支（SFC 里出现 useSSRContext，setup 直接抛错），
 * 也就拿不到真正的客户端生命周期。与 plugin-agent 的组件测试同一套办法。
 */
function loadBadge(): vue.Component {
  const source = readFileSync(new URL('../DebugBadge.vue', import.meta.url), 'utf-8')
  const { descriptor, errors } = parse(source, { filename: 'DebugBadge.vue' })
  if (errors.length) throw new Error('DebugBadge.vue 解析失败：' + errors.map(String).join('；'))
  const compiled = compileScript(descriptor, { id: 'debug-badge-test', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const requireShim = (id: string): unknown => {
    if (id === 'vue') return vue
    if (id.startsWith('./debugEventBus')) return bus
    throw new Error('不认识这个依赖：' + id)
  }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, requireShim)
  return mod.exports.default as vue.Component
}

const DebugBadge = loadBadge()

interface HNode {
  tag: string
  props: Record<string, unknown>
  children: HNode[]
  parent: HNode | null
  text: string
}

function hnode(tag: string): HNode {
  return { tag, props: {}, children: [], parent: null, text: '' }
}

/** 内存节点渲染器：这个包跑在 node 环境，没有 DOM（与 plugin-agent 既有测试同一套办法） */
const { createApp } = vue.createRenderer<HNode, HNode>({
  patchProp(el: HNode, key: string, _prev: unknown, next: unknown) {
    el.props[key] = next
  },
  insert(child: HNode, parent: HNode, anchor: HNode | null | undefined) {
    if (child.parent) {
      const at = child.parent.children.indexOf(child)
      if (at >= 0) child.parent.children.splice(at, 1)
    }
    const at = anchor ? parent.children.indexOf(anchor) : -1
    if (at >= 0) parent.children.splice(at, 0, child)
    else parent.children.push(child)
    child.parent = parent
  },
  remove(child: HNode) {
    if (!child.parent) return
    const at = child.parent.children.indexOf(child)
    if (at >= 0) child.parent.children.splice(at, 1)
    child.parent = null
  },
  createElement: (type: string) => hnode(type),
  createText(text: string) {
    const n = hnode('#text')
    n.text = text
    return n
  },
  createComment(text: string) {
    const n = hnode('#comment')
    n.text = text
    return n
  },
  setText(n: HNode, text: string) {
    n.text = text
  },
  setElementText(el: HNode, text: string) {
    el.children = []
    el.text = text
  },
  parentNode: (n: HNode) => n.parent,
  nextSibling(n: HNode) {
    if (!n.parent) return null
    const at = n.parent.children.indexOf(n)
    return n.parent.children[at + 1] ?? null
  },
})

function mountBadge(nodeId: string) {
  const root = hnode('#root')
  const app = createApp({ render: () => vue.h(DebugBadge as never, { nodeId, data: {} }) })
  app.mount(root)
  return { app, root }
}

describe('DebugBadge 生命周期', () => {
  it('挂载进来一个监听、卸载后一个都不留（反复开关也不累积）', () => {
    const before = uiDebugListenerCount()
    const { app } = mountBadge('n1')
    expect(uiDebugListenerCount() - before, '挂载后没有订阅调试事件').toBe(1)
    app.unmount()
    expect(uiDebugListenerCount(), '组件卸载了，事件总线上还留着监听（会随开关次数累积）').toBe(before)
  })

  it('连开三张标签再全关掉，监听数回到原点（每个节点各一份）', () => {
    const before = uiDebugListenerCount()
    const apps = ['a', 'b', 'c'].map((id) => mountBadge(id).app)
    expect(uiDebugListenerCount() - before).toBe(3)
    for (const a of apps) a.unmount()
    expect(uiDebugListenerCount(), '多张标签的监听没有回收').toBe(before)
  })
})

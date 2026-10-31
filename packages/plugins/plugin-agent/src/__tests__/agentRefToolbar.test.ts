/**
 * **多选框「上控制栏」**的「引用到 Agent」按钮（用户口径 2026-10-08）——
 * 「向主节点的顶部控制栏注册一个按钮，该按钮的功能就是'添加到 Agent 效果'，
 *  以及右键菜单中的'引用 Agent'效果是一样的」；做法参考「加入资产库」。
 *
 * 「加入资产库」挂在多选框（选择集）的顶栏（`ctx.selectionRegion.attach`），不是节点操作条 ——
 * 本文件按那条接缝锁三层（照本包既有做法：queueUi / toolViewImagePreview 的内存渲染器先例）：
 *   ① 接线（真内核 + 真插件）：条目落进 selection/region 场的 out:top（needs 带 selection）、
 *      命令注册进 command 服务且两个入口共用同一条；
 *   ② 行为（真挂载 + 真点击）：点了真的执行那条命令、payload 是**整批**选中节点；
 *      无选中 / 缺命令服务 / 目录缺 button 三种情形都不炸；
 *   ③ 源码守卫：取服务不写 `ctx.command` / `ctx.doc` 直属性（根 Context 没有服务代理，
 *      会静默 no-op —— plugin-group「解散分组点不动」那个真 bug 的教训），
 *      两个入口共用同一个命令 id 常量（不在组件里写字符串字面量）。
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vue from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { Context } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import type { CommandService } from '@mini-canvas/kernel'
import * as renderPkg from '@mini-canvas/canvas-render'
import { agentPlugin } from '../agentPlugin'
import AgentRefToolbar from '../components/AgentRefToolbar.vue'
import * as commandsMod from '../agentCommands'
import * as resourcesMod from '../agentResources'
import { AGENT_REFERENCE_COMMAND_ID } from '../agentCommands'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(HERE, rel), 'utf8')

/* —————————————————— ① 接线：真内核装载真插件 —————————————————— */

async function bootPlugin(): Promise<Context> {
  const ctx = new Context()
  ctx.inject('command', new CommandRegistry())
  ctx.plugin(agentPlugin)
  await ctx.start()
  return ctx
}

describe('接线：多选上控制栏条目 + 命令注册', () => {
  it('把「引用到 Agent」挂到多选框的 out:top（selection/region 场，与「加入资产库」同一条接缝）', async () => {
    const ctx = await bootPlugin()
    const entries = ctx.registryOf('selection/region').list('out:top')
    const mine = entries.find((e) => e.id === 'agent-refer-selection')
    expect(mine, 'selection/region 场的 out:top 里没有 agent-refer-selection').toBeTruthy()
    const value = mine!.value as { component: unknown; needs?: string[] }
    expect(value.component).toBe(AgentRefToolbar)
    // 组件靠 needs 拿选中集（与打组按钮、加入资产库同一规矩）
    expect(value.needs).toEqual(['selection'])
    ctx.stop()
  })

  it('命令 id 就是右键菜单那条（areas 含 node → 右键菜单自动收它）', async () => {
    const ctx = await bootPlugin()
    const cmds = ctx.get<CommandService>('command').list()
    const ref = cmds.find((c) => c.id === AGENT_REFERENCE_COMMAND_ID)
    expect(ref, '命令 ' + AGENT_REFERENCE_COMMAND_ID + ' 没注册').toBeTruthy()
    expect(ref!.title).toBe('引用到 Agent')
    expect(ref!.areas).toEqual(['node'])
    ctx.stop()
  })

  it('命令 id 常量值锁死（e2e 选择器与右键菜单都认这个字符串）', () => {
    expect(AGENT_REFERENCE_COMMAND_ID).toBe('agent:reference-node')
  })

  it('卸载插件后条目与命令一起回收（热卸无残留）', async () => {
    const ctx = await bootPlugin()
    ctx.uninstallPlugin('agent')
    expect(ctx.registryOf('selection/region').list('out:top')).toHaveLength(0)
    expect(ctx.get<CommandService>('command').has(AGENT_REFERENCE_COMMAND_ID)).toBe(false)
    ctx.stop()
  })
})

/* —————————————————— ② 行为：现场编译 SFC + 内存渲染器 + 真点击 —————————————————— */

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

function findAll(n: HNode, out: HNode[] = []): HNode[] {
  out.push(n)
  for (const c of n.children) findAll(c, out)
  return out
}

/** 目录里的 button 替身：真组件用 useUiComponent 取件，这里给一个「点得出事件」的按钮 */
const StubButton = vue.defineComponent({
  name: 'StubButton',
  props: {
    icon: { type: [String, Object], default: undefined },
    disabled: { type: Boolean, default: false },
  },
  emits: ['click'],
  setup(props, { slots, emit }) {
    // disabled 必须透传到真按钮上：禁用态是这条按钮的契约之一（没选中就不该再引），
    // 替身若吞掉它，测试就锁不住「一个都没选中时按钮是禁用的」。
    return () =>
      vue.h(
        'button',
        { class: 'stub-btn', disabled: props.disabled, onClick: (e: unknown) => emit('click', e) },
        slots.default?.(),
      )
  },
})

/**
 * 把 AgentRefToolbar.vue 现场编译成客户端组件。
 *
 * 为什么走 compiler-sfc + transpile + requireShim（而不是 import .vue 直接挂）：
 * 本包 vitest 跑在 node 环境（没有 jsdom / @vue/test-utils），SSR 产物又挂不起客户端事件 ——
 * 与 queueUi / toolViewImagePreview 同一套办法，能真派发事件而不是只盯源码字符串。
 */
function loadComponent(): unknown {
  const { descriptor, errors } = parse(read('../components/AgentRefToolbar.vue'), { filename: 'AgentRefToolbar.vue' })
  if (errors.length) throw new Error('AgentRefToolbar.vue 解析失败：' + errors.map(String).join('；'))
  const compiled = compileScript(descriptor, { id: 'agent-ref-test', inlineTemplate: true })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const requireShim = (id: string): unknown => {
    if (id === 'vue') return vue
    if (id === '@mini-canvas/canvas-render') return renderPkg
    if (id.startsWith('../agentCommands')) return commandsMod
    if (id.startsWith('../agentResources')) return resourcesMod
    throw new Error('不认识这个依赖（测试的 require 只放已知几项）：' + id)
  }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, requireShim)
  return mod.exports.default
}

const Comp = loadComponent() as vue.Component

interface MountOpts {
  /** 选中集：缺省 = 选中两个节点（多选框的典型场景） */
  selectedIds?: string[]
  /** 命令服务：缺省给一个记录器；传 null = 宿主没这个服务 */
  command?: { runCommand(id: string, ...payload: unknown[]): unknown } | null
  /** ui 目录里登记 button 件？false = 走「回退原生按钮」的降级路径 */
  withCatalog?: boolean
}

/** 宿主给该区域条目 provide 的能力袋（RegionEntryHost 做的事，这里照它的形状打桩） */
function mount(opts: MountOpts = {}) {
  const ids = opts.selectedIds ?? ['n1', 'n2']
  const calls: Array<{ id: string; payload: unknown[] }> = []
  const command = opts.command === undefined
    ? { runCommand: (id: string, ...payload: unknown[]) => void calls.push({ id, payload }) }
    : opts.command
  const bag = {
    selection: { ids: () => [...ids], nodes: () => ids.map((id) => ({ id, type: 'image' })) },
  }
  const ctx = {
    get: () => undefined,
    tryGet: (name: string): unknown => (name === 'canvas' ? command ?? undefined : undefined),
    registryOf: () => ({
      top: (name: string) => (opts.withCatalog !== false && name === 'button' ? { value: StubButton } : undefined),
      list: () => [],
      subscribe: () => ({ dispose() {} }),
    }),
    isDev: false,
  }
  const root = hnode('#root')
  const app = createApp({
    render: () => vue.h(Comp as never, {}),
  })
  app.provide(renderPkg.RENDER_CONTEXT_KEY, { ctx } as never)
  app.provide(renderPkg.CAPABILITY_BAG_KEY, bag)
  app.provide(renderPkg.CAPABILITY_SCOPE_KEY, { declared: ['selection'], isDev: false })
  app.mount(root)
  return { root, calls }
}

function findButton(root: HNode): HNode | undefined {
  return findAll(root).find((n) => n.tag === 'button')
}

/** 点：同一个 prop 可能挂着一串处理器，逐个跑 */
function fireClick(el: HNode): void {
  const raw = el.props.onClick
  const list = Array.isArray(raw) ? raw : [raw]
  for (const fn of list) if (typeof fn === 'function') (fn as (e: unknown) => void)({})
}

describe('按钮行为：点击与降级', () => {
  it('渲染出「引用到 Agent」按钮（文案 / title / aria-label 齐全）', () => {
    const { root } = mount()
    const btn = findButton(root)
    expect(btn, '按钮没渲染出来').toBeTruthy()
    expect(btn!.props.title).toBe('引用到 Agent')
    expect(btn!.props['aria-label']).toBe('引用到 Agent')
    const texts = findAll(root).map((n) => n.text).join('')
    expect(texts).toContain('引用到 Agent')
  })

  it('点它 = 把**整批**选中节点引用进 Agent（执行同一条命令，payload = { nodeIds }）', () => {
    const { root, calls } = mount({ selectedIds: ['a', 'b', 'c'] })
    fireClick(findButton(root)!)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe(AGENT_REFERENCE_COMMAND_ID)
    expect(calls[0].payload).toEqual([{ nodeIds: ['a', 'b', 'c'] }])
  })

  it('只选中一个也能引（与右键菜单那条一致）', () => {
    const { root, calls } = mount({ selectedIds: ['only'] })
    fireClick(findButton(root)!)
    expect(calls[0].payload).toEqual([{ nodeIds: ['only'] }])
  })

  it('一个都没选中 → 按钮禁用，点了不执行命令', () => {
    const { root, calls } = mount({ selectedIds: [] })
    const btn = findButton(root)!
    expect(btn.props.disabled).toBe(true)
    fireClick(btn)
    expect(calls).toHaveLength(0)
  })

  it('宿主没给 command 服务 → 点了不炸（不白屏）', () => {
    const { root } = mount({ command: null })
    expect(() => fireClick(findButton(root)!)).not.toThrow()
  })

  it('目录里没有 button 件 → 回退原生按钮（降级成「还能点」而不是白屏）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { root, calls } = mount({ withCatalog: false })
      const btn = findButton(root)
      expect(btn).toBeTruthy()
      fireClick(btn!)
      expect(calls).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})

/* —————————————————— ③ 源码守卫（改回错写法时当场红） —————————————————— */

/** 先剥注释再查：解释这条约束的注释自己不该踩中 */
const componentCode = read('../components/AgentRefToolbar.vue')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')

describe('源码守卫', () => {
  it('取服务走 tryGet canvas（直属性在根 Context 上是 undefined → 会静默 no-op）', () => {
    expect(componentCode).not.toMatch(/ctx\.command\b/)
    expect(componentCode).toContain("ctx.tryGet<{ runCommand")
  })

  it('两个入口共用同一个命令 id 常量（不在组件里写字符串字面量）', () => {
    expect(componentCode).toContain('AGENT_REFERENCE_COMMAND_ID')
    expect(componentCode).not.toContain("'agent:reference-node'")
    const plugin = read('../agentPlugin.ts')
    expect(plugin).toContain("import { AGENT_REFERENCE_COMMAND_ID } from './agentCommands.js'")
    expect(plugin).not.toMatch(/id:\s*'agent:reference-node'/)
  })

  it('按钮**不自套** .ntp-root（多选栏已由宿主当唯一背景块；再套一层就是「两个背景」）', () => {
    expect(componentCode).not.toContain('ntp-root')
  })
})

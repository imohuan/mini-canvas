/**
 * 队列 UI 的两条硬口径：**发送键三态**（G1）与**行内三个动作的接线**（G2/G4/G8）。
 *
 * 为什么这么测（照 toolViewImagePreview.test.ts 的先例）：
 * 本包 vitest 跑在 node（没有 jsdom / @vue/test-utils），**整只** AgentConversation
 * 挂不起来 —— 它的 setup 里要 useCanvasRender / 画布服务，还有一堆 .vue 依赖。
 * 于是分两头锁：
 *   ① 能真跑的部分真跑：发送键的那段模板取出来，用真 lucide 图标在内存渲染器里挂出来，
 *      点它、看它 emit 什么（不是"源码里有没有那行字"）；
 *   ② 只能看源码的部分盯源码：队列行里三个按钮接的是哪个方法、⋯ 菜单是不是只有两项、
 *      右侧按钮列是不是上下两个（结构断言，改错立刻红）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as vue from 'vue'
import * as lucide from 'lucide-vue-next'
import { compileTemplate } from 'vue/compiler-sfc'
import ts from 'typescript'
import { sendButtonMode } from '../queueModel'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const host = readFileSync(path.resolve(HERE, '../components/AgentConversation.vue'), 'utf8')

/* —————————————————— ① 发送键：真渲染、真点 —————————————————— */

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

/**
 * 发送键的那段模板（从 label 那一行到 </button>）。
 *
 * 为什么不整只组件挂：见文件头。这段模板用到的三样东西（lucide 图标 / sendMode /
 * submit / agent.stop）在测试里给真值，渲染出来就是**真的那颗按钮**。
 */
function sendButtonTemplate(): string {
  const at = host.indexOf('class="ac-send"')
  if (at < 0) throw new Error('AgentConversation.vue 里找不到 .ac-send 按钮')
  const start = host.lastIndexOf('<button', at)
  const end = host.indexOf('</button>', at)
  if (start < 0 || end < 0) throw new Error('.ac-send 按钮的模板不完整')
  return host.slice(start, end + '</button>'.length)
}

/**
 * 把按钮模板编译成 render 函数。
 *
 * 为什么走 compiler-sfc 而不是 vue.compile：本仓装的 vue 是 **runtime-only** 构建
 * （没有编译器），vue.compile 不存在。compileTemplate 生成的模块代码带
 * `import { … } from 'vue'`，用 typescript 转成 CJS 再喂一个只放 vue 的 require 就够了 ——
 * 与 ToolViewBody 的测试同一套办法。
 */
function loadSendButton(): { render: (ctx: unknown, cache: unknown[]) => unknown } {
  const { code, errors } = compileTemplate({
    source: sendButtonTemplate(),
    filename: 'SendButton.vue',
    id: 'send-button-test',
    // mode 'module' 的产物是 `export function render` —— 转成 CJS 才能喂给 requireShim
    compilerOptions: { mode: 'module', prefixIdentifiers: true },
  })
  if (errors.length) throw new Error('发送键模板编译失败：' + errors.map(String).join('；'))
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod: { exports: Record<string, unknown> } = { exports: {} }
  const requireShim = (id: string): unknown => {
    if (id === 'vue') return vue
    throw new Error('不认识这个依赖（测试的 require 只放 vue）：' + id)
  }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, requireShim)
  return mod.exports as { render: (ctx: unknown, cache: unknown[]) => unknown }
}

interface SendMount {
  root: HNode
  stopped: number[]
  submitted: number[]
}

function mountSendButton(mode: 'send' | 'stop' | 'disabled'): SendMount {
  const compiled = loadSendButton()
  const stopped: number[] = []
  const submitted: number[] = []
  const root = hnode('#root')
  const ctx = {
    sendMode: mode,
    // 模板里点的是"停止"走 agent.stop、"发送"走 submit() —— 都换成记录器
    submit: () => void submitted.push(1),
    agent: { stop: () => void stopped.push(1) },
  }
  // <ArrowUp> 走 _resolveComponent —— 得在宿主组件的 components 里登记（真组件用的就是它）
  createApp({
    components: { ArrowUp: (lucide as unknown as Record<string, vue.Component>).ArrowUp },
    render: () => compiled.render(ctx, []),
  }).mount(root)
  return { root, stopped, submitted }
}

/** 点：同一个 prop 可能挂着一串处理器，逐个跑 */
function fireClick(el: HNode): void {
  const raw = el.props.onClick
  const list = Array.isArray(raw) ? raw : [raw]
  for (const fn of list) if (typeof fn === 'function') (fn as (e: unknown) => void)({})
}

describe('发送键三态（G1）：真渲染 + 真点击', () => {
  it('有内容（跑着也是「发送」）：按钮不是禁用的，红方块（stop 标记）不出现', () => {
    const { root } = mountSendButton('send')
    const btn = findAll(root).find((n) => String(n.props.class ?? '').includes('ac-send'))
    expect(btn).toBeTruthy()
    expect(btn!.props.disabled).toBeFalsy()
    expect(String(btn!.props.class)).not.toContain('is-running')
    const squares = findAll(root).filter((n) => String(n.props.class ?? '').includes('ac-stop-square'))
    expect(squares.length).toBe(0)
    // aria 也说的是「发送」而不是「停止」
    expect(btn!.props['aria-label']).toBe('发送')
  })

  it('有内容 + 正在跑：点它 = 发送（submit），不会终止那一轮', () => {
    // 这是用户口径里最容易写错的一条：跑着时按钮仍是「发送」，不是红方块
    const { root, stopped, submitted } = mountSendButton('send')
    const btn = findAll(root).find((n) => String(n.props.class ?? '').includes('ac-send'))!
    fireClick(btn)
    expect(submitted.length).toBe(1)
    expect(stopped.length).toBe(0)
  })

  it('空 + 正在跑：是红方块「终止」，点它 = agent.stop()', () => {
    const { root, stopped, submitted } = mountSendButton('stop')
    const btn = findAll(root).find((n) => String(n.props.class ?? '').includes('ac-send'))!
    expect(String(btn.props.class)).toContain('is-running')
    expect(btn.props.disabled).toBeFalsy()
    expect(btn.props['aria-label']).toBe('停止')
    fireClick(btn)
    expect(stopped.length).toBe(1)
    expect(submitted.length).toBe(0)
    // 红方块是 CSS 画的（不是图标），它在的时候才说明"这是终止键"
    const squares = findAll(root).filter((n) => String(n.props.class ?? '').includes('ac-stop-square'))
    expect(squares.length).toBe(1)
  })

  it('空 + 空闲：禁用（点不动）', () => {
    const { root, stopped, submitted } = mountSendButton('disabled')
    const btn = findAll(root).find((n) => String(n.props.class ?? '').includes('ac-send'))!
    // 真浏览器对 disabled 的按钮**根本不派发 click**；内存渲染器不模拟这条语义，
    // 所以这里只断言"它确实是 disabled"（那正是点不动的那个原因）。
    expect(btn.props.disabled).toBe(true)
    expect(String(btn.props.class)).not.toContain('is-running')
    expect(stopped.length).toBe(0)
    expect(submitted.length).toBe(0)
  })

  it('三种状态与 queueModel.sendButtonMode 完全一致（按钮不自己发明第四种）', () => {
    const cases: Array<[boolean, boolean]> = [
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ]
    for (const [hasContent, running] of cases) {
      expect(sendButtonMode(hasContent, running)).toBe(
        hasContent ? 'send' : running ? 'stop' : 'disabled',
      )
    }
  })
})

/* —————————————————— ② 队列行 / 右侧按钮列：结构与接线 —————————————————— */

describe('队列行（G2/G4/G8/G10）：结构与接线', () => {
  it('行里三个动作：引导 → steerItem、删除 → removeItem、⋯ 菜单 → 编辑 / 关闭', () => {
    const row = host.slice(host.indexOf('ac-queue-row" role="listitem"'), host.indexOf('class="ac-input-box"'))
    expect(row).toContain('@click="steerItem(row.id)"')
    expect(row).toContain('@click="removeItem(row.id)"')
    expect(row).toContain('@click="beginEditQueue(row.id); close()"')
    expect(row).toContain('@click="closeItem(row.id); close()"')
  })

  it('⋯ 菜单**只有两项**：编辑消息 / 关闭排队（G12 的修正）', () => {
    // 从抽屉开始截（触发器 + 菜单 + 闭合标签），到模板结束
    const start = host.lastIndexOf('<ThemedDropdown', host.indexOf('aria-label="更多操作"'))
    const menu = host.slice(start, host.indexOf('</ThemedDropdown>', host.indexOf('aria-label="更多操作"')))
    expect((menu.match(/role="menuitem"/g) ?? []).length).toBe(2)
    expect(menu).toContain('编辑消息')
    expect(menu).toContain('关闭排队')
    // 菜单走设计系统的 dropdown（定位/翻边/互斥它负责），不自绘浮层
    expect(menu).toContain('ThemedDropdown')
  })

  it('行内容：16×16 缩略图（有图时）+ 单行省略文本 + 编辑中标记（G10）', () => {
    const row = host.slice(host.indexOf('ac-queue-row" role="listitem"'), host.indexOf('class="ac-input-box"'))
    expect(row).toContain('class="ac-queue-thumb"')
    expect(row).toContain('class="ac-queue-text"')
    expect(row).toContain('编辑中')
    expect(host).toMatch(/.ac-queue-thumb {[^}]*width: 16px;[^}]*height: 16px;/)
    // 行高统一为 36（RULES §9：行高稳定）；高度落在共用的 .ac-pending-row 上
    expect(host).toMatch(/.ac-pending-row {[^}]*min-height: 36px;/)
  })

  it('右侧一列两个按钮（上「回到底部」下「暂停/启动」），且旧的 .ac-to-bottom 已搬走（G9）', () => {
    // 用户口径 2026-10-09：暂停键**骑在队列与输入框分界线上**（不再占用单独一列）；
    // 「回到底部」搬到**消息区内部、底部居中**。
    expect(host).toContain('class="ac-queue-pause"')
    // 暂停键挂**输入框**里（容器的兄弟）——容器 overflow:hidden 会把它裁掉半个（参考 HTML 同款）
    const inputBox = host.slice(host.indexOf('class="ac-input-box"'), host.indexOf('class="ac-editor"'))
    const pill = inputBox.slice(inputBox.indexOf('class="ac-queue-pause"'))
    expect(pill).toContain('toggleQueuePause()')
    expect(pill).toContain('队列暂停')
    expect(host).toMatch(/\.ac-pending-box \{[^}]*overflow: hidden;/)
    // 回到底部在消息区（.ac-scroll-wrap）里，且居中定位
    const wrap = host.slice(host.indexOf('class="ac-scroll-wrap"'), host.indexOf('class="ac-composer"'))
    expect(wrap).toContain('class="ac-to-bottom"')
    expect(wrap).toContain('smoothScrollToBottom()')
    expect(host).toMatch(/.ac-to-bottom {[^}]*left: 50%;[^}]*bottom: 12px;/)
  })

  it('队列列表贴在输入框上方、宽 80%、靠左（设计 §3.6.1 的数值）', () => {
    // 用户口径 2026-10-09：聚合容器**宽 90% 居中**；与输入框零间隔（底部去圆角 + 边框重叠 1px）；
    // **只有外层有圆角，内部行方角**（RULES §1）；overflow:hidden 才能让内行方角被外圆角裁掉。
    expect(host).toMatch(/\.ac-pending-box \{[^}]*width: 90%;/)
    expect(host).toMatch(/\.ac-pending-box \{[^}]*margin: 0 auto -1px;/)
    expect(host).toMatch(/\.ac-pending-box \{[^}]*border-radius: 14px 14px 0 0;/)
    expect(host).toMatch(/\.ac-pending-row \{[^}]*border-radius: 0;/)
  })

  it('「+」菜单两项（目标 / 上传文件），点目标直接加标记、不弹框（G12）', () => {
    const start = host.indexOf('aria-label="更多添加"')
    const menu = host.slice(start, host.indexOf('</ThemedDropdown>', start))
    expect((menu.match(/role="menuitem"/g) ?? []).length).toBe(2)
    expect(menu).toContain('addGoalMark()')
    expect(menu).toContain('pickImages()')
    expect(menu).toContain('目标')
    expect(menu).toContain('上传文件')
    // 点「目标」只是加标记（agent.setGoalMark），不该顺手把编辑框打开
    expect(menu).not.toContain('openGoalEditor')
  })

  it('目标标记：点标签本体才弹编辑框（objective + 两种预算填法，§3.4.3）', () => {
    // 用户口径 2026-10-09：**不再有目标编辑弹框** —— 标签只写「目标」二字，
    // 预算行内可编辑（contenteditable + CSS 下划线），口径开关在右端。
    const start = host.indexOf('class="ac-goal-mark"')
    const mark = host.slice(start, host.indexOf('class="ac-editor"', start))
    expect(mark).toContain('ac-goal-mark-label')
    expect(mark).toContain('clearGoalMark')
    expect(mark).toContain('ac-goal-token-val')
    // 用户口径 2026-10-09 修正：预算**只有一个**（总预算）；草稿态**没有**口径切换按钮，
    // 运行时也不再有「已用/剩余」切换（进度 = 已用 / 总预算）。
    expect(mark).not.toContain('toggleTokenMode')
    expect(host).not.toContain('toggleTokenMode')
    expect(host).not.toContain('goalBudgetMode')
    // 旧的弹框脚本整段删掉，不再存在
    expect(host).not.toContain('saveGoalEditor')
    expect(host).not.toContain('openGoalEditor')
  })

  it('引导按钮的语义写在 title / aria 里：跑着 = 插队，跑完 = 正常发（G4）', () => {
    expect(host).toContain('aria-label="引导（插队发送）"')
    expect(host).toContain('steerQueueItem')
  })
})

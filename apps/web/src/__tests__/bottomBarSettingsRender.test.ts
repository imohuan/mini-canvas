/**
 * 底栏设置页的真实渲染契约（真内核 + 真插件 + SSR）。
 *
 * 用户口径（2026-10-27）：「我没有看到你的 config 配置……在插件里面注册 config 的 table 页面，
 * 你好像没有做吧？因为我没有在这个设置界面中看到你的配置」。
 *
 * 当时是三处叠加的静默失败，光看源码都像「做了」：
 *   ① pluginBar.ts 的插件对象没带 Config → 内核读不到，整组配置与分组都不存在；
 *   ② 分组名写成一级「底栏」→ 会在左树多出一个无主一级分类；
 *   ③ 自绘页用了缺省的 replace 模式 → Config 字段被整组顶掉，面板里只剩那张表。
 * 因此这里不测源码字符串，而是跑真装配、真的把字段组件与那张自绘页渲成 HTML。
 */
import { beforeAll, describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@plume-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@plume-canvas/canvas-data'
import { CommandRegistry } from '@plume-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@plume-canvas/canvas-data'
import {
  CANVAS_CONTEXT_KEY,
  RENDER_CONTEXT_KEY,
  type CanvasRenderContext,
} from '@plume-canvas/canvas-render'
import { themeComponentsPlugin } from '@plume-canvas/plugin-theme-components'
import { pluginBottomBar } from '@plume-canvas/plugin-bottom-bar'
import SettingsSchemaField from '../../../../packages/plugins/plugin-theme-components/src/components/settings/SettingsSchemaField.vue'
import BottomBarAiSettings from '@plume-canvas/plugin-bottom-bar/BottomBarAiSettings.vue'

/** 与宿主同形的真内核（底栏的 inject 依赖都在） */
async function boot(): Promise<Context> {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  ctx.inject('selection', selection)
  ctx.inject('doc', createDocService({
    nodeStore,
    edgeStore,
    graph: new GraphDocument(nodeStore, edgeStore, selection, history),
    history,
  }))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(themeComponentsPlugin)
  ctx.plugin(pluginBottomBar)
  await ctx.start()
  return ctx
}

/** 渲染组件用的最小渲染上下文（设置页只读 slots/settings） */
function renderCtx(ctx: Context): CanvasRenderContext {
  return {
    ctx,
    viewport: { value: { x: 0, y: 0, zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(comp: Component, props: Record<string, unknown>, ctx: Context): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, props) });
  app.provide(RENDER_CONTEXT_KEY, renderCtx(ctx));
  // 取件工具（useUiComponent）先读应用级上下文。设置条目渲染在外壳里，两格都提供，
  // 与真实 <AppProvider><CanvasProvider> 的嵌套一致。
  app.provide(CANVAS_CONTEXT_KEY, { ctx } as never);
  return renderToString(app);
}

let ctx: Context
beforeAll(async () => {
  ctx = await boot()
})

describe('底栏设置页：Config 真的进了设置、界面真的画得出来', () => {
  it('「集成/底栏 AI 工具」分组存在，且带后面的 Config 字段', () => {
    const settings = ctx.get<{ groups(): string[]; has(k: string): boolean; get(k: string): unknown }>('settings')
    expect(settings.groups()).toContain('集成/底栏 AI 工具')
    expect(settings.get('bottomBarAiRetries')).toBe(3)
    // 用户口径 2026-10-27：底栏不再自己配地址，直接用 Agent 插件那份
    expect(settings.has('bottomBarAiBaseUrl')).toBe(false)
  })

  it('整页挂在「集成 → 底栏 AI 工具」，位于智能助手下面、平台上面', () => {
    // 用户 2026-11-20：从布局最下面搬到智能助手与平台之间
    const menu = ctx.get<{
      resolve(groups: readonly string[]): {
        navs: Array<{ id: string; title: string; page?: unknown; position: number }>
      }
    }>('settingsMenu')
    const view = menu.resolve(ctx.get<{ groups(): string[] }>('settings').groups())
    const titles = view.navs.map((n) => n.title)
    const ai = view.navs.find((n) => n.id === 'nav/integration/bottom-bar-ai')
    expect(ai, '底栏 AI 工具 nav 未注册').toBeTruthy()
    expect(ai!.page).toBeTruthy()
    const agentAt = titles.indexOf('智能助手')
    const aiAt = titles.indexOf('底栏 AI 工具')
    expect(aiAt).toBe(agentAt + 1)
  })

  it('schema 字段渲染成真实控件（失败重试轮数，默认 3）', async () => {
    const html = await render(SettingsSchemaField as Component, { group: '集成/底栏 AI 工具', fieldKey: 'bottomBarAiRetries', settings: ctx.get('settings') }, ctx)
    expect(html).toContain('AI 失败重试')
    // number 字段是精度滑块（role=slider），不是 <input>：按真实控件断言
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-valuenow="3"')
  })

  it('AI 工具页渲染出来（按钮清单 / 通用模型 / 内置默认）', async () => {
    const html = await render(BottomBarAiSettings as Component, {}, ctx)
    expect(html).toContain('底栏 AI 按钮')
    expect(html).toContain('通用模型')
    // 不允许把字段列表铺在页面外面：用户 2026-11-20 明确要求整页搬到集成菜单下
    const slots = ctx.slots as unknown as { occupants(slot: string): Array<{ id: string }> }
    expect(slots.occupants('settingsGroup/集成/底栏 AI 工具')).toHaveLength(0)
    // 首屏就摆内置默认（不是空表 + 「配置加载中」—— 那正是用户反馈「看不到配置」的观感）
    expect(html).toContain('翻译')
    expect(html).toContain('提示词优化')
    expect(html).not.toContain('配置加载中')
  })
})

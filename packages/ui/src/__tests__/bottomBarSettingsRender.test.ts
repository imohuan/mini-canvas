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
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { pluginBottomBar } from '@mini-canvas/plugin-bottom-bar'
import SettingsSchemaField from '@mini-canvas/plugin-theme-default/components/settings/SettingsSchemaField.vue'
import PromptActionSettings from '@mini-canvas/plugin-bottom-bar/PromptActionSettings.vue'

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
  ctx.plugin(themeDefaultPlugin)
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
  return renderToString(app);
}

let ctx: Context
beforeAll(async () => {
  ctx = await boot()
})

describe('底栏设置页：Config 真的进了设置、界面真的画得出来', () => {
  it('「常规/底栏」分组存在，且带后面的 Config 字段', () => {
    const settings = ctx.get<{ groups(): string[]; has(k: string): boolean }>('settings')
    expect(settings.groups()).toContain('常规/底栏')
    expect(settings.has('bottomBarAiBaseUrl')).toBe(true)
  })

  it('自绘页是 append 模式（不顶掉同组的 schema 字段）', () => {
    // ⚠️ occupants 在**插件作用域**的 ctx.slots 上；ctx.get('slots') 拿到的是内核 SlotRegistry
    //（只有 list/add/remove，没有 occupants）。设置面板消费的正是前者（AppSettingsPanel 的 ctx.slots）。
    const slots = ctx.slots as unknown as { occupants(slot: string): Array<{ id: string; meta?: { mode?: string } }> }
    const occ = slots.occupants('settingsGroup/常规/底栏')
    expect(occ.map((o) => o.id)).toContain('bottom-bar/prompt-actions')
    expect(occ.find((o) => o.id === 'bottom-bar/prompt-actions')?.meta?.mode).toBe('append')
  })

  it('schema 字段渲染成真实输入框（AI 后台地址看得见、可改）', async () => {
    const html = await render(SettingsSchemaField as Component, { group: '常规/底栏', fieldKey: 'bottomBarAiBaseUrl', settings: ctx.get('settings') }, ctx)
    expect(html).toContain('AI 后台地址')
    expect(html).toContain('<input')
  })

  it('AI 按钮清单那张表渲染出来（标题 / 名称 / 模板 / 变量提示）', async () => {
    const html = await render(PromptActionSettings as Component, {}, ctx)
    expect(html).toContain('底栏 AI 按钮')
    expect(html).toContain('提示词模板')
    expect(html).toContain('{{prompt}}')
    // 首屏就摆内置默认（不是空表 + 「配置加载中」—— 那正是用户反馈「看不到配置」的观感）
    expect(html).toContain('翻译')
    expect(html).toContain('提示词优化')
    expect(html).not.toContain('配置加载中')
  })
})

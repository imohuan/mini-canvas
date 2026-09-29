/**
 * NodeBottomBar / NodeTaskOverlay 的渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 锁用户可见的几件事（都来自用户明确要求）：
 * 1. 底栏只在**单选**时出现；没有可用动作时自身不产出 DOM；
 * 2. 底栏版式对齐参考：顶部「+ 参考」chip + 展开、大输入框、底部行（模型/参数下拉 +
 *    翻译图标 + 0/2000 计数 + 圆形执行按钮）；
 * 3. 覆盖层：running 才出现，有百分比显示百分比、没有走不确定态；整卡加载态、**没有中间小卡片**；
 *    取消按钮在右下角；
* 4. 覆盖层不写死遮罩卡片类名（旧的 task-overlay-card / -mask 已删）——用户实测反馈的回归点。
 * 5. 输入框用的是仓库自带富文本编辑器（prosemirror-editor-bundle），并把上游素材变成
 *    @ 引用候选（文本/图片/视频三类都要在候选里）——用户明确要求「@ 我的节点输入端口资源」。
*/
import { beforeAll, describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { RegistryImpl } from '@mini-canvas/kernel'
import { Context } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import NodeBottomBar from '../NodeBottomBar.vue'
import NodeTaskOverlay from '../NodeTaskOverlay.vue'
import type { BarAction } from '../barTypes'
import { collectUpstreamMaterials, toEditorResources } from '../panelSource'

const DEMO_ACTION: BarAction = {
  id: 'mock-task:sync',
  types: ['image'],
  title: 'Mock 同步任务',
  needsPrompt: true,
  fields: [
    {
      key: 'size',
      label: '尺寸',
      type: 'select',
      default: '320',
      options: [
        { label: '小 320', value: '320' },
        { label: '中 480', value: '480' },
      ],
    },
  ],
  run: () => ({ ok: true }),
}

/** UI 目录来自真实主题插件的注册流程（与生产同形） */
async function themeUiField() {
  const ctx = new Context()
  ctx.plugin(themeDefaultPlugin)
  await ctx.start()
  return ctx.registryOf('ui')
}
let uiField: { top(name: string): { value: unknown } | undefined; subscribe(fn: () => void): { dispose(): void } }
beforeAll(async () => {
  uiField = (await themeUiField()) as typeof uiField
})

interface StubOptions {
  selectedIds?: string[]
  actions?: BarAction[]
  data?: Record<string, unknown>
  nodeType?: string
}

function makeCtx(opts: StubOptions = {}) {
  const ids = new Set(opts.selectedIds ?? [])
  const data = opts.data ?? {}
  const actions = opts.actions ?? [DEMO_ACTION]
  const node = { id: '35', type: opts.nodeType ?? 'image', data }
  const services: Record<string, unknown> = {
    // 显隐判定是「恰好选中一个且是我」，必须有 ids（只看 has 是过去的 bug）
    selection: { ids, has: (id: string) => ids.has(id), onChange: () => () => {} },
    doc: {
      getNode: (id: string) => (id === node.id ? node : undefined),
      updateNode: () => {},
      subscribe: () => () => {},
    },
    nodeBar: { list: () => actions },
    nodeTask: { cancel: () => {}, run: async () => ({ ok: true }) },
  }
  return {
    ctx: {
      get: (name: string) => services[name],
      tryGet: (name: string) => services[name],
      on: () => ({ dispose: () => {} }),
      registryOf: (kind: string) => (kind === 'ui' ? uiField : (new RegistryImpl() as unknown)),
    },
    viewport: { value: { zoom: 1 } },
    renderNodes: { value: [] },
    renderEdges: { value: [] },
  } as unknown as CanvasRenderContext
}

function render(comp: Component, id: string, data: Record<string, unknown>, ctx: CanvasRenderContext): Promise<string> {
  const app = createSSRApp({ render: () => h(comp, { id, data }) })
  app.provide(RENDER_CONTEXT_KEY, ctx)
  return renderToString(app)
}

describe('NodeBottomBar：版式与显隐契约', () => {
  it('单选且有动作 → 渲染；含 chip / 输入框 / 底部行 / 圆形执行按钮 / 计数', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    expect(html).toContain('data-testid="node-bottom-bar"')
    expect(html).toContain('nb-chip')
    expect(html).toContain('参考')
    expect(html).toContain('nb-editor')
    expect(html).toContain('prose-mirror-editor')
    expect(html).toContain('nb-run')
    expect(html).toContain('2000')
  })

  it('未选中 → 不渲染（控制栏只在选中时浮出）', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: [] }))
    expect(html).not.toContain('node-bottom-bar')
  })

  it('多选 → 不渲染（两个及以上全部收起，避免多份面板互相叠）', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35', '36'] }))
    expect(html).not.toContain('node-bottom-bar')
  })

  it('该类型没有任何可用动作 → 自身返回空（不产出底栏 DOM）', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'], actions: [] }))
    expect(html).not.toContain('node-bottom-bar')
  })

  it('needsPrompt=false 的动作不渲染大输入框（即时动作不留空编辑区）', async () => {
    const instant: BarAction = { id: 'image.rotate', types: ['image'], title: '旋转', run: () => ({ ok: true }) }
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'], actions: [instant] }))
    expect(html).toContain('node-bottom-bar')
    expect(html).not.toContain('nb-editor')
  })

  it('默认动作优先选可输入的那条（即时动作 order 更小，也不能因此默认选中它）', async () => {
    const rotate: BarAction = { id: 'image.rotate', types: ['image'], title: '旋转', order: 90, run: () => ({ ok: true }) }
    const gen: BarAction = { id: 'tool:gen', types: ['image'], title: '生成图片', needsPrompt: true, run: () => ({ ok: true }) }
    const html = await render(
      NodeBottomBar as Component,
      '35',
      {},
      makeCtx({ selectedIds: ['35'], actions: [rotate, gen] }),
    )
    // 默认选中生成动作 → 大输入框在（用户连了素材就该能直接打字）
    expect(html).toContain('nb-editor')
    expect(html).toContain('is-active')
  })

  it('动作一排 chip：每个动作一个 chip，选中的那个带 is-active', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    expect(html).toContain('nb-action-chip')
    expect(html).toContain('Mock 同步任务')
  })
})

describe('输入框：用仓库富文本编辑器 + @ 引用上游素材', () => {
  it('输入框渲染的是 prosemirror-editor-bundle 的编辑器（不是原生 input）', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    expect(html).toContain('prose-mirror-editor')
    expect(html).not.toContain('<input')
  })

  it('@ 引用候选：上游是文本/图片/视频时都能产出一条资源项，且都带 @ 插入所需的规格', () => {
    const materials = collectUpstreamMaterials(
      [
        { source: 't1', target: '35' },
        { source: 'i1', target: '35' },
        { source: 'v1', target: '35' },
      ],
      '35',
      (id) => {
        if (id === 't1') return { type: 'text', data: { text: '一段文字' } }
        if (id === 'i1') return { type: 'image', data: { imageUrl: 'data:image/png;base64,AAA' } }
        if (id === 'v1') return { type: 'video', data: { videoUrl: 'blob:video' } }
        return undefined
      },
    )
    // 三类素材都要认出来（图片/文本/视频）
    expect(materials.map((m) => m.kind).sort()).toEqual(['image', 'text', 'video'])
    const items = toEditorResources(materials)
    expect(items).toHaveLength(3)
    // 每一项都要有 id（@token = 上游节点 id）与 name（下拉里显示）
    for (const it of items) {
      expect(it.id).toBeTruthy()
      expect(it.name).toBeTruthy()
    }
    // 文本走 value、图片/视频走 url 与 mediaType（编辑器据此画缩略图/播放）
    const text = items.find((i) => i.id === 't1')
    const img = items.find((i) => i.id === 'i1')
    const vid = items.find((i) => i.id === 'v1')
    expect(text?.value).toBe('一段文字')
    expect(img?.url).toBeTruthy()
    expect(img?.mediaType).toBe('image')
    expect(vid?.mediaType).toBe('video')
  })
})

describe('NodeTaskOverlay：整卡加载态（没有中间小卡片）', () => {
  it('running + 有百分比 → 渲染百分比与文案', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'running', progress: 42, message: '生成中…' } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('task-overlay')
    expect(html).toContain('42%')
    expect(html).toContain('生成中…')
  })

  it('running 但外部只给阶段（无 progress）→ 走不确定态', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'running', message: '排队中' } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('is-indeterminate')
  })

  it('done / error / idle / 缺省 → 一律渲染空', async () => {
    const states = [
      {},
      { runState: { status: 'idle' } },
      { runState: { status: 'done', progress: 100 } },
      { runState: { status: 'error', message: 'x' } },
    ]
    for (const data of states) {
      const html = await render(NodeTaskOverlay as Component, '35', data, makeCtx({ selectedIds: ['35'] }))
      expect(html, JSON.stringify(data)).not.toContain('task-overlay')
    }
  })

  it('没有中间黑底卡片：渲染里不出现旧的卡片/遮罩容器类名', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'running', progress: 10 } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).not.toContain('task-overlay-card')
    expect(html).not.toContain('task-overlay-mask')
  })

  it('取消按钮在（右下角那一个）', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'running', progress: 10 } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('task-overlay-cancel')
    expect(html).toContain('取消')
  })
})

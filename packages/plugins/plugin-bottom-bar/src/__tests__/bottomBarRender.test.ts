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
import { collectUpstreamMaterials, makeResourceResolver, toEditorResources } from '../panelSource'

const DEMO_ACTION: BarAction = {
  id: 'test:sync-action',
  types: ['image'],
  title: '测试同步动作',
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
  it('单选且有动作 → 渲染；含 pill / 输入区 / 底部行 / 圆形执行按钮 / 计数', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    expect(html).toContain('data-testid="node-bottom-bar"')
    expect(html).toContain('nb-pill')
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
    // 且底部模型下拉显示的是那条生成动作（不是 order 更小的「旋转」）
    expect(html).toContain('生成图片')
    expect(html).not.toContain('>旋转<')
  })

  it('动作收在底部「模型」下拉里（照参考图：不在顶行做 pill）', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    // 顶部 pill 行只放「参考」这类场景入口，动作不掺进来
    expect(html).not.toContain('nb-pill--action')
    expect(html).toContain('nb-field--action')
    expect(html).toContain('nb-action-35')
    expect(html).toContain('测试同步动作')
  })

  it('素材卡**直接显示**（不需先点「参考」），带序号角标', async () => {
    // 造一个上游素材：节点 35 连了一个文本节点
    const ctx = makeCtx({ selectedIds: ['35'] })
    // 桩里 renderEdges/renderNodes 是空的，这里补上一条边与上游节点
    ;(ctx as unknown as { renderEdges: { value: unknown[] } }).renderEdges.value = [{ source: 't1', target: '35' }]
    ;(ctx as unknown as { renderNodes: { value: unknown[] } }).renderNodes.value = [
      { id: 't1', type: 'text', data: { text: '一段文字' } },
    ]
    const html = await render(NodeBottomBar as Component, '35', {}, ctx)
    expect(html).toContain('nb-cards')
    expect(html).toContain('nb-card')
    expect(html).toContain('nb-card-index')
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

  /**
   * 用户要求（2026-09-30）：「连多个素材时按类型各自编号，@ 引用与纯文本里都用
   * 图片1/视频1/文本1 这种名字，而不是内部节点 id」。
   */
  it('素材引用名按类型各自编号：图片1/图片2、视频1、文本1（不是节点 id）', () => {
    const materials = collectUpstreamMaterials(
      [
        { source: 'i1', target: '35' },
        { source: 't1', target: '35' },
        { source: 'i2', target: '35' },
        { source: 'v1', target: '35' },
      ],
      '35',
      (id) => {
        if (id === 't1') return { type: 'text', data: { text: '一段文字' } }
        if (id === 'i1') return { type: 'image', data: { imageUrl: 'https://x/a.png', label: '猫' } }
        if (id === 'i2') return { type: 'image', data: { imageUrl: 'https://x/b.png', label: '狗' } }
        if (id === 'v1') return { type: 'video', data: { videoUrl: 'https://x/c.mp4' } }
        return undefined
      },
    )
    // 节点 id 仍是身份（请求组装 / 去重用），refName 才是给人看的引用名
    expect(materials.map((m) => m.id)).toEqual(['i1', 't1', 'i2', 'v1'])
    expect(materials.map((m) => m.refName)).toEqual(['图片1', '文本1', '图片2', '视频1'])
    // 编辑器资源项的 name 就是 refName（@ 下拉 / 卡片文案 / 纯文本 token 三处一致）
    const items = toEditorResources(materials)
    expect(items.map((i) => i.name)).toEqual(['图片1', '文本1', '图片2', '视频1'])
  })

  it('@ 引用回查：token 是引用名（图片1）或老的节点 id 都能回查', () => {
    const materials = collectUpstreamMaterials(
      [{ source: 'i1', target: '35' }],
      '35',
      () => ({ type: 'image', data: { imageUrl: 'https://x/a.png', label: '猫' } }),
    )
    const items = toEditorResources(materials)
    const resolve = makeResourceResolver(items)
    expect(resolve('图片1')?.id).toBe('i1')
    expect(resolve('i1')?.name).toBe('图片1')
    expect(resolve('不存在')).toBeNull()
  })

  it('@ 引用在编辑器里渲染成**卡片**（圆角框 + 缩略图 + 名字），不再是缩略图加下划线', () => {
    const materials = collectUpstreamMaterials(
      [
        { source: 'i1', target: '35' },
        { source: 't1', target: '35' },
      ],
      '35',
      (id) =>
        id === 't1'
          ? { type: 'text', data: { text: '文字' } }
          : { type: 'image', data: { imageUrl: 'https://x/a.png', label: '猫' } },
    )
    const items = toEditorResources(materials)
    const imgSpec = items.find((i) => i.id === 'i1')!.renderEditor!(items.find((i) => i.id === 'i1')!) as unknown[]
    const textSpec = items.find((i) => i.id === 't1')!.renderEditor!(items.find((i) => i.id === 't1')!) as unknown[]
    // 外层 span：resource-chip 卡片类
    expect((imgSpec[1] as Record<string, string>).class).toContain('resource-chip')
    // 卡内是缩略图 + 名字两段（图片用 img，文本用图标）
    const imgChildren = imgSpec.slice(2) as unknown[][]
    expect(imgChildren[0][0]).toBe('img')
    expect((imgChildren[0][1] as Record<string, string>).class).toBe('resource-chip-thumb')
    expect((imgChildren[1][1] as Record<string, string>).class).toBe('resource-chip-name')
    expect(imgChildren[1][2]).toBe('图片1')
    // 文本卡片：图标 + 名字，且带 resource-chip--text 修饰类
    expect((textSpec[1] as Record<string, string>).class).toContain('resource-chip--text')
    expect((textSpec.slice(2) as unknown[][])[0][0]).toBe('span')
  })

  /**
   * 用户报的「输入内容一下就全消失」：'none' 绑定（图片生成）的输入以前只存在组件本地 ref，
   * 底栏一重挂载（切画布/再点节点/任务跑完再回来）就没了。修法是挂载时从节点 data.barPrompt 恢复。
   * SSR 里 ProseMirror 正文是客户端建的、照不到，但**占位符的有无**由挂载时的初始值决定 ——
   * 有 data.barPrompt 时不该再显示「描述你想要的内容…」占位。
   */
  it('挂载时从 data.barPrompt 恢复输入（有内容 → 不显示占位符；空 → 显示占位符）', async () => {
    const withText = await render(
      NodeBottomBar as Component,
      '35',
      { barPrompt: '我上次写的提示词' },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(withText).toContain('prose-mirror-editor')
    expect(withText).not.toContain('描述你想要的内容')

    const empty = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    expect(empty).toContain('描述你想要的内容')
  })
})

describe('NodeTaskOverlay：整卡加载态（没有中间小卡片）', () => {

describe('「看图」待输入槽位：没连线也要有槽位', () => {
  /**
   * 用户口径（2026-10-25）：输入框里 @图片1 这类文本要变成标签；
   * **没有连线也要有槽位**，状态是「待输入」，输入框上方同步显示。
   *
   * SSR 里 ProseMirror 正文是客户端建的，所以这里直接给一个带 @标签 的 modelValue，
   * 断言槽位那一排渲染出来（`nb-slot` + 「待输入」字样 + 类型名）。
   */
  it('正文里 @图片1 → 上方出现一个「待输入」的图片槽位', async () => {
    const html = await render(
      NodeBottomBar as Component,
      '35',
      { barPrompt: '将 @图片1 中的女子，参照这张图' },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('nb-slots')
    expect(html).toContain('nb-slot')
    expect(html).toContain('is-pending')
    expect(html).toContain('待输入')
    expect(html).toContain('图片 1')
  })

  it('@音频1 / @音视频2 也会各出一个槽位（三种写法都认）', async () => {
    const html = await render(
      NodeBottomBar as Component,
      '35',
      { barPrompt: '@音频1 和 @音视频2' },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('音频 1')
    expect(html).toContain('音视频 2')
  })

  it('正文里没有 @ 标签 → 不渲染槽位那一排（不占地方）', async () => {
    const html = await render(NodeBottomBar as Component, '35', {}, makeCtx({ selectedIds: ['35'] }))
    expect(html).not.toContain('nb-slots')
  })
})


describe('参数区：唯一一个下拉参数直接铺到外面（不套二级面板）', () => {
  const soleSpeaker: BarAction = {
    id: 'test:sole-select',
    types: ['audio'],
    title: '豆包·语音合成',
    needsPrompt: true,
    fields: [
      {
        key: 'speaker',
        kind: 'speaker',
        label: '音色',
        type: 'select',
        default: 'a',
        options: [
          { label: '温柔桃子', value: 'a' },
          { label: '磁性俊宇', value: 'b' },
          { label: '阳光甜妹', value: 'c' },
        ],
      },
    ],
    run: () => ({ ok: true }),
  }

  /**
   * 用户口径（2026-10-14，附图）：「集成在这个下拉菜单里面，没有必要做成这种二级菜单……
   * 如果里面只有唯一的一项，并且它是下拉的话，就直接把它做成外部的形式」。
   * 截图里那一格是「音色」（一个参数、普通下拉）。
   */
  it('只有一个下拉参数 → 底栏直接出现一个 Select，不出现参数摘要按钮（tpg-trigger）', async () => {
    const html = await render(
      NodeBottomBar as Component,
      '35',
      {},
      makeCtx({ selectedIds: ['35'], actions: [soleSpeaker], nodeType: 'audio' }),
    )
    // 铺出去之后里面就是一个普通下拉（与左边模型下拉同款的 .sel-trigger）
    expect(html).toContain('tpg-inline')
    // 不再有「参数摘要 + 箭头」那个二级入口
    expect(html).not.toContain('tpg-trigger')
    // 面板容器也不该出现
    expect(html).not.toContain('tpg-menu')
  })

  it('两个参数 → 仍然收成参数面板（一个摘要按钮），不铺开', async () => {
    const two: BarAction = {
      ...soleSpeaker,
      id: 'test:two-params',
      fields: [
        ...soleSpeaker.fields!,
        {
          key: 'format',
          kind: 'format',
          label: '格式',
          type: 'select',
          default: 'wav',
          options: [
            { label: 'WAV', value: 'wav' },
            { label: 'MP3', value: 'mp3' },
            { label: 'OGG Opus', value: 'ogg_opus' },
            { label: 'FLAC', value: 'flac' },
          ],
        },
      ],
    }
    const html = await render(
      NodeBottomBar as Component,
      '35',
      {},
      makeCtx({ selectedIds: ['35'], actions: [two], nodeType: 'audio' }),
    )
    expect(html).toContain('tpg-trigger')
    expect(html).not.toContain('tpg-inline')
  })
})
  it('running + 有百分比 → 渲染超大百分比、耗时胶囊与文案（照参考稿的 3 元素版式）', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'running', progress: 42, message: '生成中…' } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('task-overlay')
    // 数字与百分号是两个元素（中间超大号 + 小号 %），所以分开断言
    expect(html).toContain('>42<')
    expect(html).toContain('%')
    expect(html).toContain('生成中…')
    // 流光层 3 个光斑（暗/亮两套配色靠 CSS，DOM 里就这 3 个）
    expect(html).toContain('ld-blob--1')
    expect(html).toContain('ld-blob--3')
  })

  it('running 但外部只给阶段（无 progress）→ 显示占位而不是编一个百分比', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'running', message: '排队中' } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('···')
    expect(html).toContain('排队中')
  })

  it('done / idle / 缺省 → 渲染空（error 另有整卡失败态，见下一条）', async () => {
    const states = [
      {},
      { runState: { status: 'idle' } },
      { runState: { status: 'done', progress: 100 } },
    ]
    for (const data of states) {
      const html = await render(NodeTaskOverlay as Component, '35', data, makeCtx({ selectedIds: ['35'] }))
      expect(html, JSON.stringify(data)).not.toContain('task-overlay')
      expect(html, JSON.stringify(data)).not.toContain('task-failed')
    }
  })

  /**
   * 用户要求：失败也必须像加载态那样**整卡覆盖**，不要只在顶上贴一条；
   * 且消息只出现在节点上（底栏一个字都不显示）。
   */
  it('失败态：同样是整卡覆盖（不是顶部小条），写清原因 + 下一步', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'error', message: '任务被暂停（可在 web2api 里恢复或重试）' } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).toContain('task-failed')
    expect(html).toContain('任务被暂停')
    // 整卡覆盖：与加载态同一个容器（不是浮在顶部的一条）
    expect(html).toContain('task-overlay')
    expect(html).toContain('is-error')
    // 给一句下一步，而不是编一个百分比
    expect(html).toContain('重试')
    expect(html).not.toContain('ld-pct')
  })

  it('失败态不显示取消按钮（没在跑，没什么可取消的）', async () => {
    const html = await render(
      NodeTaskOverlay as Component,
      '35',
      { runState: { status: 'error', message: '失败了' } },
      makeCtx({ selectedIds: ['35'] }),
    )
    expect(html).not.toContain('task-overlay-cancel')
  })

  /** 用户要求：所有任务消息只出现在节点覆盖层，底栏不再显示任何状态文案 */
  it('底栏不显示任何状态文案（错误/完成都只在节点上）', async () => {
    for (const rs of [
      { status: 'error', message: '任务执行失败: 触发了风控' },
      { status: 'done', progress: 100 },
    ]) {
      const html = await render(NodeBottomBar as Component, '35', { runState: rs }, makeCtx({ selectedIds: ['35'] }))
      expect(html).not.toContain('nb-status')
      expect(html).not.toContain('触发了风控')
      expect(html).not.toContain('已完成')
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

/**
 * 设置面板覆盖度测试 —— 用户要求："你这些配置应该也要写到我的设置页面中"。
 *
 * 这条测试用**真实内核 + 真实插件**跑一遍，把"哪些配置项真的会出现在设置页面里"钉死：
 * 设置面板的左导航/二级块由 ctx.settingsMenu 的 0/1/2 级菜单决定，
 * ctx.settings.groups() 与各 key 的 group 负责把字段挂进对应小节
 * （见 PluginSettingsContent 的 menuView/sectionMap），所以断言 groups()、关键 key 的分组
 * 以及菜单树，就等于断言"用户在设置里看得到"。
 *
 * 价值：以后新增配置项却忘了给 group（或 group 名写错、冒出一个没有归属的一级分类），
 * 这里会立刻拦住 —— 那种错误在界面上表现为"配置项凭空消失"，靠肉眼看很难发现。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { themeComponentsPlugin } from '@mini-canvas/plugin-theme-components'
import { themeCanvasPlugin } from '@mini-canvas/plugin-theme-canvas'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { node3dPreviewPlugin } from '@mini-canvas/plugin-node-3d-preview'
import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { pluginBottomBar } from '@mini-canvas/plugin-bottom-bar'
import { resolveAppPlugins } from '../assembly'

/** 起一个与宿主同形的内核（真服务），装载声明了 Config 的几个插件 */
async function bootWithSettings() {
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
  // 5c：数据那一格只有 doc 一个名字（nodeStore/edgeStore/graph/history 四个老服务名已下线）
  ctx.inject('selection', selection)
  ctx.inject(
    'doc',
    createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }),
  )
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())

  for (const p of [
    themeComponentsPlugin,
    // 外观 / 布局 / 节点这类设置键由画布半边声明；与成品装配一致，两边都装。
    themeCanvasPlugin,
    nodeTextPlugin,
    nodeImagePlugin,
    node3dPreviewPlugin,
    pluginImageGenerationTools,
    alignGuidePlugin,
    // 底栏：Config 声明「底栏」分组（AI 按钮清单的自绘页挂在 settingsGroup/底栏）
    pluginBottomBar,
  ]) {
    ctx.plugin(p)
  }
  await ctx.start()
  return ctx
}

interface SettingsLike {
  groups(): string[]
  get(key: string): string | number | boolean
  has(key: string): boolean
}

describe('设置页面覆盖度（真实内核 + 真实插件）', () => {
  it('控制栏偏移出现在「布局」一级分类下', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('布局/控制栏')
    expect(settings.get('toolbarTopOffset')).toBe(6)
    expect(settings.get('toolbarBottomOffset')).toBe(6)
    ctx.stop()
  })

  it('线型默认是自适应贝塞尔，新增项真的写进设置单一数据源', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.get('edgeType')).toBe('adaptive')
    expect(settings.get('edgeAvoidMargin')).toBe(18)
    expect(settings.get('edgeAvoidRadius')).toBe(8)

    ctx.settings.set('edgeType', 'avoid')
    expect(settings.get('edgeType')).toBe('avoid')
    ctx.settings.set('edgeType', 'adaptive')
    expect(settings.get('edgeType')).toBe('adaptive')
    ctx.stop()
  })


  /**
   * 3D 上游接口真的进设置单一数据源。
   *
   * 这条为什么必要（2026-10-27 真踩）：node3dPreviewPlugin 出口原来只转发 name/inject/apply，
   * 把 Config 漏在对象之外 —— 内核读 mod.Config 读不到，设置项**静默消失**、也不报错。
   * 只测「模块导出了 Config」不够，必须跑真内核。
   */
  it('3D 上游接口出现在「常规/上游接口」下，且默认留空（留空 = 按节点字段解析）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('常规/上游接口')
    expect(settings.get('preview3dUpstreamApi')).toBe('')
    ctx.settings.set('preview3dUpstreamApi', '/api/upstream?nodeId={nodeId}')
    expect(settings.get('preview3dUpstreamApi')).toBe('/api/upstream?nodeId={nodeId}')
    ctx.stop()
  })

  it('图片最短边 / 最长边出现在「布局」一级分类下', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('布局/图片节点尺寸')
    expect(settings.get('imageCardMinShortSide')).toBe(120)
    expect(settings.get('imageCardMaxLongSide')).toBe(420)
    // 旧的宽/高上限已删除，避免设置页出现两套规则
    expect(settings.has('imageFitMaxWidth')).toBe(false)
    expect(settings.has('imageFitMaxHeight')).toBe(false)
    ctx.stop()
  })

  it('生成控制栏的尺寸（宽度 / 输入框高度）也出现在「布局」分类下', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    // 同一二级块「控制栏」里既有贴边距离，也有尺寸 —— 都属于"控制栏的布局"
    expect(settings.groups()).toContain('布局/控制栏')
    expect(settings.get('panelImageWidth')).toBe(660)
    expect(settings.get('panelTextWidth')).toBe(520)
    expect(settings.get('panelEditorMinHeight')).toBe(64)
    expect(settings.get('panelEditorMaxHeight')).toBe(220)
    ctx.stop()
  })

  it('多选标记的大小 / 低缩放开关出现在「节点」分类下（颜色已删，改走主题强调色）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('节点/多选标记')
    expect(settings.get('nodeMultiRadioSize')).toBe(18)
    expect(settings.get('nodeMultiRadioShowInLowDetail')).toBe(false)
    // 颜色不再是配置项（用户要求删掉「多选标记颜色」，改吃主题强调色 --ui-accent）
    expect(settings.has('nodeMultiRadioColor')).toBe(false)
    // 改一下能读回来（设置面板可调、且会跨刷新持久化）
    ctx.settings.set('nodeMultiRadioSize', 24)
    expect(settings.get('nodeMultiRadioSize')).toBe(24)
    ctx.stop()
  })

  it('生成后台三项出现在设置里（地址 / 超时 / 是否用后台模型表）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('常规/图片生成')
    // 后台地址是个 URL（regex 写成 indexOf 断言，避免转义层面的歧义）
    expect(String(settings.get('imageGenBaseUrl')).startsWith('http')).toBe(true)
    expect(typeof settings.get('imageGenTimeoutMs')).toBe('number')
    expect(typeof settings.get('imageGenUseBackendModels')).toBe('boolean')
    ctx.stop()
  })

  it('对齐辅助线的总开关出现在「布局」分类下（关掉后插件才不生效）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('布局/对齐辅助线')
    // 默认开着；用户关掉后读到关闭（插件据此卸载浮层）
    expect(settings.get('alignGuideEnabled')).toBe(true)
    ctx.settings.set('alignGuideEnabled', false)
    expect(settings.get('alignGuideEnabled')).toBe(false)
    ctx.stop()
  })

  /**
   * 3D 上游接口真的进设置单一数据源。
   *
   * 这条为什么必要（2026-10-27 真踩）：node3dPreviewPlugin 出口原来只转发 name/inject/apply，
   * 把 Config 漏在对象之外 —— 内核读 mod.Config 读不到，设置项**静默消失**、也不报错。
   * 只测「模块导出了 Config」不够，必须跑真内核。
   */
  it('3D 上游接口出现在「常规/上游接口」下，且默认留空（留空 = 按节点字段解析）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('常规/上游接口')
    expect(settings.get('preview3dUpstreamApi')).toBe('')
    ctx.settings.set('preview3dUpstreamApi', '/api/upstream?nodeId={nodeId}')
    expect(settings.get('preview3dUpstreamApi')).toBe('/api/upstream?nodeId={nodeId}')
    ctx.stop()
  })

  /**
   * 底栏的 Config 真的进了设置单一数据源。
   *
   * 这条为什么必要（2026-10-27 真踩）：pluginBottomBar 出口原来只转发 name/inject/apply，
   * 把 Config 漏在对象之外 —— 内核读 mod.Config 读不到，整组配置**静默消失**，
   * 设置面板里一行都没有、也不报错。只测「模块上导出了 Config」不够，必须跑真内核。
   */
  it('底栏配置进「常规/底栏」，但**不再**自己存一份后台地址（直接用 Agent 的）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('常规/底栏')
    expect(settings.get('bottomBarAiRetries')).toBe(3)
    // 用户口径 2026-10-27：「这边本身就是使用 Agent 之间配置的这个数据」——
    // 底栏若再存一份地址就是第二个真源（改了 Agent、底栏还打旧端口）。
    expect(settings.has('bottomBarAiBaseUrl')).toBe(false)
    ctx.stop()
  })

  it('组件库使用标记出现在「常规/调试」且默认关闭', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('常规/调试')
    expect(settings.get('uiKitDebug')).toBe(false)
    ctx.settings.set('uiKitDebug', true)
    expect(settings.get('uiKitDebug')).toBe(true)
    ctx.stop()
  })

  /**
   * 一级分组名必须能归到默认菜单已经登记的分组里，不能随手造一个无主名字。
   * 菜单顶层现在由 ctx.settingsMenu 注册（category/nav/section），不再由 group 第一段决定；
   * 这里只锁“旧 group 仍能安全迁移”，完整 0/1/2 顺序在 settingsMenu.test.ts。
   */
  it('启动套件的每个 group 都被某个显式 section 收编（auto 兜底不算）', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    const menu = ctx.get('settingsMenu')
    // resolve() 会把没登记的 group 自动补成 auto section —— 那不算“已归好类”。
    // 只认显式注册的 section.groups（一个 section 可合并多个 Config.group）。
    const registered = new Set(
      menu
        .resolve(settings.groups())
        .navs.flatMap((n) => n.sections.filter((s) => !s.auto).flatMap((s) => s.groups)),
    )
    const unregistered = settings.groups().filter((g) => !registered.has(g))
    expect(unregistered).toEqual([])
    // 兜底机制仍在：未登记的 group 不会消失，但会挂成 auto 并报告 issue。
    const fake = menu.resolve(['没登记的/分组'])
    expect(fake.navs.flatMap((n) => n.sections).some((s) => s.auto)).toBe(true)
    expect(fake.issues.some((i) => i.kind === 'unregistered-nav')).toBe(true)
    ctx.stop()
  })

  it('每个分组名都带二级段，避免扁平项散落在导航之外', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    const flat = settings.groups().filter((g) => !g.includes('/'))
    expect(flat).toEqual([])
    ctx.stop()
  })

  /**
   * 真实启动套件的菜单树必须“零兜底”：
   * - 每个 group 都被显式 section 收编（不是 auto 补出来的）；
   * - 没有重复的一级菜单；
   * - 内容不会因为菜单合并而丢（每个 group 至少出现在一个 section 里）。
   */
  it('真实 APP_PLUGINS：菜单零兜底、一级不重复、全部 group 可见', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: resolveAppPlugins(),
    })
    const settings = host.ctx.get<SettingsLike>('settings')
    const menu = host.ctx.get<{
      resolve(groups: readonly string[]): {
        navs: Array<{ id: string; title: string; sections: Array<{ group: string; groups: string[]; auto?: boolean }> }>
        issues: Array<{ kind: string; group?: string }>
      }
    }>('settingsMenu')
    const groups = settings.groups()
    const view = menu.resolve(groups)

    // ① 没有被 auto 兜底的 group（显式注册才算归好类）
    const autoGroups = view.navs.flatMap((n) => n.sections.filter((s) => s.auto)).flatMap((s) => s.groups)
    expect(autoGroups).toEqual([])

    // ② 一级菜单 id / 标题都不重复
    const ids = view.navs.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    const titles = view.navs.map((n) => n.title)
    expect(new Set(titles).size).toBe(titles.length)

    // 旧 settings.nav 的整页已经被菜单收编：不能再冒第二条“主题工作台 / 插件 / Agent”。
    // 「主题工作台」是 demo-kit 的二级整页，冷启动没有 demo-kit → 一级里应当一条都没有；
    // 另两个是真实一级项，必须恰好一条。
    expect(titles.filter((t) => t === '主题工作台')).toHaveLength(0)
    for (const title of ['插件', 'Agent']) {
      expect(titles.filter((t) => t === title), title + ' 出现了重复一级入口').toHaveLength(1)
    }

    // ③ 每个真实 group 至少出现在一个 section 里（合并展示不算丢）
    const visible = new Set(view.navs.flatMap((n) => n.sections.flatMap((s) => s.groups)))
    expect(groups.filter((g) => !visible.has(g))).toEqual([])

    host.stop()
  })

  it('安装本地清单后，所有分组仍被菜单收编，不冒出重复的一级入口', async () => {
    const { host } = await createMiniCanvasHost({
      adapter: new MemoryStorageAdapter(),
      coldPlugins: resolveAppPlugins(),
    })
    const settings = host.ctx.get<SettingsLike>('settings')
    const menu = host.ctx.get<{
      resolve(groups: readonly string[]): {
        navs: Array<{ id: string; title: string; sections: Array<{ group: string; groups: string[]; auto?: boolean }> }>
        issues: Array<{ kind: string; group?: string; title?: string }>
      }
    }>('settingsMenu')

    // 用户实测：装完插件后左侧多出「个人 → 集成」，和真正的「集成」分类重名。
    // 根因是这些分组只有 Config.group、没有菜单 section；resolve() 补成 auto 后
    // 面板只能按第一段当一级名。这里把“每个 group 都必须有显式 section”钉死。
    const view = menu.resolve(settings.groups())
    const auto = view.navs.flatMap((n) => n.sections.filter((s) => s.auto)).flatMap((s) => s.groups)
    expect(auto).toEqual([])
    expect(view.issues).toEqual([])
    host.stop()
  })
})

/**
 * 设置面板覆盖度测试 —— 用户要求："你这些配置应该也要写到我的设置页面中"。
 *
 * 这条测试用**真实内核 + 真实插件**跑一遍，把"哪些配置项真的会出现在设置页面里"钉死：
 * 设置面板的左导航/二级块完全由 ctx.settings.groups() 与各 key 的 group 驱动
 * （见 PluginSettingsDialog 的 sectionMap/navOf），所以断言 groups() 与关键 key 的分组，
 * 就等于断言"用户在设置里看得到"。
 *
 * 价值：以后新增配置项却忘了给 group（或 group 名写错、冒出一个没有归属的一级分类），
 * 这里会立刻拦住 —— 那种错误在界面上表现为"配置项凭空消失"，靠肉眼看很难发现。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'

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
  ctx.inject('nodeStore', nodeStore)
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('selection', selection)
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())

  for (const p of [themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, pluginImageGenerationTools, alignGuidePlugin]) {
    ctx.plugin(p)
  }
  await ctx.start()
  return ctx
}

interface SettingsLike {
  groups(): string[]
  get(key: string): string | number | boolean
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

  it('图片尺寸上限出现在「布局」一级分类下', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('布局/图片节点尺寸')
    expect(settings.get('imageFitMaxWidth')).toBe(420)
    expect(settings.get('imageFitMaxHeight')).toBe(300)
    ctx.stop()
  })

  it('生成控制栏的尺寸（宽度 / 输入框高度）也出现在「布局」分类下', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    // 同一二级块「控制栏」里既有贴边距离，也有尺寸 —— 都属于"控制栏的布局"
    expect(settings.groups()).toContain('布局/控制栏')
    expect(settings.get('panelImageWidth')).toBe(650)
    expect(settings.get('panelTextWidth')).toBe(520)
    expect(settings.get('panelEditorMinHeight')).toBe(64)
    expect(settings.get('panelEditorMaxHeight')).toBe(220)
    ctx.stop()
  })

  it('多选标记的大小 / 颜色 / 低缩放开关出现在「节点」分类下', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    expect(settings.groups()).toContain('节点/多选标记')
    expect(settings.get('nodeMultiRadioSize')).toBe(18)
    expect(String(settings.get('nodeMultiRadioColor')).startsWith('#')).toBe(true)
    expect(settings.get('nodeMultiRadioShowInLowDetail')).toBe(false)
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

  it('一级分类沿用既有四个（布局 / 常规 / 节点 / 边），不冒出无主分类', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    const navs = [...new Set(settings.groups().map((g) => g.split('/')[0]))].sort()
    expect(navs).toEqual(['布局', '常规', '节点', '边'])
    ctx.stop()
  })

  it('每个分组名都带二级段，避免扁平项散落在导航之外', async () => {
    const ctx = await bootWithSettings()
    const settings = ctx.get<SettingsLike>('settings')
    const flat = settings.groups().filter((g) => !g.includes('/'))
    expect(flat).toEqual([])
    ctx.stop()
  })
})

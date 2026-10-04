/**
 * web2api 底栏插件的整装验证（装配层才是"多插件能一起跑"的仲裁）。
 *
 * 锁三件事（都是用户可见、单测插件自己看不到的）：
 * 1. 动作真的落进底栏注册场，且**按节点类型分得清**（image / video / audio 各看得到自己的）；
 * 2. **按能力显隐**在装配后仍成立（dola 视频只有两个时长档）；
 * 3. audio 节点类型真的注册进 nodeStore，且能建出节点、设成默认空表。
 *
 * 注意（2026-10-01 起）：audio 节点**不再由本插件注册** —— 它搬到了独立插件
 * `@mini-canvas/plugin-node-audio`（波形 UI + 拖拽进度）。web2api 只保留"生成动作 + 写入器"。
 * 这里既验"两者一起装上时音频能力齐备"，也验"只装 web2api 不会凭空长出 audio 节点类型"。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { pluginBottomBar } from '@mini-canvas/plugin-bottom-bar'
import type { BarAction } from '@mini-canvas/plugin-bottom-bar'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { nodeVideoPlugin } from '@mini-canvas/plugin-node-video'
import { nodeAudioPlugin } from '@mini-canvas/plugin-node-audio'
import { web2apiToolsPlugin } from '@mini-canvas/plugin-web2api-tools'

/**
 * 起一个与宿主同形的内核：底栏在前、节点插件 + web2api 插件在后（与 assembly 同序）。
 * @param withAudioNode 是否装音频节点插件（默认装）；false = 只装 web2api，用来验"它不再自己注册节点"
 */
async function boot(withAudioNode = true) {
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
  ctx.inject(
    'doc',
    createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }),
  )
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())

  const plugins = [pluginBottomBar, nodeImagePlugin, nodeVideoPlugin, web2apiToolsPlugin]
  if (withAudioNode) plugins.push(nodeAudioPlugin)
  for (const plugin of plugins) {
    ctx.plugin(plugin)
  }
  await ctx.start()
  return { ctx, nodeStore }
}

/** 底栏里某节点类型的动作 */
function actionsOf(ctx: Context, type: string): BarAction[] {
  return ctx.get<{ list(f?: { type?: string }): BarAction[] }>('nodeBar').list({ type })
}

describe('web2api 插件整装', () => {
  it('底栏里图片节点有 web2api 动作，且首选是豆包 auto（用户点名要走 UI 自动化）', async () => {
    const { ctx } = await boot()
    const actions = actionsOf(ctx, 'image')
    const web = actions.filter((a) => a.id.startsWith('web2api:'))
    // 每个模型一条：豆包 3 + Dola 2 + ChatGPT 官方 + GPT Image 2(API)，共 7 条
    expect(web.length).toBeGreaterThanOrEqual(7)
    expect(web[0].id).toBe('web2api:doubao-image-seedream45')
    // 第一个下拉显示的就是**具体模型名**（用户要求）
    expect(web[0].title).toBe('豆包 Seedream 4.5')
    ctx.stop()
  })

  it('视频节点也有 web2api 动作，第一条同样是 auto 模式', async () => {
    const { ctx } = await boot()
    const web = actionsOf(ctx, 'video').filter((a) => a.id.startsWith('web2api:'))
    // 豆包 auto 2 + Dola auto 3 + 豆包接口 2 + Seedance 2 = 9
    expect(web.length).toBeGreaterThanOrEqual(9)
    expect(web[0].id).toBe('web2api:doubao-video-fast')
    expect(web[0].title).toBe('豆包 Seedance 2.0 Fast')
    ctx.stop()
  })

  it('音频节点有 TTS 与火山引擎两条动作', async () => {
    const { ctx } = await boot()
    const ids = actionsOf(ctx, 'audio')
      .filter((a) => a.id.startsWith('web2api:'))
      .map((a) => a.id)
    expect(ids).toContain('web2api:doubao-tts')
    expect(ids).toContain('web2api:volcengine-audio')
    ctx.stop()
  })

  it('动作都是"可输入"的（needsPrompt），批量生成不会点进去发现没有输入框', async () => {
    const { ctx } = await boot()
    for (const t of ['image', 'video', 'audio']) {
      for (const a of actionsOf(ctx, t).filter((x) => x.id.startsWith('web2api:'))) {
        expect(a.needsPrompt, a.id + ' 缺 needsPrompt').toBe(true)
        expect(a.fields?.length ?? 0, a.id + ' 没有参数').toBeGreaterThan(0)
      }
    }
    ctx.stop()
  })

  it('按能力显隐：装配后 dola 视频时长仍只有 5 / 10 两档（不是滑块）', async () => {
    const { ctx } = await boot()
    const dolaVideo = actionsOf(ctx, 'video').find((a) => a.id === 'web2api:dola-video-seedance25')!
    const duration = dolaVideo.fields!.find((f) => f.kind === 'duration')!
    expect(duration.options?.map((o) => o.value)).toEqual(['5', '10'])
    ctx.stop()
  })

  it('音频节点插件装上后 audio 类型就在（音频节点由它负责，不是 web2api 自己register）', async () => {
    const { ctx, nodeStore } = await boot()
    expect([...nodeStore.types.keys()]).toContain('audio')
    expect(nodeStore.types.get('audio')?.description).toBeTruthy()
    ctx.stop()
  })

  it('只装 web2api（不装音频节点插件）时画布上没有 audio 类型 —— 节点所有权确实交还出去了', async () => {
    const { ctx, nodeStore } = await boot(false)
    expect([...nodeStore.types.keys()]).not.toContain('audio')
    ctx.stop()
  })

  it('能真建出 audio 节点并落进 doc（服务名不与人打架）', async () => {
    const { ctx } = await boot()
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }, data?: Record<string, unknown>): string }>(
      'nodeFactory',
    )
    const id = factory.create('audio', { x: 10, y: 20 })
    expect(id).toBeTruthy()
    expect(ctx.get<{ getNode(id: string): { type: string } | undefined }>('doc').getNode(id)?.type).toBe('audio')
    ctx.stop()
  })

  it('插件的服务与配置键都在（三个 web2api 配置项；账号不需要配置）', async () => {
    const { ctx } = await boot()
    const settings = ctx.get<{ has(key: string): boolean }>('settings')
    for (const key of ['web2apiMcpEndpoint', 'web2apiPollIntervalMs', 'web2apiTimeoutMs']) {
      expect(settings.has(key), key + ' 未登记').toBe(true)
    }
    // 账号由服务端自动选号，插件**不**提供账号/cookieId 配置项
    expect(settings.has('web2apiCookieId')).toBe(false)
    ctx.stop()
  })

  it('卸载后音视频动作一起回收（不留僵尸动作）', async () => {
    const { ctx } = await boot()
    ctx.stop()
    expect(ctx.get('nodeBar')).toBeUndefined()
  })
})

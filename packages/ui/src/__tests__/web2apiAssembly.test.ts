/**
 * web2api 底栏插件的整装验证（装配层才是"多插件能一起跑"的仲裁）。
 *
 * 锁三件事（都是用户可见、单测插件自己看不到的）：
 * 1. 动作真的落进底栏注册场，且**按节点类型分得清**（image / video / audio 各看得到自己的）；
 * 2. **按能力显隐**在装配后仍成立（dola 视频只有两个时长档）；
 * 3. audio 节点类型真的注册进 nodeStore（本插件补的画布缺口），且能建出节点、设成默认空表。
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
import { web2apiToolsPlugin } from '@mini-canvas/plugin-web2api-tools'

/** 起一个与宿主同形的内核：底栏在前、节点插件 + web2api 插件在后（与 assembly 同序） */
async function boot() {
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

  for (const plugin of [pluginBottomBar, nodeImagePlugin, nodeVideoPlugin, web2apiToolsPlugin]) {
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
    expect(web.length).toBeGreaterThanOrEqual(3)
    expect(web[0].id).toBe('web2api:doubao-image-auto')
    expect(web[0].title).toContain('auto')
    ctx.stop()
  })

  it('视频节点也有 web2api 动作，第一条同样是 auto 模式', async () => {
    const { ctx } = await boot()
    const web = actionsOf(ctx, 'video').filter((a) => a.id.startsWith('web2api:'))
    expect(web.length).toBeGreaterThanOrEqual(4) // 豆包/dola auto + 豆包接口 + seedance
    expect(web[0].id).toBe('web2api:doubao-video-auto')
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
    const dolaVideo = actionsOf(ctx, 'video').find((a) => a.id === 'web2api:dola-video-auto')!
    const duration = dolaVideo.fields!.find((f) => f.kind === 'duration')!
    expect(duration.options?.map((o) => o.value)).toEqual(['5', '10'])
    ctx.stop()
  })

  it('audio 节点类型真的注册进了 nodeStore（画布此前没有音频节点）', async () => {
    const { ctx, nodeStore } = await boot()
    expect([...nodeStore.types.keys()]).toContain('audio')
    expect(nodeStore.types.get('audio')?.description).toBeTruthy()
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

  it('插件的服务与配置键都在（AudioService + 四个 web2api 配置项）', async () => {
    const { ctx } = await boot()
    expect(ctx.get('audio')).toBeTruthy()
    const settings = ctx.get<{ has(key: string): boolean }>('settings')
    for (const key of ['web2apiMcpEndpoint', 'web2apiCookieId', 'web2apiPollIntervalMs', 'web2apiTimeoutMs']) {
      expect(settings.has(key), key + ' 未登记').toBe(true)
    }
    ctx.stop()
  })

  it('卸载后音视频动作一起回收（不留僵尸动作）', async () => {
    const { ctx } = await boot()
    ctx.stop()
    expect(ctx.get('nodeBar')).toBeUndefined()
  })
})


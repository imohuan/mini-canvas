/**
 * 音频节点插件整装验证 —— 用**真内核**跑一遍装配，锁住插件对外承诺的那几样东西。
 *
 * 为什么不只看类型注册：这条测试要能拦住"插件能装但画布上用不了"的那类错误 ——
 * 缺 in 段（卡片渲染成"未注册"）、服务没上架（别的插件拿不到）、命令没登记
 * （快捷键/右键菜单/MCP 调不到）、卸载后残留（热卸留僵尸）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { nodeAudioPlugin, AudioService, AUDIO_NODE_TYPE } from '../nodeAudioPlugin'

/** 起一个与宿主同形的内核（真服务，不 mock）并装载音频节点插件 */
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
  const nodeRegistry = new NodeRegistry()

  ctx.inject('selection', selection)
  ctx.inject(
    'doc',
    createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }),
  )
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', nodeRegistry)
  ctx.inject('themeRegistry', new ThemeRegistry())

  // 资源库（内存版）：上传命令要把字节存进来、并拿回可用地址 —— 与真实宿主同一条路
  const resourceBlobs = new Map<string, Blob>()
  let resSeq = 0
  ctx.inject('resources', {
    async put(blob: Blob) {
      resSeq += 1
      const ref = 'res-' + resSeq
      resourceBlobs.set(ref, blob)
      return ref
    },
    async resolve(ref: string) {
      return resourceBlobs.has(ref) ? 'blob:resolved-' + ref : undefined
    },
  })

  ctx.plugin(nodeAudioPlugin)
  await ctx.start()
  return { ctx, nodeStore, nodeRegistry }
}

describe('音频节点插件整装', () => {
  it('注册了 audio 节点类型，且带 label / description（右键新建菜单要用）', async () => {
    const { ctx, nodeStore } = await boot()
    const def = nodeStore.types.get(AUDIO_NODE_TYPE)
    expect(def).toBeTruthy()
    expect(def?.description).toBeTruthy()
    expect(def?.label).toBe('音频')
    ctx.stop()
  })

  it('注册了 in 段（缺了卡片会渲染成"未注册"）', async () => {
    const { ctx, nodeRegistry } = await boot()
    expect(nodeRegistry.get(AUDIO_NODE_TYPE)?.segments.in).toBeTruthy()
    ctx.stop()
  })

  it('不支持拖拽改尺寸（resizable:false，用户指定：波形拉伸会变形）', async () => {
    const { ctx, nodeStore } = await boot()
    expect(nodeStore.types.get(AUDIO_NODE_TYPE)?.resizable).toBe(false)
    ctx.stop()
  })

  it('上架了 audio 服务，能真建出节点并落进 doc', async () => {
    const { ctx } = await boot()
    const service = ctx.get<AudioService>('audio')
    expect(service).toBeTruthy()
    const id = service.addAudioNode({ x: 10, y: 20 })
    expect(ctx.get<{ getNode(id: string): { type: string } | undefined }>('doc').getNode(id)?.type).toBe('audio')
    ctx.stop()
  })

  it('addAudioNode 给了地址就写进 data，不给就是空节点', async () => {
    const { ctx } = await boot()
    const service = ctx.get<AudioService>('audio')
    const withUrl = service.addAudioNode({ x: 0, y: 0 }, 'https://x/a.mp3')
    const empty = service.addAudioNode({ x: 0, y: 0 })
    const doc = ctx.get<{ getNode(id: string): { data: Record<string, unknown> } | undefined }>('doc')
    expect(doc.getNode(withUrl)?.data.audioUrl).toBe('https://x/a.mp3')
    expect(doc.getNode(empty)?.data.audioUrl).toBeUndefined()
    ctx.stop()
  })

  it('经 nodeFactory 也能建（统一建节点命令走这条）', async () => {
    const { ctx } = await boot()
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }, d?: Record<string, unknown>): string }>('nodeFactory')
    const id = factory.create(AUDIO_NODE_TYPE, { x: 1, y: 2 })
    expect(ctx.get<{ getNode(id: string): { type: string } | undefined }>('doc').getNode(id)?.type).toBe('audio')
    ctx.stop()
  })

  it('三条命令都登记了（上传 / 下载 / 重新分析波形）', async () => {
    const { ctx } = await boot()
    const ids = ctx.get<{ list(): Array<{ id: string }> }>('command').list().map((c) => c.id)
    expect(ids).toContain('audio.upload')
    expect(ids).toContain('audio.download')
    expect(ids).toContain('audio.reanalyze')
    ctx.stop()
  })

  it('audio.upload 命令与按钮同一条路：给 file 时字节进资源库、节点写 resolve 出来的地址', async () => {
    const { ctx } = await boot()
    const service = ctx.get<AudioService>('audio')
    const id = service.addAudioNode({ x: 0, y: 0 })
    const command = ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command')
    const file = new File(['x'], 'voice.mp3', { type: 'audio/mpeg' })
    // 命令路径直接给 file（不开系统选文件框）；transform 不注入 = 用真实实现，非浏览器环境分析安全返回 null
    expect(await command.execute('audio.upload', { nodeId: id, file })).toBe(true)
    const data = ctx.get<{ getNode(id: string): { data: Record<string, unknown> } | undefined }>('doc').getNode(id)!.data
    expect(data.audioUrl).toBe('blob:resolved-res-1')
    expect(data.resourceId).toBe('res-1')
    expect(data.audioName).toBe('voice.mp3')
    ctx.stop()
  })

  it('两条配置项都登记进 settings（波形高度 / 竖条粗细）', async () => {
    const { ctx } = await boot()
    const settings = ctx.get<{ has(key: string): boolean }>('settings')
    expect(settings.has('audioWaveHeight')).toBe(true)
    expect(settings.has('audioBarMinWidth')).toBe(true)
    ctx.stop()
  })

  it('卸载后类型 / 段 / 服务一起回收（不留僵尸）', async () => {
    const { ctx, nodeStore, nodeRegistry } = await boot()
    ctx.stop()
    expect(nodeStore.types.has(AUDIO_NODE_TYPE)).toBe(false)
    expect(nodeRegistry.has(AUDIO_NODE_TYPE)).toBe(false)
    expect(ctx.get('audio')).toBeUndefined()
  })
})

/**
 * node-video 装配 smoke：装插件不抛、video 服务与节点类型注册、三段展示注册、命令齐全、可建可卸。
 *
 * 段注册断言的是"用户看得见的行为"：装了插件之后，视频节点除了内容，还应带顶部操作条与底部剪辑栏
 * —— 壳（BaseNode）只渲染已注册的段，所以"段在不在"直接决定按钮会不会出现。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry, resolveSegment } from '@mini-canvas/canvas-data'
import { nodeVideoPlugin, VIDEO_NODE_TYPE } from '../nodeVideoPlugin'
import { isClipping, isCropping } from '../videoSession'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
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
  // 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('settings', { get: () => undefined })
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
  ctx.plugin(nodeVideoPlugin)
  return { ctx, nodeStore }
}

describe('node-video 装配 smoke', () => {
  it('插件可装配启动；video 服务上架、节点类型注册、可经 factory 建节点', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    expect(ctx.get('video')).toBeTruthy()
    expect(nodeStore.types.has(VIDEO_NODE_TYPE)).toBe(true)
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create(VIDEO_NODE_TYPE, { x: 5, y: 6 })
    expect(id).toBeTruthy()
    const node = nodeStore.getNode(id)!
    expect(node.type).toBe('video')
    expect(node.position).toEqual({ x: 5, y: 6 })
    ctx.stop()
  })

  it('展示段注册：in + out:top（底栏搬进 plugin-bottom-bar，本包不再自占 out:bottom）', async () => {
    const { ctx } = boot()
    await ctx.start()
    const registry = ctx.get<NodeRegistry>('nodeRegistry')
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'in')).toBeTruthy()
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'out:top')).toBeTruthy()
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'out:bottom')).toBeUndefined()
    // 壳没注册的区域不该凭空多出来
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'title')).toBeUndefined()
    ctx.stop()
  })

  it('十一条视频命令都注册（按钮与命令共用同一批实现）', async () => {
    const { ctx } = boot()
    await ctx.start()
    const ids = ctx.get<{ list(): Array<{ id: string }> }>('command').list().map((c) => c.id)
    for (const id of [
      'video.upload',
      'video.crop',
      'video.cropConfirm',
      'video.cropCancel',
      'video.resetCrop',
      'video.clip',
      'video.clipConfirm',
      'video.clipCancel',
      'video.resetClip',
      'video.captureFrame',
      'video.download',
    ]) {
      expect(ids).toContain(id)
    }
    ctx.stop()
  })

  it('缺 nodeId / rect 的节点级命令安全 no-op（不崩、不误写）', async () => {
    const { ctx } = boot()
    await ctx.start()
    const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    expect(await command.execute('video.upload', {})).toBe(false)
    expect(command.execute('video.crop', {})).toBe(false)
    expect(command.execute('video.cropConfirm', {})).toBe(false)
    expect(command.execute('video.cropConfirm', { nodeId: 'x' })).toBe(false)
    expect(command.execute('video.clip', {})).toBe(false)
    expect(command.execute('video.clipConfirm', { nodeId: 'x', start: 0 })).toBe(false)
    // 截图命令是 async（要解码视频取帧）→ 返回 Promise，故 await 后判值
    expect(await command.execute('video.captureFrame', {})).toBe(false)
    expect(command.execute('video.download', {})).toBe(false)
    expect(command.execute('video.resetCrop', {})).toBe(false)
    ctx.stop()
  })

  it('video.upload 命令与按钮同一条路：给 file 时字节进资源库、节点写 resolve 出来的地址', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create(VIDEO_NODE_TYPE, { x: 0, y: 0 })
    const command = ctx.get<{ execute(id: string, payload?: unknown): unknown }>('command')
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    // 命令路径直接给 file（不开系统选文件框）；transform 不注入 = 用真实实现，非浏览器环境读元数据安全返回 null
    expect(await command.execute('video.upload', { nodeId: id, file })).toBe(true)
    const data = nodeStore.getNode(id)!.data
    expect(data.videoUrl).toBe('blob:resolved-res-1')
    expect(data.resourceId).toBe('res-1')
    expect(data.videoName).toBe('clip.mp4')
    ctx.stop()
  })

  it('裁剪/剪辑会话命令开关一致：open 置位、cancel 复位', async () => {
    const { ctx } = boot()
    await ctx.start()
    const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    expect(command.execute('video.crop', { nodeId: 'n1' })).toBe(true)
    expect(isCropping('n1')).toBe(true)
    expect(command.execute('video.cropCancel', { nodeId: 'n1' })).toBe(true)
    expect(isCropping('n1')).toBe(false)

    expect(command.execute('video.clip', { nodeId: 'n1' })).toBe(true)
    expect(isClipping('n1')).toBe(true)
    // 进入剪辑会自动退掉裁剪（一个节点同时只有一种覆盖层）
    expect(isCropping('n1')).toBe(false)
    expect(command.execute('video.clipCancel', { nodeId: 'n1' })).toBe(true)
    expect(isClipping('n1')).toBe(false)
    ctx.stop()
  })

  it('本包 Config 声明进 settings 单一数据源：预览上限（560×360）+ 最短剪辑时长', async () => {
    const { ctx } = boot()
    await ctx.start()
    const settings = ctx.get<{
      has(key: string): boolean
      get(key: string): unknown
      groupOf(group: string): Array<{ key: string }>
      set(key: string, value: number): boolean
    }>('settings')
    // 键名带本包前缀（内核 settings 全局同一张表、先声明者独占，通用名会跟别的插件打架）
    expect(settings.has('videoFitMaxWidth')).toBe(true)
    expect(settings.has('videoFitMaxHeight')).toBe(true)
    expect(settings.has('videoMinClipDuration')).toBe(true)
    expect(settings.get('videoFitMaxWidth')).toBe(560)
    expect(settings.get('videoFitMaxHeight')).toBe(360)
    // 分组落在既有一级分类下（布局 / 节点），不新立无主分类
    expect(settings.groupOf('布局/视频节点尺寸').map((i) => i.key).sort()).toEqual([
      'videoDefaultHeight',
      'videoDefaultWidth',
      'videoFitMaxHeight',
      'videoFitMaxWidth',
    ])
    expect(settings.groupOf('节点/视频剪辑').map((i) => i.key)).toEqual(['videoMinClipDuration'])
    ctx.stop()
  })

  it('卸载后类型与区域一起回收（无残留）', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    expect(nodeStore.types.has(VIDEO_NODE_TYPE)).toBe(true)
    const registry = ctx.get<NodeRegistry>('nodeRegistry')
    ctx.uninstallPlugin('video')
    expect(nodeStore.types.has(VIDEO_NODE_TYPE)).toBe(false)
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'in')).toBeUndefined()
    expect(ctx.get('video')).toBeFalsy()
    ctx.stop()
  })

  it('连接约束：输出口产 video，输入口收文本、音频、图片、视频（供生成参考素材）', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const def = nodeStore.types.get(VIDEO_NODE_TYPE)!
    expect(def.outputs?.[0]?.contentType).toBe('video')
    expect(def.inputs?.[0]?.acceptsTypes).toEqual(
      expect.arrayContaining(['text', 'audio', 'image', 'video']),
    )
    ctx.stop()
  })

  it('类型级能力：保留卡片边框（不再 frameless）+ 不支持 resize（与 v1 一致）', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const def = nodeStore.types.get(VIDEO_NODE_TYPE)!
    // 2026-10-12 用户口径：空视频 / 白底画面与画布背景糊在一起，必须靠外壳的 1px 边框看出节点边界。
    // 以前这里声明 frameless: true（画面铺满、去掉那圈缝），现在不声明 = 走 BaseNode 的默认边框。
    // 别改回 true：改了视频节点就又变成"看不见边界的一块白"。
    expect(def.frameless).toBeFalsy()
    // 视频卡片尺寸由画面比例决定（进视频/裁剪/恢复各改一次），不提供手动拖柄：
    // 与 v1 VideoNodePlugin 的 `resizable: false` 对齐，别改回去。
    expect(def.resizable).toBe(false)
    ctx.stop()
  })
})

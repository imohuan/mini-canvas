/**
 * node-video 装配 smoke：装插件不抛、video 服务与节点类型注册、三段展示注册、命令齐全、可建可卸。
 *
 * 段注册断言的是"用户看得见的行为"：装了插件之后，视频节点除了内容，还应带顶部操作条与底部剪辑栏
 * —— 壳（BaseNode）只渲染已注册的段，所以"段在不在"直接决定按钮会不会出现。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry, resolveSegment } from '@mini-canvas/canvas-data'
import { nodeVideoPlugin, VIDEO_NODE_TYPE } from '../nodeVideoPlugin'
import { isClipping, isCropping } from '../videoSession'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
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
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('settings', { get: () => undefined })
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

  it('三段展示都注册：content + top-toolbar + bottom-toolbar', async () => {
    const { ctx } = boot()
    await ctx.start()
    const registry = ctx.get<NodeRegistry>('nodeRegistry')
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'content')).toBeTruthy()
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'top-toolbar')).toBeTruthy()
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'bottom-toolbar')).toBeTruthy()
    // 壳没注册的段不该凭空多出来
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'title')).toBeUndefined()
    ctx.stop()
  })

  it('九条视频命令都注册（按钮与命令共用同一批实现）', async () => {
    const { ctx } = boot()
    await ctx.start()
    const ids = ctx.get<{ list(): Array<{ id: string }> }>('command').list().map((c) => c.id)
    for (const id of [
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
      'videoFitMaxHeight',
      'videoFitMaxWidth',
    ])
    expect(settings.groupOf('节点/视频剪辑').map((i) => i.key)).toEqual(['videoMinClipDuration'])
    ctx.stop()
  })

  it('卸载后类型与段一起回收（无残留）', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    expect(nodeStore.types.has(VIDEO_NODE_TYPE)).toBe(true)
    const registry = ctx.get<NodeRegistry>('nodeRegistry')
    ctx.uninstallPlugin('video')
    expect(nodeStore.types.has(VIDEO_NODE_TYPE)).toBe(false)
    expect(resolveSegment(registry, VIDEO_NODE_TYPE, 'content')).toBeUndefined()
    expect(ctx.get('video')).toBeFalsy()
    ctx.stop()
  })

  it('连接约束：输出口产 video（供图片/视频节点识别来源）', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const def = nodeStore.types.get(VIDEO_NODE_TYPE)!
    expect(def.outputs?.[0]?.contentType).toBe('video')
    expect(def.inputs?.[0]?.acceptsTypes).toContain('video')
    expect(def.inputs?.[0]?.acceptsTypes).toContain('image')
    ctx.stop()
  })

  it('类型级能力：frameless（画面铺满）+ 不支持 resize（与 v1 一致）', async () => {
    const { ctx, nodeStore } = boot()
    await ctx.start()
    const def = nodeStore.types.get(VIDEO_NODE_TYPE)!
    expect(def.frameless).toBe(true)
    // 视频卡片尺寸由画面比例决定（进视频/裁剪/恢复各改一次），不提供手动拖柄：
    // 与 v1 VideoNodePlugin 的 `resizable: false` 对齐，别改回去。
    expect(def.resizable).toBe(false)
    ctx.stop()
  })
})

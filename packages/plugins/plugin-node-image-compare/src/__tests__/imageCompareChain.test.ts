/**
 * image-compare 全链集成：经真实画布宿主(createMiniCanvasHost)装配本插件 + 上游 image 插件。
 *
 * 这里要证明的是**真实装配路径**下的两条关键行为（单测 stub 证明不了）：
 * 1. 第 3 张图能真的连进来（说明声明的容量缓冲位确实让内核放行，而不是被 limit-reached 拒掉）；
 * 2. 连进来之后本插件把它收敛回 2 条，并且保留的是"最新两张"（FIFO）。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { validateConnection, type PortDef } from '@mini-canvas/canvas-data'
import type { PluginModule } from '@mini-canvas/kernel'
import { nodeImageComparePlugin, IMAGE_COMPARE_NODE_TYPE } from '../nodeImageComparePlugin'

/**
 * 最小"上游图片"插件：只声明一个产出 image 的 image 类型。
 * 刻意不 import 真正的 plugin-node-image —— 本包要保持不依赖任何兄弟节点插件；
 * 这里需要的只是"上游产 image"这一条声明，与真插件的输出声明等价。
 */
const upstreamImagePlugin: PluginModule = {
  name: 'test-upstream-image',
  inject: [],
  apply(ctx) {
    ctx.nodes.register({
      type: 'image',
      label: '图片',
      size: { w: 320, h: 240 },
      outputs: [{ port: 'source', contentType: 'image' }],
      create: () => '',
    })
  },
}

async function boot() {
  const { host } = await createMiniCanvasHost({
    adapter: new MemoryStorageAdapter(),
    coldPlugins: [upstreamImagePlugin, nodeImageComparePlugin],
  })
  return host
}

type Host = Awaited<ReturnType<typeof boot>>

function addImage(host: Host, url: string): string {
  const id = host.nodeStore.addNode('image', { x: 0, y: 0 })
  host.nodeStore.updateNodeData(id, { imageUrl: url })
  return id
}

describe('image-compare 全链（真实宿主装配）', () => {
  it('两个插件一起装配：image-compare 类型与 imageCompare 服务都在', async () => {
    const host = await boot()
    expect(host.nodeStore.types.has(IMAGE_COMPARE_NODE_TYPE)).toBe(true)
    expect(host.ctx.get('imageCompare')).toBeTruthy()
    host.stop()
  })

  it('第 3 张图能连进来，并被自动挤成最新两张（FIFO 全链）', async () => {
    const host = await boot()
    const svc = host.ctx.get<{ addCompareNode(p: { x: number; y: number }): string }>('imageCompare')
    const cmp = svc.addCompareNode({ x: 300, y: 0 })
    const a = addImage(host, 'a.png')
    const b = addImage(host, 'b.png')
    const c = addImage(host, 'c.png')

    // 用真实 host 的类型声明走一遍内核校验（等价于用户拖线时 isValidConnection 的判定）
    const nodes = new Map(host.nodeStore.getNodes().map((n) => [n.id, { id: n.id, type: n.type }]))
    const getTypeConn = (t: string) => {
      const d = host.nodeStore.types.get(t)
      return d && (d.inputs || d.outputs) ? { inputs: d.inputs as PortDef[], outputs: d.outputs as PortDef[] } : undefined
    }
    const ctxOf = (edges: Array<{ source: string; target: string; targetHandle?: string }>) => ({ nodes, edges, getTypeConn })
    for (const src of [a, b, c]) {
      // 第 3 条在「已有 2 条」的状态下也放行：capacity:2 满额时内核默认「挤老边」（evictOnFull 缺省 true）
      const existing = host.edgeStore
        .getEdges()
        .filter((e) => e.target === cmp)
        .map((e) => ({ source: e.source, target: cmp, targetHandle: 'target' }))
      const res = validateConnection({ source: src, target: cmp, targetHandle: 'target' }, ctxOf(existing))
      expect(res.ok).toBe(true)
    }

    // 建边统一走 graph（图唯一写入口）：会触发历史 + 提交落盘调度
    host.graph.addEdge({ source: a, target: cmp, targetHandle: 'target' })
    host.graph.addEdge({ source: b, target: cmp, targetHandle: 'target' })
    expect(host.edgeStore.getEdges()).toHaveLength(2)

    // 第 3 条：graph 的加边守门人发现满额 → 先挤掉最老的 a 再落 c（同一事务，一次撤销全退）
    host.graph.addEdge({ source: c, target: cmp, targetHandle: 'target' })
    const kept = host.edgeStore.getEdges().filter((e) => e.target === cmp).map((e) => e.source)
    expect(kept).toEqual([b, c])
    host.stop()
  })

  it('刷新恢复：对比节点与它保留的两条边一起从存储回来', async () => {
    const adapter = new MemoryStorageAdapter()
    const first = await createMiniCanvasHost({
      adapter,
      coldPlugins: [upstreamImagePlugin, nodeImageComparePlugin],
    })
    const svc = first.host.ctx.get<{ addCompareNode(p: { x: number; y: number }): string }>('imageCompare')
    const cmp = svc.addCompareNode({ x: 100, y: 100 })
    const a = addImage(first.host, 'a.png')
    const b = addImage(first.host, 'b.png')
    first.host.graph.addEdge({ source: a, target: cmp, targetHandle: 'target' })
    first.host.graph.addEdge({ source: b, target: cmp, targetHandle: 'target' })
    await first.host.save.flush()
    first.host.stop()

    const second = await createMiniCanvasHost({
      adapter,
      coldPlugins: [upstreamImagePlugin, nodeImageComparePlugin],
    })
    expect(second.host.nodeStore.getNode(cmp)?.type).toBe(IMAGE_COMPARE_NODE_TYPE)
    const restored = second.host.edgeStore.getEdges().filter((e) => e.target === cmp).map((e) => e.source)
    expect(restored).toEqual([a, b])
    second.host.stop()
  })
})

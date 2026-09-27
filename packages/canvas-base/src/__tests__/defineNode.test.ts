/**
 * defineNode 的字段透传契约（设计计划 T02）。
 *
 * 由来：DefineNodeDef 继承 NodeRegisterDef，所以类型上 icon/resizable/frameless/
 * transparent/segments 等都合法；但 defineNode 过去只手抄了 type/label/size/
 * description/in/title/inputs/outputs/create —— 作者写了能通过类型检查，运行时却被
 * 静默丢掉。这条边界只能靠"字段走到 nodeStore 里"的端到端断言钉住。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore } from '@mini-canvas/canvas-data'
import { NodeRegistry } from '@mini-canvas/canvas-data'
import { createDocService } from '@mini-canvas/canvas-data'
import { NodeFactory } from '@mini-canvas/canvas-data'
import { defineNode } from '../define'

const InContent = { name: 'InContent' }
const TitleContent = { name: 'TitleContent' }
const TopToolbar = { name: 'TopToolbar' }

async function boot(modules: ReturnType<typeof defineNode>[]) {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const nodeRegistry = new NodeRegistry()
  const factory = new NodeFactory()
  ctx.inject('doc', createDocService({ nodeStore }))
  ctx.inject('nodeRegistry', nodeRegistry)
  ctx.inject('nodeFactory', factory)
  for (const m of modules) ctx.plugin(m)
  await ctx.start()
  return { ctx, nodeStore, nodeRegistry, factory }
}

describe('defineNode 字段透传（类型允许 = 运行时到达）', () => {
  it('类型级能力逐字段进入 nodeStore（resizable/frameless/transparent/icon/description/连接声明）', async () => {
    const { nodeStore } = await boot([
      defineNode({
        type: 'demo-image',
        label: '演示图',
        description: '一句话说明',
        size: { w: 320, h: 240 },
        icon: '<svg/>',
        resizable: true,
        frameless: true,
        transparent: true,
        inputs: [{ port: 'target', accepts: ['image'] }],
        outputs: [{ port: 'source' }],
        in: InContent,
      }),
    ])

    const def = nodeStore.types.get('demo-image')
    expect(def).toBeDefined()
    expect(def?.label).toBe('演示图')
    expect(def?.description).toBe('一句话说明')
    expect(def?.defaultSize).toEqual({ w: 320, h: 240 })
    expect(def?.icon).toBe('<svg/>')
    expect(def?.resizable).toBe(true)
    expect(def?.frameless).toBe(true)
    expect(def?.transparent).toBe(true)
    expect(def?.inputs?.map((p) => p.port)).toEqual(['target'])
    expect(def?.outputs?.map((p) => p.port)).toEqual(['source'])
  })

  it('区域组件（in/title/segments）进入 nodeRegistry', async () => {
    const { nodeRegistry } = await boot([
      defineNode({
        type: 'demo',
        label: '演示',
        size: { w: 10, h: 10 },
        in: InContent,
        title: TitleContent,
        segments: { 'out:top': TopToolbar },
      }),
    ])
    const pres = nodeRegistry.get('demo')
    expect(pres?.segments.in).toBe(InContent)
    expect(pres?.segments.title).toBe(TitleContent)
    expect(pres?.segments['out:top']).toBe(TopToolbar)
  })

  it('create 进入 nodeFactory，且卸载后回收', async () => {
    const create = () => 'n1'
    const { ctx, factory, nodeStore } = await boot([
      defineNode({ type: 'demo', label: '演示', size: { w: 10, h: 10 }, in: InContent, create }),
    ])
    expect(factory.creatableTypes()).toContain('demo')
    ctx.stop()
    expect(factory.creatableTypes()).not.toContain('demo')
    expect(nodeStore.types.has('demo')).toBe(false)
  })
})

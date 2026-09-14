/**
 * 生成写回的契约测试 —— 「点了发送之后，节点上的图到底变没变」。
 *
 * 这里用假的 ctx.tools 桩（一个普通对象）代替真实工具插件：
 * 面板对工具的全部了解就是内核契约（ToolDef/ToolResult/ToolProgress），桩能完整模拟它。
 * 用的断言都是用户能看见的结果：节点 data.imageUrl 变成新图、失败文案是什么、撤销是不是一步到位。
 */
import { describe, it, expect } from 'vitest'
import type { ToolDef, ToolInput, ToolProgress, ToolResult } from '@mini-canvas/kernel'
import { runImageGeneration, writeGeneratedImage, type ImageRunDeps } from '../imageRun'
import type { UpstreamMaterial } from '../panelSource'

/** 一个能出图的工具（声明了比例参数，尽量贴近真实工具插件注册的形状） */
function imageTool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: 'image.generate:demo',
    title: '示例出图',
    group: '图片生成',
    produces: 'image',
    accepts: ['image', 'text'],
    params: [{ key: 'ratio', type: 'select', default: '1:1', options: [{ label: '1:1', value: '1:1' }] }],
    run: () => ({ ok: true, urls: ['out.png'] }),
    ...over,
  }
}

/** 记录"调用与写回"的假依赖 */
function fakeDeps(over: Partial<ImageRunDeps> = {}): ImageRunDeps & {
  calls: Array<{ name: string; input: ToolInput; nodeId: string }>
  writes: Array<{ nodeId: string; data: Record<string, unknown>; size?: { w: number; h: number } }>
  progress: ToolProgress[]
} {
  const calls: Array<{ name: string; input: ToolInput; nodeId: string }> = []
  const writes: Array<{ nodeId: string; data: Record<string, unknown>; size?: { w: number; h: number } }> = []
  const progress: ToolProgress[] = []
  return {
    calls,
    writes,
    progress,
    invokeTool: async (name, input, opts) => {
      calls.push({ name, input, nodeId: opts.nodeId })
      return { ok: true, urls: ['data:image/png;base64,NEW'] }
    },
    readData: () => ({ imageUrl: 'data:image/png;base64,OLD', imageName: '旧图.png', imageWidth: 10, imageHeight: 10 }),
    writeData: (nodeId, data, size) => {
      writes.push({ nodeId, data, size })
    },
    measure: async () => ({ width: 1024, height: 768 }),
    ...over,
  }
}

const materials: UpstreamMaterial[] = [{ id: 'img1', kind: 'image', name: '猫', url: 'data:image/png;base64,A' }]

const baseArgs = {
  nodeId: 'n1',
  prompt: '一只猫',
  def: imageTool(),
  materials,
  params: { ratio: '1:1' },
}

describe('runImageGeneration：请求怎么发出去', () => {
  it('带上节点 id、提示词、素材与用户选的参数调工具', async () => {
    const deps = fakeDeps()
    const res = await runImageGeneration(baseArgs, deps)
    expect(res.ok).toBe(true)
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0].name).toBe('image.generate:demo')
    expect(deps.calls[0].nodeId).toBe('n1')
    expect(deps.calls[0].input.prompt).toBe('一只猫')
    expect(deps.calls[0].input.params).toEqual({ ratio: '1:1' })
    expect(deps.calls[0].input.resources?.map((r) => r.id)).toEqual(['img1'])
  })

  it('进度回调原样转发给面板（外部只给阶段时也能显示）', async () => {
    const deps = fakeDeps({
      invokeTool: async (name, input, opts) => {
        opts.onProgress({ message: '正在出图', progress: 30 })
        return { ok: true, urls: ['x.png'] }
      },
    })
    const seen: ToolProgress[] = []
    await runImageGeneration({ ...baseArgs, onProgress: (p) => seen.push(p) }, deps)
    expect(seen).toEqual([{ message: '正在出图', progress: 30 }])
  })

  it('没选工具 → 明确说明要先装工具插件，且不调外部', async () => {
    const deps = fakeDeps()
    const res = await runImageGeneration({ ...baseArgs, def: undefined }, deps)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没有可用的生成工具')
    expect(deps.calls).toHaveLength(0)
  })

  it('提示词与素材都为空 → 本地就挡住，不浪费一次外部调用', async () => {
    const deps = fakeDeps()
    const res = await runImageGeneration({ ...baseArgs, prompt: '   ', materials: [] }, deps)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('请先描述')
    expect(deps.calls).toHaveLength(0)
  })

  it('只有素材没写提示词 → 允许发送（图生图）', async () => {
    const deps = fakeDeps()
    const res = await runImageGeneration({ ...baseArgs, prompt: '' }, deps)
    expect(res.ok).toBe(true)
    expect(deps.calls).toHaveLength(1)
  })
})

describe('runImageGeneration：成功与失败', () => {
  it('成功 → 把 urls[0] 写回节点 data.imageUrl，并记下量到的尺寸', async () => {
    const deps = fakeDeps()
    const res = await runImageGeneration(baseArgs, deps)
    expect(res.url).toBe('data:image/png;base64,NEW')
    expect(deps.writes).toHaveLength(1)
    expect(deps.writes[0].nodeId).toBe('n1')
    expect(deps.writes[0].data.imageUrl).toBe('data:image/png;base64,NEW')
    expect(deps.writes[0].data.imageWidth).toBe(1024)
    expect(deps.writes[0].data.imageHeight).toBe(768)
  })

  it('写回是**一次**（撤销一步到位），且清掉旧图的文件名/大小', async () => {
    const deps = fakeDeps()
    await runImageGeneration(baseArgs, deps)
    expect(deps.writes).toHaveLength(1)
    expect(deps.writes[0].data.imageName).toBeUndefined()
    expect(deps.writes[0].data.imageSize).toBeUndefined()
    // 尺寸与 data 同一次（同一个 patch）→ 一次撤销退干净
    // 1024×768 / 上限 420×300：高是瓶颈（300/768=0.390625）→ 400×300
    expect(deps.writes[0].size).toEqual({ w: 400, h: 300 })
  })

  it('封顶值可配：注入更小的上限 → 出图后的卡片更小', async () => {
    const deps = fakeDeps({ fitLimits: () => ({ maxWidth: 200, maxHeight: 200 }) })
    await runImageGeneration(baseArgs, deps)
    // 1024×768 / 上限 200×200 → ratio=0.1953125 → 200×150
    expect(deps.writes[0].data.cardWidth).toBe(200)
    expect(deps.writes[0].data.cardHeight).toBe(150)
    expect(deps.writes[0].size).toEqual({ w: 200, h: 150 })
  })

  it('写回保留节点上其它字段（不能把别的 data 抹掉）', async () => {
    const deps = fakeDeps({
      readData: () => ({ imageUrl: 'old', label: '我的图', options: { ratio: '1:1' } }),
    })
    await runImageGeneration(baseArgs, deps)
    expect(deps.writes[0].data.label).toBe('我的图')
    expect(deps.writes[0].data.options).toEqual({ ratio: '1:1' })
  })

  it('量不到尺寸 → 只写地址并清空尺寸，不猜一个数字', async () => {
    const deps = fakeDeps({ measure: async () => null })
    await runImageGeneration(baseArgs, deps)
    expect(deps.writes[0].data.imageUrl).toBe('data:image/png;base64,NEW')
    expect(deps.writes[0].data.imageWidth).toBeUndefined()
    expect(deps.writes[0].data.imageHeight).toBeUndefined()
    // 尺寸都没有 → 卡片尺寸也不动（不猜），node.size 不传
    expect(deps.writes[0].data.cardWidth).toBeUndefined()
    expect(deps.writes[0].size).toBeUndefined()
  })

  it('出图后卡片宽高跟新图一致，且尺寸与 data 在同一处写回', async () => {
    const deps = fakeDeps()
    await runImageGeneration(baseArgs, deps)
    // 量到 1024×768 / 上限 420×300：高是瓶颈（300/768=0.390625）→ 400×300
    expect(deps.writes[0].data.cardWidth).toBe(400)
    expect(deps.writes[0].data.cardHeight).toBe(300)
    expect(deps.writes[0].size).toEqual({ w: 400, h: 300 })
  })

  it('工具返回失败 → 把工具的说明原样给用户，且**什么都不写回**（失败不落盘）', async () => {
    const deps = fakeDeps({
      invokeTool: async () => ({ ok: false, error: '额度不足，请充值' }),
    })
    const res = await runImageGeneration(baseArgs, deps)
    expect(res).toEqual({ ok: false, error: '额度不足，请充值' })
    expect(deps.writes).toHaveLength(0)
  })

  it('工具说成功但没给图片 → 如实报"没拿到图片"，不当成功', async () => {
    const deps = fakeDeps({ invokeTool: async () => ({ ok: true, urls: [] }) })
    const res = await runImageGeneration(baseArgs, deps)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没有拿到图片')
    expect(deps.writes).toHaveLength(0)
  })

  it('工具抛异常 → 收敛成失败文案，不把异常抛到面板外', async () => {
    const deps = fakeDeps({
      invokeTool: async () => {
        throw new Error('网络断了')
      },
    })
    const res = await runImageGeneration(baseArgs, deps)
    expect(res).toEqual({ ok: false, error: '网络断了' })
    expect(deps.writes).toHaveLength(0)
  })
})

describe('writeGeneratedImage：单独写回的规矩', () => {
  it('先量尺寸再写（一次 updateNode = 一条撤销记录）', async () => {
    const order: string[] = []
    const deps = fakeDeps({
      measure: async () => {
        order.push('measure')
        return { width: 800, height: 600 }
      },
      writeData: (id, data) => {
        order.push('write')
        expect(data.imageWidth).toBe(800)
      },
    })
    await writeGeneratedImage('n1', 'new.png', deps)
    expect(order).toEqual(['measure', 'write'])
  })
})

/**
 * 生成写回的契约测试 —— 「点了发送之后，节点上的图到底变没变」。
 *
 * 这里用假的 ctx.tools 桩（一个普通对象）代替真实工具插件：
 * 面板对工具的全部了解就是内核契约（ToolDef/ToolResult/ToolProgress），桩能完整模拟它。
 * 用的断言都是用户能看见的结果：节点 data.imageUrl 变成新图、失败文案是什么、撤销是不是一步到位。
 */
import { describe, it, expect } from 'vitest'
import type { ToolDef, ToolInput, ToolProgress, ToolResult } from '@mini-canvas/kernel'
/**
 * 历史说明：本文件原覆盖 runImageGeneration + writeGeneratedImage 两段；
 * runImageGeneration（组装+调工具+写回的全流程）随 ImageGeneratePanel 搬进 plugin-bottom-bar
 * （动作的 run + 写入器），这里的流程断言由 bottom-bar 的 taskRuntime.test.ts 覆盖。
 * 本文件只保留 writeGeneratedImage（image 写入器复用的写回函数）。
 */
import { writeGeneratedImage, type ImageRunDeps } from '../imageRun'

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
  writes: Array<{ nodeId: string; data: Record<string, unknown>; size?: { w: number; h: number } }>
} {
  const writes: Array<{ nodeId: string; data: Record<string, unknown>; size?: { w: number; h: number } }> = []
  return {
    writes,
    readData: () => ({ imageUrl: 'data:image/png;base64,OLD', imageName: '旧图.png', imageWidth: 10, imageHeight: 10 }),
    writeData: (nodeId, data, size) => {
      writes.push({ nodeId, data, size })
    },
    measure: async () => ({ width: 1024, height: 768 }),
    ...over,
  }
}

// 历史说明：baseArgs（含 UpstreamMaterial 素材行）随 runImageGeneration 搬进 plugin-bottom-bar。

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

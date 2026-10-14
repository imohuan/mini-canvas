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
import { isCanvasResourceUrl, isResourceRef, writeGeneratedImage, type ImageRunDeps } from '../imageRun'

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

describe('产物地址本地化：不该把外链留在画布上（2026-10-12 用户实测）', () => {
  it('外部 http 地址 → 先落地，写进节点的是本画布地址', async () => {
    const seen: string[] = []
    const deps = fakeDeps({
      persistImage: async (url) => {
        seen.push(url)
        return { url: '/api/canvases/default/resources/abc123.jpeg', resourceId: 'res-abc' }
      },
    })
    await writeGeneratedImage('n1', 'http://localhost:8033/api/resources/images/doubao/x.jpeg', deps)
    // 外链被收进去了
    expect(seen).toEqual(['http://localhost:8033/api/resources/images/doubao/x.jpeg'])
    // 节点上写的是本画布地址（换机器也打得开）
    expect(deps.writes[0]!.data.imageUrl).toBe('/api/canvases/default/resources/abc123.jpeg')
    expect(deps.writes[0]!.data.resourceId).toBe('res-abc')
  })

  it('**已经是本画布地址** → 不再重复落地（否则每写一次就多存一份字节）', async () => {
    let called = 0
    const deps = fakeDeps({ persistImage: async () => { called++; return undefined } })
    await writeGeneratedImage('n1', '/api/canvases/default/resources/exists.jpeg', deps)
    expect(called).toBe(0)
    expect(deps.writes[0]!.data.imageUrl).toBe('/api/canvases/default/resources/exists.jpeg')
  })

  it('本地资源引用（res-…）**不是显示地址**：先 resolve 再写 imageUrl，引用写进 resourceId（2026-10-13 修复）', async () => {
    // 现场：写回的产物是本地引用时，早先原样写进 data.imageUrl —— <img src="res-7"> 谁都打不开，
    // 刷新 / 换标签页 / 云端都取不到这张图。正确做法：字节已在资源库，resolve 换成当前可显示地址。
    let localized = 0
    const deps = fakeDeps({
      persistImage: async () => { localized++; return undefined },
      resolveRef: async (ref) => 'blob:resolved-' + ref,
    })
    await writeGeneratedImage('n1', 'res-7', deps)
    // 不重复落字节（引用已在库里），但必须换一次显示地址
    expect(localized).toBe(0)
    expect(deps.writes[0]!.data.imageUrl).toBe('blob:resolved-res-7')
    expect(deps.writes[0]!.data.resourceId).toBe('res-7')
  })

  it('引用解析不出（资源已不在 / 后端换不动）→ **不写**，保留原图（写引用只会得到破图）', async () => {
    const deps = fakeDeps({ resolveRef: async () => undefined })
    await writeGeneratedImage('n1', 'res-gone', deps)
    // 关键：不能把引用当地址写进去 —— 那正是本次要消灭的「打不开的地址」
    expect(deps.writes).toHaveLength(0)
  })

  it('引用没注入 resolveRef（极简宿主）→ 同样不写，不炸', async () => {
    const deps = fakeDeps()
    await writeGeneratedImage('n1', 'res-7', deps)
    expect(deps.writes).toHaveLength(0)
  })

  it('resolveRef 抛错（资源后端异常）→ 收敛成“不写”，不把异常甩给调用方', async () => {
    const deps = fakeDeps({ resolveRef: async () => { throw new Error('backend down') } })
    await expect(writeGeneratedImage('n1', 'res-7', deps)).resolves.toBeUndefined()
    expect(deps.writes).toHaveLength(0)
  })

  it('resolve 结果仍是引用形态（后端异常回显）→ 也不写：「引用绝不进 imageUrl」是硬不变量', async () => {
    const deps = fakeDeps({ resolveRef: async (ref) => ref })
    await writeGeneratedImage('n1', 'res-7', deps)
    expect(deps.writes).toHaveLength(0)
  })

  it('云端画布地址判据只认 /api/canvases/…（res- 引用不再算“已落地”）', () => {
    expect(isCanvasResourceUrl('/api/canvases/c1/resources/abc.png')).toBe(true)
    expect(isCanvasResourceUrl('res-7')).toBe(false)
    expect(isCanvasResourceUrl('https://x/a.png')).toBe(false)
    expect(isResourceRef('res-7')).toBe(true)
    expect(isResourceRef('resolve-me')).toBe(false)
  })

  it('落地失败 → 回落到原地址（保住图是底线，不给用户看空白）', async () => {
    const deps = fakeDeps({ persistImage: async () => undefined })
    await writeGeneratedImage('n1', 'http://localhost:8033/x.jpeg', deps)
    expect(deps.writes[0]!.data.imageUrl).toBe('http://localhost:8033/x.jpeg')
  })

  it('没注入 persistImage（不含资源服务的宿主）→ 原样写，不炸', async () => {
    const deps = fakeDeps()
    await writeGeneratedImage('n1', 'http://localhost:8033/x.jpeg', deps)
    expect(deps.writes[0]!.data.imageUrl).toBe('http://localhost:8033/x.jpeg')
  })

  it('dataURL 仍然要落地（别让 base64 进画布 JSON）', async () => {
    const seen: string[] = []
    const deps = fakeDeps({
      persistImage: async (url) => {
        seen.push(url)
        return { url: '/api/canvases/default/resources/d.png', resourceId: 'res-d' }
      },
    })
    await writeGeneratedImage('n1', 'data:image/png;base64,AAA', deps)
    expect(seen).toHaveLength(1)
    expect(deps.writes[0]!.data.imageUrl).toBe('/api/canvases/default/resources/d.png')
  })
})

/**
 * imageExpand —— 图片扩展（Outpaint）的坐标换算与执行契约（纯逻辑，Node 直接跑）。
 *
 * 这段算法最容易错、也最不容易肉眼发现：框往左扩 100px 时，原图在更大画布上的偏移
 * 到底是多少？算错不会报错，只会让用户拿到一张「原图跑到角落、内容错位」的图。
 * 所以这里把坐标换算钉死，并且单独锁住"没有实际扩大就不该写库"这条。
 */
import { describe, it, expect } from 'vitest'
import { computeExpandLayout, expandImage, isExpandEffective, type ExpandBitmapIO } from '../imageExpand'

describe('computeExpandLayout：扩展框 → 新画布尺寸与原图偏移', () => {
  it('往左扩 100：画布变宽 100，原图向右偏 100', () => {
    // 原图 1000×800，扩展框从 x=-100 开始、宽 1100（= 左边多 100）
    const layout = computeExpandLayout({ x: -100, y: 0, width: 1100, height: 800 }, 1000, 800, 1000, 800)
    expect(layout).toEqual({ canvasWidth: 1100, canvasHeight: 800, offsetX: 100, offsetY: 0 })
  })

  it('往上扩 50：画布变高 50，原图向下偏 50', () => {
    const layout = computeExpandLayout({ x: 0, y: -50, width: 1000, height: 850 }, 1000, 800, 1000, 800)
    expect(layout).toEqual({ canvasWidth: 1000, canvasHeight: 850, offsetX: 0, offsetY: 50 })
  })

  it('四周都扩：画布更大，原图整体往右下偏', () => {
    const layout = computeExpandLayout({ x: -100, y: -100, width: 1200, height: 1000 }, 1000, 800, 1000, 800)
    expect(layout).toEqual({ canvasWidth: 1200, canvasHeight: 1000, offsetX: 100, offsetY: 100 })
  })

  it('没扩（框 = 原图）：画布与原图同尺寸、无偏移', () => {
    const layout = computeExpandLayout({ x: 0, y: 0, width: 1000, height: 800 }, 1000, 800, 1000, 800)
    expect(layout).toEqual({ canvasWidth: 1000, canvasHeight: 800, offsetX: 0, offsetY: 0 })
  })

  it('真实位图比显示尺寸大时按比例换算（用户上传大图的情形）', () => {
    // 显示 500×400，真实位图 1000×800（2 倍）→ 框往左扩 50 显示像素 = 100 真实像素
    const layout = computeExpandLayout({ x: -50, y: 0, width: 550, height: 400 }, 500, 400, 1000, 800)
    expect(layout?.canvasWidth).toBe(550)
    expect(layout?.offsetX).toBe(100)
  })

  it('参数非法（尺寸 0 / 框无宽高）→ null，调用方放弃而不猜', () => {
    expect(computeExpandLayout({ x: 0, y: 0, width: 100, height: 100 }, 0, 800, 1000, 800)).toBeNull()
    expect(computeExpandLayout({ x: 0, y: 0, width: 100, height: 100 }, 1000, 0, 1000, 800)).toBeNull()
    expect(computeExpandLayout({ x: 0, y: 0, width: 0, height: 0 }, 1000, 800, 1000, 800)).toBeNull()
    expect(computeExpandLayout({ x: 0, y: 0, width: 100, height: 100 }, 1000, 800, 0, 0)).toBeNull()
  })
})

describe('isExpandEffective：没实际变大就不该写库', () => {
  it('框 = 原图 → 没扩，false（避免一条什么都没改的历史）', () => {
    expect(isExpandEffective({ x: 0, y: 0, width: 1000, height: 800 }, 1000, 800)).toBe(false)
  })

  it('任一方向扩出去 → true', () => {
    expect(isExpandEffective({ x: -1, y: 0, width: 1001, height: 800 }, 1000, 800)).toBe(true)
    expect(isExpandEffective({ x: 0, y: -1, width: 1000, height: 801 }, 1000, 800)).toBe(true)
    expect(isExpandEffective({ x: 0, y: 0, width: 1001, height: 800 }, 1000, 800)).toBe(true)
    expect(isExpandEffective({ x: 0, y: 0, width: 1000, height: 801 }, 1000, 800)).toBe(true)
  })
})

describe('expandImage：执行一次扩展', () => {
  /** 假位图端口：记录画布尺寸与绘制偏移，不碰真实 canvas */
  function fakeIO(bitmap: { width: number; height: number } | null = { width: 1000, height: 800 }) {
    const painted: Array<{ width: number; height: number; offsetX: number; offsetY: number }> = []
    let released = 0
    const io: ExpandBitmapIO = {
      load: async () => (bitmap ? { source: { fake: true } as unknown as CanvasImageSource, ...bitmap } : null),
      paint: (bounds, draw, source) => {
        // 用一个能记录 drawImage 参数的假 2d 上下文，把"画到哪儿"捕下来
        const calls: number[] = []
        const c2d = { drawImage: (...args: unknown[]) => calls.push(args[1] as number, args[2] as number) } as unknown as CanvasRenderingContext2D
        draw(c2d, source)
        painted.push({ width: bounds.width, height: bounds.height, offsetX: calls[0], offsetY: calls[1] })
        return 'data:image/png;base64,EXPANDED'
      },
      release: () => {
        released += 1
      },
    }
    return { io, painted, releasedCount: () => released }
  }

  it('产出新 dataURL，并按扩出来的偏移把原图画上去', async () => {
    const { io, painted } = fakeIO()
    const result = await expandImage('data:image/png;base64,SRC', { x: -100, y: -50, width: 1100, height: 850 }, 1000, 800, io)
    expect(result).toEqual({ dataUrl: 'data:image/png;base64,EXPANDED', width: 1100, height: 850 })
    expect(painted).toEqual([{ width: 1100, height: 850, offsetX: 100, offsetY: 50 }])
  })

  it('无论成败都释放位图（否则 ImageBitmap 会泄漏）', async () => {
    const ok = fakeIO()
    await expandImage('data:image/png;base64,SRC', { x: 0, y: 0, width: 1000, height: 800 }, 1000, 800, ok.io)
    expect(ok.releasedCount()).toBe(1)

    // 取图失败时没有位图可释放，也不该抛
    const noBmp = fakeIO(null)
    expect(await expandImage('x', { x: 0, y: 0, width: 10, height: 10 }, 1000, 800, noBmp.io)).toBeNull()
  })

  it('取图失败 / 地址为空 / 布局非法 → null（调用方保留原图，不写半成品）', async () => {
    const { io } = fakeIO()
    expect(await expandImage('', { x: 0, y: 0, width: 10, height: 10 }, 1000, 800, io)).toBeNull()
    expect(await expandImage('u', { x: 0, y: 0, width: 10, height: 10 }, 0, 0, io)).toBeNull()
    expect(await expandImage('u', { x: 0, y: 0, width: 0, height: 0 }, 1000, 800, io)).toBeNull()
  })

  it('画布产出失败 → null（不返回空 dataURL 让上游写出破图）', async () => {
    const { io } = fakeIO()
    const failing: ExpandBitmapIO = { ...io, paint: () => null }
    expect(
      await expandImage('u', { x: -10, y: 0, width: 1010, height: 800 }, 1000, 800, failing),
    ).toBeNull()
  })
})

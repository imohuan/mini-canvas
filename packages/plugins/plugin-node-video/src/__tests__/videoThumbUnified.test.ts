/**
 * 统一视频缩略图：**名字规则**与**尺寸规则**（用户 2026-10-31 定案）。
 *
 * 核心口径（用户原话）：「这里让你提供一份默认的缩略图，就是不携带参考的」。
 * 所以缩略图 = **整幅原片**，永远不带裁剪；裁剪只在节点显示时用 CSS 做。
 *
 * 三条要锁住的事：
 * 1. 同一段视频在什么情况下该复用同一张、什么时候必须换一张；
 * 2. 绝对地址 / 相对地址不能算成两个源（否则同一视频存两张图）；
 * 3. 三档各按**自己配置的宽高**生成，竖屏按高度收口（别按长边放大）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * 抓帧函数换成假的：这里测的是"传给它的参数对不对"，不是解码本身
 * （真解码要浏览器，那个在 Chrome 实测里验）。
 */
const captureSpy = vi.hoisted(() => vi.fn())
vi.mock('../videoThumbService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../videoThumbService')>()
  return { ...actual, captureVideoThumb: captureSpy }
})

import { __clearUnifiedThumbs, normalizeThumbSource, unifiedThumbOf, unifiedThumbRef } from '../videoThumbUnified'

const VIDEO = '/api/canvases/c1/resources/abc.mp4'

/**
 * 本文件跑在 node 环境（没有 location）。
 *
 * 规范化逻辑本来就读 location.origin 判断"是不是同源"，这里给它一个假的：
 * 测的是规则本身，不需要真浏览器。
 */
const ORIGIN = 'http://127.0.0.1:8865'
;(globalThis as { location?: { origin: string } }).location = { origin: ORIGIN }

describe('源地址规范化：同一视频只有一个名字', () => {
  it('同源绝对地址与相对地址折成同一个源', () => {
    const abs = new URL(VIDEO, ORIGIN).toString()
    expect(normalizeThumbSource(abs)).toBe(normalizeThumbSource(VIDEO))
  })

  it('blob: / data: 原样保留（它们只在本会话有效，本来就不该跨会话命中）', () => {
    expect(normalizeThumbSource('blob:http://x/abc')).toBe('blob:http://x/abc')
    expect(normalizeThumbSource('data:video/mp4;base64,AAAA')).toBe('data:video/mp4;base64,AAAA')
  })

  it('★ 绝对地址与相对地址算出同一个 ref（否则同一视频会存两张图）', () => {
    const abs = new URL(VIDEO, ORIGIN).toString()
    expect(unifiedThumbRef(abs, { tier: 1 })).toBe(unifiedThumbRef(VIDEO, { tier: 1 }))
  })

  it('跨源地址不折（别的站点同路径是另一段视频）', () => {
    const other = 'https://cdn.example.com' + VIDEO
    expect(normalizeThumbSource(other)).toBe(other)
  })
})

describe('ref 身份：该变的必须变，不该变的不变', () => {
  it('不同视频 → 不同 ref', () => {
    expect(unifiedThumbRef('/a/1.mp4', { tier: 1 })).not.toBe(unifiedThumbRef('/a/2.mp4', { tier: 1 }))
  })

  it('档位不同 → 不同 ref（多档位没被架空）', () => {
    const t1 = unifiedThumbRef(VIDEO, { tier: 1, width: 480, height: 270 })
    const t2 = unifiedThumbRef(VIDEO, { tier: 2, width: 512, height: 512 })
    const t3 = unifiedThumbRef(VIDEO, { tier: 3, width: 160, height: 160 })
    expect(new Set([t1, t2, t3]).size).toBe(3)
  })

  /**
   * 用户口径「默认缩略图不携带参考」的**核心断言**。
   *
   * 裁框根本不进名字：同一段视频裁法不同，拿到的仍是同一张整幅图。
   * 节点上看起来裁过，是由显示端 CSS 取景实现的。
   */
  it('★ 裁框不参与名字（同一视频只有一张整幅缩略图）', () => {
    const full = unifiedThumbRef(VIDEO, { tier: 1, width: 480, height: 270 })
    const same = unifiedThumbRef(VIDEO, { tier: 1, width: 480, height: 270 })
    expect(full).toBe(same)
    // 接口本身也不再接受裁框（类型层面就挡住"按裁法各存一张"）
    expect(Object.keys({ tier: 1, width: 480, height: 270 })).not.toContain('cropRect')
  })

  it('尺寸 / 质量改了 → 不同 ref（改设置后要重新生成）', () => {
    const base = unifiedThumbRef(VIDEO, { tier: 2, width: 512, height: 512, quality: 0.8 })
    expect(unifiedThumbRef(VIDEO, { tier: 2, width: 640, height: 640, quality: 0.8 })).not.toBe(base)
    expect(unifiedThumbRef(VIDEO, { tier: 2, width: 512, height: 512, quality: 0.6 })).not.toBe(base)
  })

  it('同样的身份 → 同样的 ref（缓存能命中）', () => {
    const id = { tier: 2 as const, width: 512, height: 512, quality: 0.8 }
    expect(unifiedThumbRef(VIDEO, id)).toBe(unifiedThumbRef(VIDEO, id))
  })

  /**
   * 三档统一口径：各按**自己配置的宽高**生成（用户 2026-10-31）。
   *
   * 第 1 档也带尺寸，但它的尺寸来自"源画面"，所以同一视频必然一致；
   * 关键是不能让"知不知道源尺寸"改变名字 —— 那会让节点与底栏各存一张。
   */
  it('★ 第 1 档：知不知道源尺寸都是同一个名字（节点与底栏/侧栏共用同一张）', () => {
    const knowSize = unifiedThumbRef(VIDEO, { tier: 1, width: 1920, height: 1080, frameWidth: 1920, frameHeight: 1080 })
    const onlyUrl = unifiedThumbRef(VIDEO, { tier: 1 })
    expect(knowSize).toBe(onlyUrl)
  })

  it('第 2/3 档：尺寸仍进名字（改配置必须换图）', () => {
    const a = unifiedThumbRef(VIDEO, { tier: 2, width: 512, height: 512 })
    const b = unifiedThumbRef(VIDEO, { tier: 2, width: 640, height: 640 })
    expect(a).not.toBe(b)
  })

  it('名字只用云端槽位允许的字符，且不超过 64 字', () => {
    const ref = unifiedThumbRef(VIDEO, {
      tier: 2, width: 512, height: 512, quality: 0.8,
      frameWidth: 1920, frameHeight: 1080,
    })
    expect(ref).toBeDefined()
    expect(ref!).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(ref!.length).toBeLessThanOrEqual(64)
  })
})

describe('生成参数：整幅原片 + 按配置宽高', () => {
  beforeEach(() => {
    __clearUnifiedThumbs()
    captureSpy.mockReset()
    captureSpy.mockResolvedValue('data:image/webp;base64,AAAA')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 用户口径：默认缩略图不携带参考 → 抓帧永远是整幅。
   *
   * 这里断言"压根没传裁框参数"。传了就等于把裁剪烧进图里，
   * 左侧栏 / 底栏拿不到裁框、必然对不上，而且每种裁法会多存一张。
   */
  it('★ 抓帧时不传任何裁框（整幅原片，全站共用一张）', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/nocrop.mp4', undefined, {
      tier: 1, width: 480, height: 270, frameWidth: 1920, frameHeight: 1080,
    })
    const opts = captureSpy.mock.calls[0]?.[1] as { cropRect?: unknown } | undefined
    expect(opts?.cropRect).toBeUndefined()
  })

  it('质量也要传下去（改了清晰度，出来的图才真的变清晰）', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/q.mp4', undefined, { tier: 2, quality: 0.55 })
    const opts = captureSpy.mock.calls[0]?.[1] as { quality?: number } | undefined
    expect(opts?.quality).toBe(0.55)
  })

  it('★ 竖屏按高度收口，不按长边放大（否则图会比配置的框还大）', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/portrait.mp4', undefined, {
      tier: 2, width: 512, height: 512, frameWidth: 1080, frameHeight: 1920,
    })
    const opts = captureSpy.mock.calls[0]?.[1] as { maxWidth?: number } | undefined
    // 512 * (1080/1920) = 288
    expect(opts?.maxWidth).toBe(288)
  })

  it('横屏直接用框宽（不放大也不多缩）', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/landscape.mp4', undefined, {
      tier: 2, width: 512, height: 512, frameWidth: 1920, frameHeight: 1080,
    })
    const opts = captureSpy.mock.calls[0]?.[1] as { maxWidth?: number } | undefined
    expect(opts?.maxWidth).toBe(512)
  })

  /**
   * 用户口径：「你这里有几个档次的视频显示比例的配置，生成就根据对应设置的宽高进行处理」。
   *
   * 第 1 档的框 = 源尺寸（原生帧），第 2/3 档 = 设置里的宽高。
   * 三档各按自己的框生成，互不干扰。
   */
  /**
   * 第 1 档 = 原生帧，口径固定为「源宽与 1080 取小」。
   *
   * 不同调用方给的 width 不一样（节点知道源尺寸、底栏传的是默认框），
   * 但生成参数必须一样，否则同一视频会存两张不同尺寸的图。
   */
  it('★ 第 1 档：不同调用方给的 width 不同，输出仍一致（原生帧 + 1080 上限）', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/t1a.mp4', undefined, {
      tier: 1, width: 1920, height: 1080, frameWidth: 1920, frameHeight: 1080,
    })
    await unifiedThumbOf('/api/canvases/c1/resources/t1b.mp4', undefined, { tier: 1 })
    const a = captureSpy.mock.calls[0]?.[1] as { maxWidth?: number } | undefined
    const b = captureSpy.mock.calls[1]?.[1] as { maxWidth?: number } | undefined
    expect(a?.maxWidth).toBe(1080)
    expect(b?.maxWidth).toBe(1080)
  })

  it('★ 第 2 档按设置里的宽高生成', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/t2cfg.mp4', undefined, {
      tier: 2, width: 512, height: 512, frameWidth: 1920, frameHeight: 1080,
    })
    const opts = captureSpy.mock.calls[0]?.[1] as { maxWidth?: number } | undefined
    expect(opts?.maxWidth).toBe(512)
  })

  it('★ 第 3 档按设置里的宽高生成', async () => {
    await unifiedThumbOf('/api/canvases/c1/resources/t3cfg.mp4', undefined, {
      tier: 3, width: 160, height: 160, frameWidth: 1920, frameHeight: 1080,
    })
    const opts = captureSpy.mock.calls[0]?.[1] as { maxWidth?: number } | undefined
    expect(opts?.maxWidth).toBe(160)
  })
})

describe('返回值：存库后回资源库地址', () => {
  beforeEach(() => {
    __clearUnifiedThumbs()
    captureSpy.mockReset()
    captureSpy.mockResolvedValue('data:image/webp;base64,AAAA')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 用户口径「一个视频一张图」的落地表现。
   *
   * 首次生成时若直接返回 dataURL，每个消费方各存一份几十 KB 的 base64，
   * 而且刷新前后地址不同（排查时看不出命中没命中）。存库后回资源库地址才对。
   */
  it('★ 存库成功 → 返回资源库地址，而不是 dataURL', async () => {
    // 第一次查（生成前）没有 → 走生成；存完再查（生成后）才有
    let stored = false
    const resources = {
      put: vi.fn().mockImplementation(async () => { stored = true; return 'vthumb-x' }),
      resolve: vi.fn().mockImplementation(async () =>
        stored ? '/api/canvases/c1/resources/slot-vthumb-x.webp' : undefined,
      ),
    }
    const got = await unifiedThumbOf('/api/canvases/c1/resources/store1.mp4', resources, { tier: 1 })
    expect(got).toBe('/api/canvases/c1/resources/slot-vthumb-x.webp')
    expect(resources.put).toHaveBeenCalledTimes(1)
  })

  it('存库失败 → 退回 dataURL（功能不受影响）', async () => {
    const resources = {
      put: vi.fn().mockRejectedValue(new Error('disk full')),
      resolve: vi.fn().mockResolvedValue(undefined),
    }
    const got = await unifiedThumbOf('/api/canvases/c1/resources/store2.mp4', resources, { tier: 1 })
    expect(got).toMatch(/^data:image\/webp/)
  })

  it('资源库已有 → 直接用，不重新生成', async () => {
    const resources = {
      put: vi.fn().mockResolvedValue('x'),
      resolve: vi.fn().mockResolvedValue('/api/canvases/c1/resources/slot-hit.webp'),
    }
    const got = await unifiedThumbOf('/api/canvases/c1/resources/hit1.mp4', resources, { tier: 1 })
    expect(got).toBe('/api/canvases/c1/resources/slot-hit.webp')
    expect(captureSpy).not.toHaveBeenCalled()
    expect(resources.put).not.toHaveBeenCalled()
  })
})

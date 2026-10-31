/**
 * videoThumbCanvas —— 视频帧图的生成与缓存（本插件自己的实现）。
 *
 * 与图片插件那份的差别只有一个：源是视频，要先 seek 到某一刻再 drawImage。
 * 其余（等比装框、只缩不放、内存 objectURL 缓存、不登记进资源服务）完全同源，
 * 理由见图片插件 thumbCanvas.ts 的文件头。
 *
 * ## 两个必须分清的尺寸（这里踩过坑，写下来防复发）
 * 1. **裁剪框**（节点上的 `cropRect`，视频像素坐标）：用户框掉不要的画面 —— 这是"取景"，
 *    只影响"看画面里的哪一块"；
 * 2. **档位目标框**（本插件 config 里的 tier2Width/Height…）：缩略图要多大 —— 这是"缩放"，
 *    只影响分辨率，**绝不改变画面内容**。
 *
 * ★ 踩过的坑：把"档位目标框"当成 `captureFrame` 的 crop 参数传进去 —— 那个参数是**裁剪**，
 * 于是它真的从画面左上角挖了 512×288 一块出来，用户看到的帧图变成了"被裁掉一角的放大图"
 * （2026-10-15 用户实测报的「它已经变成了裁剪，而不是整个图片缩小」）。
 * 现在这条路只在**用户真的裁过**时传 cropRect，而缩放一律由本文件的画布完成。
 *
 * 取帧仍然复用同包的 `captureFrame`（"seek 到某刻 → drawImage"）——
 * 只是把它当"整个画面/裁剪框的原图帧"用，缩放交给自己。
 */

/** 生成结果：可显示地址 + 像素尺寸 */
export interface TierFrame {
  url: string
  width: number
  height: number
}

/** 等比装进 box 的尺寸；只缩不放；源尺寸拿不到返回 null */
export function fitFrameIntoBox(
  sourceWidth: unknown,
  sourceHeight: unknown,
  box: { width: number; height: number },
): { width: number; height: number } | null {
  if (typeof sourceWidth !== 'number' || typeof sourceHeight !== 'number') return null
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) return null
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const boxW = Math.max(1, Math.round(box.width))
  const boxH = Math.max(1, Math.round(box.height))
  const ratio = Math.min(boxW / sourceWidth, boxH / sourceHeight, 1)
  return { width: Math.max(1, Math.round(sourceWidth * ratio)), height: Math.max(1, Math.round(sourceHeight * ratio)) }
}

/** 取帧端口（生产用 captureFrame；测试注入假实现） */
export interface FrameGrabber {
  (url: string, at: number, crop?: { x: number; y: number; width: number; height: number } | null): Promise<{ dataUrl: string; width: number; height: number } | null>
}

/** 矩形（视频像素坐标） */
export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 决定「抓帧要哪一块画面」——这是**取景**，与"缩到多大"完全无关。
 *
 * ★ 单独抽成纯函数、并带测试，是因为这里曾经出过一个很难从代码上一眼看见的 bug：
 * 把**档位目标尺寸**当成 `captureFrame` 的 crop 参数传了进去 —— 那个参数是**裁剪**，
 * 于是它真的从画面左上角挖了一块出来，帧图变成"裁剪放大图"
 * （2026-10-15 用户实测报的「它已经变成了裁剪，而不是整个图片缩小」）。
 *
 * @returns crop：要传给抓帧函数的裁剪框（**没裁过就是 null = 整幅**）；
 *          view：用于算缩放比例的尺寸
 */
export function resolveFrameView(
  cropRect: { x: number; y: number; width: number; height: number } | null | undefined,
  sourceWidth: number,
  sourceHeight: number,
): { crop: ViewRect | null; view: { width: number; height: number } } {
  const cropped = !!cropRect && cropRect.width > 0 && cropRect.height > 0
  if (!cropped) return { crop: null, view: { width: sourceWidth, height: sourceHeight } }
  const c = cropRect as ViewRect
  return { crop: { x: c.x, y: c.y, width: c.width, height: c.height }, view: { width: c.width, height: c.height } }
}

/** 一帧的三个档位（第 1 档 = 定格那一帧的原生尺寸；2/3 档是它的缩略图） */
export interface TierFrameSet {
  /** 档位 → 图（1/2/3；某档生成失败就缺那一档，调用方回落上一档） */
  tiers: Map<number, TierFrame>
}

/**
 * 把视频**某一刻**的画面抓下来，一次产出**三个档位的图**（用户口径）。
 *
 * ## 为什么三档一定要同一次抓帧
 * 用户的原话：从视频切回帧图时要"直接生成 3 个档次的图片"，第一档是**当前视频时间所在的这一帧**，
 * 另两档是**它的缩略图**。也就是说三档必须是**同一时刻、同一画面**，只是分辨率不同 ——
 * 否则用户缩放时会看到画面"跳"到别的时刻（帧图来自不同的 seek）。
 * 所以这里只 seek 一次、只抓一次，然后在这张图上缩出 2/3 档。
 *
 * ## 尺寸关系（`sourceWidth/Height` 传**定格那一帧的实际像素**）
 * 第 1 档 = 该帧原尺寸；第 2/3 档 = 该帧整体等比缩进配置的框（只缩不放）。
 *
 * @param at 定格时刻（秒）—— 调用方传用户停下的那个时间点
 * @param cropRect 节点上的**裁剪框**（可空）：有裁剪时先按框取景再缩，**不是**缩放尺寸
 *   （把目标尺寸当裁剪传会变成"从画面里挖一块"，2026-10-15 用户实测报过）
 */
export async function grabTierFrames(
  videoUrl: string,
  opts: {
    at: number
    boxes: { tier: number; box: { width: number; height: number } }[]
    cropRect?: { x: number; y: number; width: number; height: number } | null
    /** 定格那一帧的实际像素（由调用方从 video 元素读，可能与声明的源尺寸不同） */
    frameWidth: number
    frameHeight: number
    quality?: number
    grab: FrameGrabber
  },
): Promise<TierFrameSet | null> {
  if (typeof document === 'undefined' || !videoUrl) return null
  const quality = opts.quality ?? 0.8
  // 取景（看哪一块）与缩放（缩到多大）分开算 —— 见 resolveFrameView 的说明
  const { crop, view } = resolveFrameView(opts.cropRect, opts.frameWidth, opts.frameHeight)
  // 取帧要起一个临时 video 解码：一屏几十个视频节点同时来会把 CPU 打满（那是"画布更流畅"的反面）。
  // 用一个很小的闸门串起来（同一时刻 2 个），其余排队。
  return await withGrabSlot(async () => {
    // 只抓**一次**：第三个参数是**裁剪框**（没裁过 = null = 整幅），**绝不要传目标尺寸** ——
    // 传错会变成"从画面里挖一块"，帧图就成了裁剪放大图（2026-10-15 用户报的那个 bug）。
    const grabbed = await opts.grab(videoUrl, opts.at, crop)
    if (!grabbed) return null
    const source: Blob = await (await fetch(grabbed.dataUrl)).blob()
    const tiers = new Map<number, TierFrame>()
    for (const { tier, box } of opts.boxes) {
      // 第 1 档：定格那一帧的原尺寸，**不缩放**（用户口径：第一档就是这一帧的截图）
      if (tier === 1) {
        const full = await reencodeBlob(source, quality)
        if (full) tiers.set(1, { url: URL.createObjectURL(full), width: grabbed.width, height: grabbed.height })
        continue
      }
      // 第 2/3 档：把**这一帧**（或裁框内那块）整体缩进目标框
      const dest = fitFrameIntoBox(view.width, view.height, box)
      if (!dest) continue
      const scaled = await scaleToBox(source, dest, quality)
      if (scaled) tiers.set(tier, scaled)
    }
    return tiers.size > 0 ? { tiers } : null
  })
}

/** 按原尺寸重新编码一份（webp → jpeg 兜底）；失败返回 null（调用方用原始字节） */
async function reencodeBlob(blob: Blob, quality: number): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const decoded = await decodeBlob(blob)
  if (!decoded) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = decoded.width
    canvas.height = decoded.height
    const c2d = canvas.getContext('2d')
    if (!c2d) return null
    c2d.drawImage(decoded.source, 0, 0)
    return await encodeCanvas(canvas, quality)
  } catch {
    return null
  } finally {
    decoded.release()
  }
}

/**
 * 把一张图**整体**等比缩进 `box`，产出 objectURL。
 *
 * 这是"缩放"的唯一实现处：drawImage 一次性把整幅（或裁剪框内的整块）画进目标尺寸的画布 ——
 * 画面内容一个像素都不丢，只是分辨率降下来。
 * 任何一步失败返回 null（调用方保持原样，绝不显示半个画面）。
 */
export async function scaleToBox(
  src: string | Blob,
  box: { width: number; height: number },
  quality = 0.8,
): Promise<TierFrame | null> {
  if (typeof document === 'undefined') return null
  const blob = typeof src === 'string' ? await fetch(src).then((r) => r.blob()).catch(() => null) : src
  if (!blob) return null
  const decoded = await decodeBlob(blob)
  if (!decoded) return null
  try {
    const width = Math.max(1, Math.round(box.width))
    const height = Math.max(1, Math.round(box.height))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const c2d = canvas.getContext('2d')
    if (!c2d) return null
    // 缩小必须开高质量插值，否则细密的画面（树叶、发丝）会起明显锯齿
    c2d.imageSmoothingEnabled = true
    c2d.imageSmoothingQuality = 'high'
    c2d.drawImage(decoded.source, 0, 0, width, height)
    const out = await encodeCanvas(canvas, quality)
    if (!out) return null
    return { url: URL.createObjectURL(out), width, height }
  } catch {
    return null
  } finally {
    decoded.release()
  }
}

/** 画布 → 字节（webp 优先，失败退 jpeg）；都失败返回 null */
async function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const q = Math.min(1, Math.max(0.1, quality))
  const viaWebp = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b && b.size > 0 ? b : null), 'image/webp', q))
  if (viaWebp) return viaWebp
  return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b && b.size > 0 ? b : null), 'image/jpeg', q))
}

/** 同时最多几个取帧（模块级闸门；FIFO 排队） */
const MAX_CONCURRENT_GRABS = 2
let runningGrabs = 0
const grabQueue: Array<() => void> = []

async function withGrabSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (runningGrabs >= MAX_CONCURRENT_GRABS) {
    await new Promise<void>((resolve) => grabQueue.push(resolve))
  }
  runningGrabs += 1
  try {
    return await fn()
  } finally {
    runningGrabs -= 1
    const next = grabQueue.shift()
    if (next) next()
  }
}

/** 解码一个 Blob（优先 createImageBitmap） */
async function decodeBlob(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      /* 退回 <img> */
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return null
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    const done = (value: { source: CanvasImageSource; width: number; height: number; release(): void } | null): void => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    img.onload = () => done({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} })
    img.onerror = () => done(null)
    img.src = url
  })
}

/** 资源库端口（与图片插件那份同形状：只需要存字节与按引用取地址） */
export interface FrameResourcePort {
  put(blob: Blob, opts: { kind?: string; name?: string; ref?: string; derived?: boolean }): Promise<string>
  resolve(ref: string): Promise<string | undefined>
}

/**
 * 帧图缓存：`(源, 变体) → 生成结果`（每个内容组件一份）。
 *
 * ## 两级缓存（2026-10-15 改）
 * 1. **资源库（持久）**：帧图用**可推算的固定名**（源 + 档位 + 取帧时刻，见 videoThumbKey）
 *    存进资源库 —— 换会话/换设备命中就直接用，**不必再起一次视频解码**。
 *    存的时候标 `derived: true`，于是"未被节点引用即回收"的清理会跳过它。
 * 2. **内存（本组件）**：本会话已解析的地址；换源/卸载时释放。
 *
 * 为什么按"每个组件一份"：节点被删/换源时要能干净收尾，共享表会让"谁负责释放"变含糊。
 */
/**
 * 全局并发闸：帧图解析（起视频解码 + canvas 抓帧）是重活。大画布几十个视频节点同时挂载时
 * 全部并发跑，多核打满、页面长时间无响应（2026-10-15 卡死排查：纯 text 162 节点流畅、
 * 32 视频画布卡死）。按「同时最多 3 个」排队；缓存命中的快速路径不受闸限。
 */
let thumbGateActive = 0
const thumbGateQueue: Array<() => void> = []
async function thumbGate<T>(job: () => Promise<T>): Promise<T> {
  if (thumbGateActive >= 3) {
    await new Promise<void>((resolve) => thumbGateQueue.push(resolve))
  }
  thumbGateActive++
  try {
    return await job()
  } finally {
    thumbGateActive--
    thumbGateQueue.shift()?.()
  }
}
export class FrameCache {
  private store = new Map<string, Map<string, TierFrame>>()
  private pending = new Map<string, Promise<TierFrame | null>>()
  /**
   * 本缓存**自己创建**的 objectURL。
   *
   * 只释放自己造的：resource 服务解析出来的地址可能被多个节点共用（尤其本地 IndexedDB
   * 对同一个 ref 只建一个 objectURL），谁卸载谁 revoke 会把别人正在显示的图一起弄坏。
   */
  private readonly owned = new Set<string>()
  /**
   * 已确认**不存在**的引用名。
   *
   * 为什么要记：判断"服务端有没有这张图"要发一次 HEAD，而每次定格都是**新的时刻**、
   * 新的名字 —— 不记的话同一个名字会被反复探测（2026-10-15 实测：一次定格序列刷出
   * 二十多个 404，控制台一片红），而这些探测注定还是 404。
   * 名字一旦生成成功就会进 store，所以这里只需记住"试过、没有"。
   */
  private readonly missing = new Set<string>()

  private key(src: string, variant: string): string {
    return variant + ':' + src
  }

  /** 记下一个 objectURL 的所有权（只有 blob: 才需要回收） */
  private own(url: string): void {
    if (url.startsWith('blob:')) this.owned.add(url)
  }

  /** 归还本缓存拥有的地址；不是自己造的一律不碰 */
  private release(url: string): void {
    if (!this.owned.delete(url)) return
    try { URL.revokeObjectURL(url) } catch { /* 环境不支持 → 忽略 */ }
  }

  /**
   * 一次性回填三档（定格用）：**只在本组件内存里换**，不复用资源库的那一级。
   *
   * 为什么不用 resolveOrCreate：定格抓的是「眼前这一帧」，它的尺寸 / 裁框都不进引用名，
   * 仅凭「源 + 时刻」去查资源库会命中别处生成的图 —— 可能是别的裁框、别的像素尺寸、
   * 甚至是更早一次播放时留下的帧。用户看到的就成了「移开鼠标后预览没更新 / 比例不对」。
   * 定格帧只在本次会话有效（离开编辑器就回到默认帧图），所以内存这一级才是正确的落点。
   */
  setFrozenFrames(src: string, variantPrefix: string, frames: Map<number, TierFrame>): void {
    const perTier = this.store.get(src) ?? new Map<string, TierFrame>()
    // 同一时刻重复定格会拿回**同一批 URL**：先收集新图的地址，替换时绝不能把它们 revoke 掉。
    const nextUrls = new Set([...frames.values()].map((f) => f.url))
    // ★ 只换**定格项**：默认帧图也住在同一张表里，它是下一次回落的底图，
    //   连它一起 revoke 会让正在显示的那张变破图（用户 2026-10-30 实测：移开后闪白）。
    //   旧定格按前缀精确释放；新一帧刚生成、马上要显示，绝不能顺手 revoke。
    for (const [key, f] of [...perTier.entries()]) {
      if (!key.startsWith('frz:')) continue
      perTier.delete(key)
      if (!nextUrls.has(f.url)) this.release(f.url)
    }
    for (const [tier, frame] of frames) {
      const key = variantPrefix + ':' + tier
      perTier.set(key, frame)
      this.own(frame.url)
    }
    this.store.set(src, perTier)
  }

  async getOrCreate(
    src: string,
    /** 变体键：档位 + 取帧时刻等（同一源不同档位/不同时刻是两张图） */
    variant: string,
    make: () => Promise<TierFrame | null>,
  ): Promise<TierFrame | null> {
    const cached = this.store.get(src)?.get(variant)
    if (cached) return cached
    const inflight = this.pending.get(this.key(src, variant))
    if (inflight) return await inflight
    const task = make()
      .then((made) => {
        if (!made) return null
        this.own(made.url)
        const perTier = this.store.get(src) ?? new Map<string, TierFrame>()
        const existing = perTier.get(variant)
        if (existing) {
          this.release(made.url)
          return existing
        }
        perTier.set(variant, made)
        this.store.set(src, perTier)
        return made
      })
      .finally(() => {
        this.pending.delete(this.key(src, variant))
      })
    this.pending.set(this.key(src, variant), task)
    return await task
  }

  /**
   * 持久化那一级：按**可推算的固定名**先查资源库，命中直接用；没有才生成、生成完再存回去。
   *
   * @param make 生成一份帧图字节（不建 objectURL）—— 生产用"从眼前那个 video 元素直接抓"
   *   （见 grabFrameBlobsFromElement），零额外解码。
   */
  async resolveOrCreate(input: {
    src: string
    /** 变体键：档位 + 取帧时刻（进名字，所以不同时刻是两张图、各自命中） */
    variant: string
    /** 固定引用名（见 videoThumbKey）；拿不到就退化成"只走内存缓存" */
    ref?: string
    resources?: FrameResourcePort
    /** 生成字节；返回 null 表示这次生成失败（调用方继续显示原视频/上一张） */
    make: () => Promise<Blob | null>
    /**
     * 只读缓存模式（轻路）：只查内存/资源库，不进并发闸、不执行 make。
     * 刷新后节点先用它立刻取缓存帧图（不解码、不占 CPU），重活等门闩开了再走全量路径。
     */
    cacheOnly?: boolean
  }): Promise<TierFrame | null> {
    const { src, variant, ref, resources, make } = input
    const memory = this.store.get(src)?.get(variant)
    if (memory) return memory
    const key = this.key(src, variant)
    const inflight = this.pending.get(key)
    if (inflight) return await inflight
    if (input.cacheOnly) {
      // 轻路：内存已在上面查过；这里只做资源库探测（一次 HEAD/GET，不解码），
      // 不进 thumbGate、不注册 pending —— 门闩后全量路径会再走一遍并接手
      if (ref && resources) {
        const hit = await this.probeOnce(ref, resources)
        if (hit) {
          const per = this.store.get(src) ?? new Map<string, TierFrame>()
          per.set(variant, hit)
          this.store.set(src, per)
          return hit
        }
      }
      return null
    }
    const task = (async (): Promise<TierFrame | null> => {
      // 慢路径（可能起视频解码抓帧）过全局并发闸，防止几十个节点同时挂载时解码风暴
      // 卡死排查实验：暂时绕过并发闸（回滚验证 2026-10-15）
      return thumbGate(async () => {
        // ① 资源库命中：跨会话/跨设备复用，省掉的正是"起一次视频解码"
      if (ref && resources) {
        const hit = await this.probeOnce(ref, resources)
        if (hit) {
          const per = this.store.get(src) ?? new Map<string, TierFrame>()
          per.set(variant, hit)
          this.store.set(src, per)
          return hit
        }
      }
      // ② 没命中 → 生成
      const blob = await make()
      if (!blob) return null
      let url = URL.createObjectURL(blob)
      this.own(url)
      // ③ 存回资源库（固定名 + derived）：下次命中①
      if (ref && resources) {
        try {
          const stored = await resources.put(blob, { kind: 'image', name: ref + '.webp', ref, derived: true })
          const resolved = await resources.resolve(stored)
          if (resolved) {
            this.release(url)
            url = resolved
          }
        } catch {
          /* 存不进去就用本地 objectURL，功能不受影响 */
        }
      }
      const made: TierFrame = { url, width: 0, height: 0 }
      const per = this.store.get(src) ?? new Map<string, TierFrame>()
      const existing = per.get(variant)
      if (existing) {
        if (url !== existing.url) this.release(url)
        return existing
      }
      per.set(variant, made)
      this.store.set(src, per)
      return made
      })
    })().finally(() => {
      this.pending.delete(key)
    })
    this.pending.set(key, task)
    return await task
  }

  clearSource(src?: string): void {
    const drop = (source: string, map: Map<string, TierFrame>): void => {
      for (const frame of map.values()) this.release(frame.url)
      this.store.delete(source)
    }
    if (src === undefined) {
      for (const [source, map] of [...this.store.entries()]) drop(source, map)
      this.missing.clear()
      return
    }
    const map = this.store.get(src)
    if (map) drop(src, map)
  }

  /**
   * 只清某个源的**定格帧**，默认帧图保留。
   *
   * 用途：裁框变了 / 恢复整幅 / 尺寸配置变了 —— 旧定格已经与当前取景对不上，
   * 继续用它会把画面挂在错误的位置；而默认帧图仍是有效底图，没必要一起丢。
   */
  clearFrozen(src: string): void {
    const perTier = this.store.get(src)
    if (perTier) {
      for (const [key, f] of [...perTier.entries()]) {
        if (!key.startsWith('frz:')) continue
        perTier.delete(key)
        this.release(f.url)
      }
    }
  }

  /**
   * 探测一次"这个引用名在资源库里有没有"，并记住结果。
   *
   * 为什么要记住"不存在"：每次定格都是**新的时刻**、新的名字，不记的话同一个名字
   * 会被反复探测（2026-10-15 实测：一次定格序列刷出二十多个 404、控制台一片红），
   * 而它们注定还是 404。
   */
  private async probeOnce(ref: string, resources: FrameResourcePort): Promise<TierFrame | null> {
    if (this.missing.has(ref)) return null
    let url: string | undefined
    try {
      url = await resources.resolve(ref)
    } catch {
      url = undefined
    }
    if (!url) {
      this.missing.add(ref)
      return null
    }
    return { url, width: 0, height: 0 }
  }

  dispose(): void {
    this.clearSource()
    this.pending.clear()
  }
}


/**
 * 从**正在显示的 video 元素**上直接抓帧，一次产出三个档位。
 *
 * ## 为什么不复用 grabTierFrames（另起 video 元素去 seek）
 * 那条路要新起一个 video、等元数据、seek、再解码 —— 一张画布上有几十个视频节点时，
 * 每次定格都新起一个解码器，既慢又容易在解码器排队里卡住
 * （2026-10-15 实测：鼠标移开后视频暂停了，但画面迟迟切不过去，就是卡在这里）。
 * 而**画面本来就在眼前那个 video 元素里**：drawImage 一下就是当前帧，零额外解码、零等待。
 *
 * ## 三档怎么来
 * 同一帧画一次 → 缩出 1/2/3 档（用户口径：第一档是当前时刻那一帧，另两档是它的缩略图）。
 * 三档同源同帧，所以缩放时看到的画面**不会跳**到别的时刻。
 *
 * @param videoEl 正在显示的那个 video 元素（必须已加载、有 videoWidth/Height）
 * @param cropRect 节点上的裁剪框（可空）：有裁剪时先按框取景再缩，**不是**缩放尺寸
 */
export async function grabTierFramesFromElement(
  videoEl: HTMLVideoElement,
  opts: {
    boxes: { tier: number; box: { width: number; height: number } }[]
    cropRect?: { x: number; y: number; width: number; height: number } | null
    quality?: number
    /**
     * 取帧时刻（秒）。给了就先 seek 到这一刻再抓；省略 = 抓元素当前画面。
     *
     * 为什么需要：暂停状态下抓帧读的是"解码器最后呈现的那一帧"，而视频仍在播放时
     * drawImage 可能拿到正在解码的新帧。定格必须**精确对应**用户看到的时间点。
     */
    at?: number
  },
): Promise<TierFrameSet | null> {
  if (typeof document === 'undefined') return null
  const frameW = videoEl.videoWidth
  const frameH = videoEl.videoHeight
  if (!frameW || !frameH) return null
  // 给了时刻 → 等 seek 到位再画（与 captureFrame 的 2 秒超时同口径：宁可抓接近的一帧也不卡死）。
  // 已经在目标时刻 → 快路径直接画，不触发多余的 seek（见 seekVideoEl 的 <0.03 判定）。
  if (typeof opts.at === 'number' && Number.isFinite(opts.at)) {
    const ready = await seekVideoEl(videoEl, opts.at)
    if (!ready) return null
    // 非暂停状态等 seek 事件后会继续播，等一帧让解码器稳定（否则可能抓到新旧帧的混合）。
    if (!videoEl.paused) await new Promise((r) => requestAnimationFrame(() => r(null)))
  }
  const quality = opts.quality ?? 0.8
  const { crop, view } = resolveFrameView(opts.cropRect, frameW, frameH)
  try {
    // 一次 drawImage：按取景框把画面画进一块与"取景块"等大的画布（内容不缩放）
    const src = document.createElement('canvas')
    if (crop) {
      src.width = Math.max(1, Math.round(crop.width))
      src.height = Math.max(1, Math.round(crop.height))
    } else {
      src.width = frameW
      src.height = frameH
    }
    const srcCtx = src.getContext('2d')
    if (!srcCtx) return null
    if (crop) srcCtx.drawImage(videoEl, crop.x, crop.y, crop.width, crop.height, 0, 0, src.width, src.height)
    else srcCtx.drawImage(videoEl, 0, 0)
    const full: Blob | null = await encodeCanvas(src, quality)
    if (!full) return null
    const tiers = new Map<number, TierFrame>()
    for (const { tier, box } of opts.boxes) {
      if (tier === 1) {
        // 第 1 档 = 这一帧的原尺寸（不缩放）
        tiers.set(1, { url: URL.createObjectURL(full), width: src.width, height: src.height })
        continue
      }
      const dest = fitFrameIntoBox(view.width, view.height, box)
      if (!dest) continue
      const scaled = await scaleToBox(full, dest, quality)
      if (scaled) tiers.set(tier, scaled)
    }
    return tiers.size > 0 ? { tiers } : null
  } catch {
    return null
  }
}

/** 把 video 元素 seek 到指定时刻并等画面就绪（最多等 2 秒）；失败返回 false */
function seekVideoEl(videoEl: HTMLVideoElement, at: number): Promise<boolean> {
  const target = Math.max(0, at)
  if (Math.abs(videoEl.currentTime - target) < 0.03 && videoEl.readyState >= 2) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      videoEl.removeEventListener('seeked', onSeeked)
      videoEl.removeEventListener('loadeddata', onSeeked)
      if (timer !== null) clearTimeout(timer)
      resolve(ok)
    }
    const onSeeked = (): void => done(true)
    videoEl.addEventListener('seeked', onSeeked)
    videoEl.addEventListener('loadeddata', onSeeked)
    timer = setTimeout(() => done(false), 2000)
    try {
      videoEl.currentTime = target
    } catch {
      done(false)
    }
  })
}



/**
 * 从**正在显示的 video 元素**上直接抓帧，产出**目标尺寸**的一份字节（不建 objectURL）。
 *
 * 与 grabTierFramesFromElement 的区别：那个一次出三档、用于"定格"；
 * 这个只出**一档的字节**，用于"存进资源库"（地址由资源库管，所以不要 objectURL）。
 *
 * 复用同一条路径（drawImage 当前帧 → 缩进目标框），因此两种用途的画面完全一致。
 */
export async function grabFrameBlobFromElement(
  videoEl: HTMLVideoElement,
  opts: {
    box: { width: number; height: number }
    tier: number
    cropRect?: { x: number; y: number; width: number; height: number } | null
    quality?: number
  },
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const frameW = videoEl.videoWidth
  const frameH = videoEl.videoHeight
  if (!frameW || !frameH) return null
  const quality = opts.quality ?? 0.8
  const { crop, view } = resolveFrameView(opts.cropRect, frameW, frameH)
  try {
    const src = document.createElement('canvas')
    if (crop) {
      src.width = Math.max(1, Math.round(crop.width))
      src.height = Math.max(1, Math.round(crop.height))
    } else {
      src.width = frameW
      src.height = frameH
    }
    const srcCtx = src.getContext('2d')
    if (!srcCtx) return null
    if (crop) srcCtx.drawImage(videoEl, crop.x, crop.y, crop.width, crop.height, 0, 0, src.width, src.height)
    else srcCtx.drawImage(videoEl, 0, 0)
    // 第 1 档（原生尺寸）直接用这一份；2/3 档再缩一道路
    if (opts.tier === 1) return await encodeCanvas(src, quality)
    const dest = fitFrameIntoBox(view.width, view.height, opts.box)
    if (!dest) return null
    const out = document.createElement('canvas')
    out.width = dest.width
    out.height = dest.height
    const c2d = out.getContext('2d')
    if (!c2d) return null
    c2d.imageSmoothingEnabled = true
    c2d.imageSmoothingQuality = 'high'
    c2d.drawImage(src, 0, 0, dest.width, dest.height)
    return await encodeCanvas(out, quality)
  } catch {
    return null
  }
}




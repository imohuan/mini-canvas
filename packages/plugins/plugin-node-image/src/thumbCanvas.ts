/**
 * thumbCanvas —— 「在浏览器里把图缩小」的底座（本插件自己的实现）。
 *
 * 为什么自己画而不是调后台：用户口径 —— 画布本来就支持用 canvas 出缩略图，
 * 而插件里的 `ctx.get('resources').put()` 本来就"落到当前后端"：
 * 没装云时进本地 IndexedDB，装了云插件自动进画布文件夹。**前端生成一份代码两种后端通吃**，
 * 于是完全不需要后台参与，也不需要改任何基础包（符合"插件只改自己"的原则）。
 *
 * ## 缓存放哪、为什么
 * 生成的图**只放内存**，不进节点数据、不落盘：
 * - 不进节点 data：档位是**渲染期**的显示选择（跟缩放走），不是节点属性 ——
 *   写进去会为每一次缩放改动画布数据、还会占撤销栈；
 * - 不落盘（不复用资源库的持久引用）：引用名由后端决定（本地是随机 id、云端是内容哈希），
 *   无法按"源 + 档位"推导，也就没有"先查有没有、没有再造"的判据；
 *   真要跨会话复用得让插件自己维护一份索引，那是后话（见用户与 Codex 的方案讨论）。
 *
 * ## 与宿主资源回收的关系（必须知道的坑）
 * 宿主落盘前会回收"节点 `data.resourceId` 不再引用"的资源。我们生成的图不在任何节点里，
 * 若登记进资源服务就会被**反复回收**。所以这里只用 `URL.createObjectURL` 自己管生命周期
 * （插件卸载时统一 revoke），不碰资源服务。
 */

/** 生成结果：可显示地址 + 它的像素尺寸 */
export interface TierImage {
  url: string
  width: number
  height: number
}

/** 目标框（等比装进去，不裁不拉） */
export interface BoxSize {
  width: number
  height: number
}

/**
 * 等比缩放后装进 `box` 的实际尺寸；**只缩不放**。
 *
 * 只缩不放的理由：把 160px 的小图放大到 512 的框只会更糊，还更占内存 ——
 * 超出目标框的原尺寸（说明这图本来就不大）就直接沿用。
 * 拿不到源尺寸（0 / 非法）时返回 null，调用方据此跳过生成、继续用原图。
 */
export function fitIntoBox(
  sourceWidth: unknown,
  sourceHeight: unknown,
  box: BoxSize,
): { width: number; height: number; scaled: boolean } | null {
  if (typeof sourceWidth !== 'number' || typeof sourceHeight !== 'number') return null
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) return null
  if (sourceWidth <= 0 || sourceHeight <= 0) return null
  const boxW = Math.max(1, Math.round(box.width))
  const boxH = Math.max(1, Math.round(box.height))
  const ratio = Math.min(boxW / sourceWidth, boxH / sourceHeight, 1)
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
    scaled: ratio < 1,
  }
}

/** 解码一张图（优先 createImageBitmap：跨域 blob 更稳；退回 <img>）。非浏览器环境返回 null */
export async function decodeImage(url: string): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void } | null> {
  if (typeof document === 'undefined' || !url) return null
  if (typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const bitmap = await createImageBitmap(await res.blob())
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
      }
    } catch {
      /* 退回 <img> */
    }
  }
  if (typeof Image === 'undefined') return null
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * 把一张图缩进 `box`，产出可显示地址（objectURL）+ 实际尺寸。
 *
 * 质量用 webp（体积小、浏览器原生支持），失败退回 jpeg（老浏览器 / 无 webp 编码器）。
 * 任何一步拿不到（环境不支持 / 解码失败 / toBlob 失败）都返回 null，
 * 调用方保持原图显示 —— **绝不为了缩略图把画面变成空白**。
 */
export async function renderTierImage(
  srcUrl: string,
  box: BoxSize,
  quality = 0.8,
): Promise<TierImage | null> {
  const blob = await renderTierImageBlob(srcUrl, box, quality)
  if (!blob) return null
  const fit = await measureBox(srcUrl, box)
  if (!fit) return null
  return { url: URL.createObjectURL(blob), width: fit.width, height: fit.height }
}

/**
 * 只出**字节**（不建 objectURL）：资源库那一级要的是字节（存进去由库管地址）。
 * 与 renderTierImage 共用同一条缩放路径，避免"两条路各缩一遍"。
 */
export async function renderTierImageBlob(
  srcUrl: string,
  box: BoxSize,
  quality = 0.8,
): Promise<Blob | null> {
  if (typeof document === 'undefined' || !srcUrl) return null
  const decoded = await decodeImage(srcUrl)
  if (!decoded) return null
  try {
    const fit = fitIntoBox(decoded.width, decoded.height, box)
    if (!fit) return null
    const canvas = document.createElement('canvas')
    canvas.width = fit.width
    canvas.height = fit.height
    const c2d = canvas.getContext('2d')
    if (!c2d) return null
    // 缩放时开高质量插值（默认的 low 在小图上会有明显锯齿）
    c2d.imageSmoothingEnabled = true
    c2d.imageSmoothingQuality = 'high'
    c2d.drawImage(decoded.source, 0, 0, fit.width, fit.height)
    const blob = await new Promise<Blob | null>((resolve) => {
      const q = Math.min(1, Math.max(0.1, quality))
      canvas.toBlob(
        (b) => {
          if (b && b.size > 0) resolve(b)
          else canvas.toBlob((fallback) => resolve(fallback && fallback.size > 0 ? fallback : null), 'image/jpeg', q)
        },
        'image/webp',
        q,
      )
    })
    return blob
  } catch {
    return null
  } finally {
    decoded.release()
  }
}

/** 量一下这张源图缩进 box 之后的实际像素（与 renderTierImageBlob 同一套 fit 规则） */
async function measureBox(srcUrl: string, box: BoxSize): Promise<{ width: number; height: number } | null> {
  const decoded = await decodeImage(srcUrl)
  if (!decoded) return null
  try {
    const fit = fitIntoBox(decoded.width, decoded.height, box)
    return fit ? { width: fit.width, height: fit.height } : null
  } finally {
    decoded.release()
  }
}

/** 生成器：把源按目标框缩出字节（生产用 renderTierImageBlob；测试注入假货） */
export type TierBlobRenderer = (src: string, box: BoxSize, quality: number) => Promise<Blob | null>

/** 资源库端口：只需要"存字节（给固定名）"与"按引用取显示地址"两件事 */
export interface ThumbResourcePort {
  put(blob: Blob, opts: { kind?: string; name?: string; ref?: string; derived?: boolean }): Promise<string>
  resolve(ref: string): Promise<string | undefined>
}

/**
 * 档位图的缓存：`源地址 → 档位 → 生成结果`（**每个内容组件一份**）。
 *
 * ## 两级缓存（2026-10-15 改）
 * 1. **资源库（持久）**：生成结果用**可推算的固定名**存进资源库 ——
 *    刷页面 / 换设备 / 重开画布都还在，先 `resolve(ref)` 命中就直接用，
 *    **不必重新解码原图**（这正是"节点一多就每次卡几秒"的解药）。
 *    存的时候标 `derived: true`：派生资源不写进节点 resourceId，
 *    所以"未被引用即回收"的清理会跳过它（否则刚存就被清、等于没存）。
 * 2. **内存（本组件）**：本会话已解析出来的地址；组件卸载/换源时释放。
 *
 * 为什么仍然按"每个组件一份"：节点被删/换图时要能干净地收尾，
 * 共享表会让"谁负责释放"变得含糊（漏释放就是内存泄漏，界面上看不出来）。
 */
export class ThumbCache {
  private store = new Map<string, Map<string, TierImage>>()
  /** 进行中的生成：同一（源 + 名字）并发只跑一次 */
  private pending = new Map<string, Promise<TierImage | null>>()

  /**
   * 内存缓存的键 = **源 + 名字**。
   *
   * ★ 名字里已经含"档位 + 目标尺寸 + 质量"（见 thumbKey.thumbRefParam），
   * 所以把名字当键就等于"所有影响内容的参数都参与了缓存身份"。
   * 只按档位记的话，用户在设置里改了宽高之后同一个会话里仍会命中改之前那份
   * （2026-10-15 用户实测：「我这边在配置中重新设置了最大宽高……它依然使用的是之前的图片」）。
   *
   * 拿不到名字（源不是画布资源、名字超长）→ 退化成档位键：功能照常，只是"改了尺寸要重建"。
   */
  private key(src: string, variant: string): string {
    return variant + ':' + src
  }

  /**
   * 持久化那一级：按**可推算的固定名**先查资源库，命中直接用；没有才生成、生成完再存回去。
   *
   * 这是"不再每次重算"的关键 —— 名字由「源 + 档位 + 质量」算出（见 thumbKey），
   * 所以换会话/换设备只要资源库还在（云端是画布文件夹、本地是 IndexedDB）就能命中。
   *
   * 三条保护：
   * - 资源库不可用（极简宿主）→ 直接退回"每次生成"，功能不受影响；
   * - `resolve` 拿不到（名字不存在）→ 生成后 `put`（标 derived，见类注释）；
   * - 生成/存取失败 → 返回 null，调用方继续用原图（绝不因为缩略图把画面弄空）。
   */
  async resolveOrCreate(input: {
    src: string
    tier: number
    box: BoxSize
    quality: number
    /** 固定引用名（见 makeThumbRef）；拿不到就退化成"只走内存缓存" */
    ref?: string
    resources?: ThumbResourcePort
    render?: TierBlobRenderer
  }): Promise<TierImage | null> {
    const { src, tier, box, quality, ref, resources } = input
    const doRender = input.render ?? renderTierImageBlob
    // 缓存身份 = 可推算名字（含档位/尺寸/质量）；名字拿不到时退化成档位
    const variant = ref ?? 't' + tier
    const key = this.key(src, variant)
    const memory = this.store.get(src)?.get(variant)
    if (memory) return memory

    const inflight = this.pending.get(key)
    if (inflight) return await inflight
    const task = (async (): Promise<TierImage | null> => {
      // ① 资源库命中（跨会话复用；这一步省掉的正是"重新解码原图"那几秒）
      if (ref && resources) {
        let cachedUrl: string | undefined
        try {
          cachedUrl = await resources.resolve(ref)
        } catch {
          cachedUrl = undefined
        }
        if (cachedUrl) {
          const hit: TierImage = { url: cachedUrl, width: box.width, height: box.height }
          const perTier = this.store.get(src) ?? new Map<string, TierImage>()
          perTier.set(variant, hit)
          this.store.set(src, perTier)
          return hit
        }
      }
      // ② 没命中 → 生成
      const blob = await doRender(src, box, quality)
      if (!blob) return null
      let url = URL.createObjectURL(blob)
      // ③ 存回资源库（固定名 + derived）：下次就命中①了
      if (ref && resources) {
        try {
          const stored = await resources.put(blob, {
            kind: 'image',
            name: ref + '.webp',
            ref,
            derived: true,
          })
          const resolved = await resources.resolve(stored)
          if (resolved) {
            URL.revokeObjectURL(url)
            url = resolved
          }
        } catch {
          /* 存不进去就用本地 objectURL，功能不受影响 */
        }
      }
      const made: TierImage = { url, width: box.width, height: box.height }
      const perTier = this.store.get(src) ?? new Map<string, TierImage>()
      const existing = perTier.get(variant)
      if (existing) {
        // 竞态：别人先写好了 → 用他那一份（自己这份的 objectURL 归还，避免泄漏）
        if (url !== existing.url) URL.revokeObjectURL(url)
        return existing
      }
      perTier.set(variant, made)
      this.store.set(src, perTier)
      return made
    })().finally(() => {
      this.pending.delete(key)
    })
    this.pending.set(key, task)
    return await task
  }

  /** 清掉某个源的全部档位（换图时调）：释放 objectURL，避免泄漏 */
  clearSource(src?: string): void {
    const drop = (source: string, map: Map<string, TierImage>): void => {
      for (const img of map.values()) URL.revokeObjectURL(img.url)
      this.store.delete(source)
    }
    if (src === undefined) {
      for (const [source, map] of [...this.store.entries()]) drop(source, map)
      return
    }
    const map = this.store.get(src)
    if (map) drop(src, map)
  }

  /** 全量释放（组件卸载时调） */
  dispose(): void {
    this.clearSource()
    this.pending.clear()
  }
}


/**
 * videoThumbService —— 给外部（底栏参考卡、标签）提供「视频缩略图」的基础服务。
 *
 * 用户口径 2026-10-28（第三轮）：
 *   ① 尺寸：一张图管全部用途 —— **宽度上限 1080、短边不小于 50、保持原比例**。
 *      卡片/标签用 CSS 缩小，hover 直接放大用同一张，不再单独截小图。
 *   ② 纯色检测：开头若是全黑/全白（同色像素占比 > 50%），跳到更后面的帧再截，
 *      避免生成一张没有意义的纯色图。
 *
 * 为什么放在视频插件里：只有它知道怎么解码视频、seek、抓帧；别的插件（底栏）
 * 只需要「给我一个能显示的缩略图地址」，通过 ctx.get('videoThumb') 调用即可，
 * 不 import 本包代码（插件之间不交叉依赖）。
 */

/** 缩略图默认宽度上限（用户口径：1080；原视频更窄就按原宽） */
export const VIDEO_THUMB_MAX_WIDTH = 1080

/** 短边下限（用户口径：最小的一条边至少 50px） */
export const VIDEO_THUMB_MIN_SHORT_SIDE = 50

/** 同色像素占比超过这个值就判定为「无意义的纯色帧」 */
export const SOLID_FRAME_RATIO = 0.5

/** 依次尝试的取帧时刻（秒）：开头 → 稍后 → 更后，避开片头黑场/白场 */
export const VIDEO_THUMB_SEEK_POINTS = [0, 0.5, 1.5, 3]

/**
 * 算缩略图的输出尺寸（纯函数，方便直接断言）。
 *
 * 规则（用户 2026-10-28 第三轮）：
 * 1. **保持视频原比例**，绝不拉伸成 1:1；
 * 2. 宽度 = min(原宽, maxWidth=1080)；原视频更窄就按原宽（不放大）；
 * 3. 缩放后短边若不足 50，再按短边 50 放大一次（只对极细长的片子生效）。
 */
export function thumbSizeFor(
  videoWidth: number,
  videoHeight: number,
  maxWidth: number = VIDEO_THUMB_MAX_WIDTH,
): { width: number; height: number } {
  const vw = videoWidth > 0 ? videoWidth : maxWidth
  const vh = videoHeight > 0 ? videoHeight : maxWidth
  const shortSide = Math.min(vw, vh)
  let ratio = Math.min(maxWidth / vw, 1)
  if (shortSide * ratio < VIDEO_THUMB_MIN_SHORT_SIDE) {
    ratio = VIDEO_THUMB_MIN_SHORT_SIDE / shortSide
  }
  return { width: Math.max(1, Math.round(vw * ratio)), height: Math.max(1, Math.round(vh * ratio)) }
}
/**
 * 从视频地址取一张「有意义的」缩略图（dataURL）。
 *
 * 流程：按 VIDEO_THUMB_SEEK_POINTS 依次 seek → 抓帧 → 判纯色；
 * 第一张不是纯色的就用它；全是纯色就退回最后一帧（总比没有强）。
 * 任何一步失败返回 null（调用方保持占位图标）。
 */
export async function captureVideoThumb(
  videoUrl: string,
  opts: { maxWidth?: number; seekPoints?: number[]; solidRatio?: number } = {},
): Promise<string | null> {
  if (typeof document === 'undefined' || !videoUrl) return null
  /** 宽度上限（缺省 1080）。原视频比它窄就用原宽 —— 不放大，放大只会糊。 */
  const maxWidth = typeof opts.maxWidth === 'number' && opts.maxWidth > 0 ? Math.round(opts.maxWidth) : VIDEO_THUMB_MAX_WIDTH
  const points = opts.seekPoints ?? VIDEO_THUMB_SEEK_POINTS
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = videoUrl

  const canvas = document.createElement('canvas')
  const c2d = canvas.getContext('2d', { willReadFrequently: true })
  if (!c2d) return null

  /** seek 到指定时刻并等可绘制 */
  const seek = (at: number) =>
    new Promise<boolean>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done)
        video.removeEventListener('error', fail)
        resolve(true)
      }
      const fail = () => {
        video.removeEventListener('seeked', done)
        video.removeEventListener('error', fail)
        resolve(false)
      }
      if (video.readyState >= 2 && Math.abs(video.currentTime - at) < 0.05) { resolve(true); return }
      video.addEventListener('seeked', done, { once: true })
      video.addEventListener('error', fail, { once: true })
      try { video.currentTime = at } catch { resolve(false) }
    })

  try {
    // 等元数据（拿得到 duration 才能决定后续 seek 点是否有效）
    const ready = await new Promise<boolean>((resolve) => {
      const ok = () => { cleanup(); resolve(true) }
      const bad = () => { cleanup(); resolve(false) }
      const cleanup = () => {
        video.removeEventListener('loadeddata', ok)
        video.removeEventListener('error', bad)
      }
      if (video.readyState >= 2) { resolve(true); return }
      video.addEventListener('loadeddata', ok, { once: true })
      video.addEventListener('error', bad, { once: true })
      video.load()
    })
    if (!ready) return null

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    let lastDataUrl: string | null = null

    for (const rawAt of points) {
      // 超出时长的点跳过（短视频里 3s 可能不存在）
      const at = duration > 0 ? Math.min(rawAt, Math.max(0, duration - 0.05)) : rawAt
      if (duration > 0 && at > duration) continue
      if (!(await seek(at))) continue

      /**
       * 尺寸规则（用户 2026-10-28 第三轮）：
       * - **保持视频原比例**（绝不拉伸成 1:1）；
       * - 宽度取 min(原宽, 上限 1080)；原视频更窄就按原宽，不放大；
       * - 缩放后短边若小于 50，再按短边 50 放大一次（用户要求「最小的一条边 50px」）。
       *   仅对极细长的视频生效，常规 16:9 / 9:16 都不会触发。
       */
      const { width: cw, height: ch } = thumbSizeFor(video.videoWidth, video.videoHeight, maxWidth)
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      c2d.clearRect(0, 0, cw, ch)
      try { c2d.drawImage(video, 0, 0, cw, ch) } catch { continue }

      // 纯色检测（用户要求：同色 > 50% 就跳过，找后面的帧）
      let solid = false
      try {
        const data = c2d.getImageData(0, 0, cw, ch).data
        solid = isSolidFrame(data, cw, ch, opts.solidRatio)
      } catch {
        // 跨域污染等读不了像素：无法判定纯色，先当可用
        solid = false
      }

      let dataUrl: string | null = null
      try { dataUrl = canvas.toDataURL('image/webp', 0.8) } catch { dataUrl = null }
      if (!dataUrl) { try { dataUrl = canvas.toDataURL('image/png') } catch { dataUrl = null } }
      if (!dataUrl) continue
      lastDataUrl = dataUrl
      if (!solid) return dataUrl   // 找到有内容的帧，直接用
    }

    // 全是纯色：退回最后一张（总比没有强）
    return lastDataUrl
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    try { video.load() } catch { /* 忽略 */ }
  }
}


/**
 * 判断一帧是否「纯色」（全黑/全白等）。
 *
 * 采样步长 4 像素（50×50 只有 2500 像素，全采样也不贵，但解码后可能更大，
 * 所以按步长抽样，够用且快）。同色像素占比 > 50% 即判定为纯色。
 */
export function isSolidFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ratio = SOLID_FRAME_RATIO,
): boolean {
  if (!pixels || width <= 0 || height <= 0) return true
  const step = 4
  let sampled = 0
  let solid = 0
  // 以第一个采样点为基准色（纯色帧里所有点都一样）
  let base: { r: number; g: number; b: number } | null = null
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      sampled += 1
      if (!base) { base = { r, g, b }; solid += 1; continue }
      // 容差 12：压缩噪点不至于把纯色帧判成非纯色
      if (Math.abs(r - base.r) <= 12 && Math.abs(g - base.g) <= 12 && Math.abs(b - base.b) <= 12) solid += 1
    }
  }
  return sampled > 0 && solid / sampled > ratio
}


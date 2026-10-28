/**
 * videoThumbService —— 给外部（底栏参考卡、标签）提供「视频缩略图」的基础服务。
 *
 * 用户口径 2026-10-28：
 *   ① 尺寸：宽高 50px 就够（参考卡/标签里只是小头像，不需要大图）；
 *   ② 纯色检测：开头若是全黑/全白（同色像素占比 > 50%），跳到更后面的帧再截，
 *      避免生成一张没有意义的纯色图。
 *
 * 为什么放在视频插件里：只有它知道怎么解码视频、seek、抓帧；别的插件（底栏）
 * 只需要「给我一个能显示的缩略图地址」，通过 ctx.get('videoThumb') 调用即可，
 * 不 import 本包代码（插件之间不交叉依赖）。
 */

/** 缩略图边长（用户要求：宽高 50px） */
export const VIDEO_THUMB_SIZE = 50

/** 同色像素占比超过这个值就判定为「无意义的纯色帧」 */
export const SOLID_FRAME_RATIO = 0.5

/** 依次尝试的取帧时刻（秒）：开头 → 稍后 → 更后，避开片头黑场/白场 */
export const VIDEO_THUMB_SEEK_POINTS = [0, 0.5, 1.5, 3]
/**
 * 从视频地址取一张「有意义的」缩略图（dataURL）。
 *
 * 流程：按 VIDEO_THUMB_SEEK_POINTS 依次 seek → 抓帧 → 判纯色；
 * 第一张不是纯色的就用它；全是纯色就退回最后一帧（总比没有强）。
 * 任何一步失败返回 null（调用方保持占位图标）。
 */
export async function captureVideoThumb(
  videoUrl: string,
  opts: { size?: number; seekPoints?: number[]; solidRatio?: number } = {},
): Promise<string | null> {
  if (typeof document === 'undefined' || !videoUrl) return null
  const size = opts.size ?? VIDEO_THUMB_SIZE
  const points = opts.seekPoints ?? VIDEO_THUMB_SEEK_POINTS
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = videoUrl

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
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

      // 等比装进 size×size（不拉伸），居中留白
      const vw = video.videoWidth || size
      const vh = video.videoHeight || size
      const ratio = Math.min(size / vw, size / vh, 1)
      const dw = Math.max(1, Math.round(vw * ratio))
      const dh = Math.max(1, Math.round(vh * ratio))
      const dx = Math.round((size - dw) / 2)
      const dy = Math.round((size - dh) / 2)
      c2d.clearRect(0, 0, size, size)
      try { c2d.drawImage(video, dx, dy, dw, dh) } catch { continue }

      // 纯色检测（用户要求：同色 > 50% 就跳过，找后面的帧）
      let solid = false
      try {
        const data = c2d.getImageData(0, 0, size, size).data
        solid = isSolidFrame(data, size, size, opts.solidRatio)
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


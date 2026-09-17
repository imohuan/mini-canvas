/**
 * videoTransform —— 视频的浏览器侧加工（读元数据 / 截图 / 下载 / 读取选中的文件）。
 *
 * 归本包私有：这些操作不需要内核能力，只是 video 元素与 canvas 的薄封装。
 * 全部函数在**非浏览器环境（node 单测）里安全返回 null / false**，所以插件在无头环境
 * import 本模块不会炸 —— 这也是把这些副作用挡在纯逻辑之外的原因。
 *
 * 截图为什么走 canvas：把视频当前帧 drawImage 到 canvas，再 toDataURL 成 PNG。
 * 拿到的是 **dataURL** 而不是 objectURL —— 刷新后仍然显示（objectURL 出文档即失效），
 * 与图片节点上传的取舍一致。
 */

/** 视频元数据（读到多少给多少；完全读不到返回 null） */
export interface VideoMeta {
  width: number
  height: number
  duration: number
}

/** 截图结果：新的图片地址与它的像素尺寸 */
export interface FrameResult {
  dataUrl: string
  width: number
  height: number
}

/** 读视频元数据（宽/高/时长）。浏览器不支持或解码失败返回 null，调用方退回默认卡片尺寸。 */
export function readVideoMeta(url: string): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !url) {
      resolve(null)
      return
    }
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const finish = (value: VideoMeta | null): void => {
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null)
        return
      }
      finish({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      })
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}

/** 等 seek 到位（超时也放行 —— 宁可截到接近的一帧，也不要卡住整个操作） */
function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.03 && video.readyState >= 2) {
      resolve()
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const done = (): void => {
      if (settled) return
      settled = true
      video.removeEventListener('seeked', done)
      video.removeEventListener('loadeddata', done)
      if (timer) clearTimeout(timer)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.addEventListener('loadeddata', done)
    timer = setTimeout(done, 2000)
    video.currentTime = time
  })
}

/**
 * 截取某一时刻的画面 → PNG dataURL。
 *
 * 裁剪框存在时**只截框内那一块**（用户的直觉：我裁了就该拿到裁好的图），
 * 帧尺寸随之变成框的尺寸。
 *
 * @param at 取帧时刻（秒）；超出范围时由调用方收敛，这里再兜一次底
 * @returns 失败（环境不支持 / 解码失败 / 画布拿不到上下文）返回 null
 */
export async function captureFrame(
  url: string,
  at: number,
  crop?: { x: number; y: number; width: number; height: number } | null,
): Promise<FrameResult | null> {
  if (typeof document === 'undefined' || !url) return null
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.preload = 'auto'
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('视频解码失败'))
    })
    if (!video.videoWidth || !video.videoHeight) return null
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const safeTime = Math.min(Math.max(0, Number(at) || 0), Math.max(0, duration - 0.05))
    await waitForSeek(video, safeTime)

    const sx = crop ? Math.max(0, Math.round(crop.x)) : 0
    const sy = crop ? Math.max(0, Math.round(crop.y)) : 0
    const sw = crop ? Math.max(1, Math.round(crop.width)) : video.videoWidth
    const sh = crop ? Math.max(1, Math.round(crop.height)) : video.videoHeight

    const canvas = document.createElement('canvas')
    canvas.width = Math.min(sw, video.videoWidth - sx)
    canvas.height = Math.min(sh, video.videoHeight - sy)
    if (canvas.width <= 0 || canvas.height <= 0) return null
    const c2d = canvas.getContext('2d')
    if (!c2d) return null
    c2d.drawImage(video, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    if (!dataUrl.startsWith('data:image')) return null
    return { dataUrl, width: canvas.width, height: canvas.height }
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * 触发浏览器下载（非浏览器环境 no-op）。
 *
 * 只允许 blob: / data:video / http(s) 这几种地址 —— 与 v1 downloadVideoFile 同一道防线，
 * 免得嵌进来的脚本地址被当作下载地址执行。
 */
export function downloadVideo(url: string, fileName: string): boolean {
  if (typeof document === 'undefined' || !url) return false
  let parsed: URL
  try {
    parsed = new URL(url, document.baseURI)
  } catch {
    return false
  }
  const okProtocol =
    parsed.protocol === 'http:' ||
    parsed.protocol === 'https:' ||
    parsed.protocol === 'blob:' ||
    (parsed.protocol === 'data:' && url.startsWith('data:video/'))
  if (!okProtocol) return false
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}

/**
 * 打开系统选视频框并等用户选完（仅浏览器；非浏览器/取消都返回 null）。
 * 供"命令触发上传"用：命令与按钮走同一个上传实现，差别只是文件从哪来。
 */
export function pickVideoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    const finish = (file: File | null): void => {
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

/**
 * File/Blob → objectURL。
 *
 * 视频**刻意不转 dataURL**（与图片不同）：一段几十兆的视频转成 base64 会膨胀约三分之一，
 * 写进 localStorage 直接把配额撑爆、刷新反而丢数据。所以视频走 objectURL
 * （当前会话可见，配合宿主 resources 服务登记回收），并在 data 里记 resourceId。
 */
export function videoObjectUrl(blob: Blob): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return ''
  return URL.createObjectURL(blob)
}

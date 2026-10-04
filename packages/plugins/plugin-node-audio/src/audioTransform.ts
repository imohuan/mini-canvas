/**
 * audioTransform —— 音频的浏览器侧加工（解码取波形与时长 / 选文件 / 下载）。
 *
 * 归本包私有：这些操作不需要内核能力，只是 Web Audio 与 DOM 的薄封装。
 * 全部函数在**非浏览器环境（node 单测）里安全返回 null / false**，所以插件在无头环境
 * import 本模块不会炸 —— 这也是把这些副作用挡在纯逻辑之外的原因。
 *
 * 为什么解码一次就同时给波形和时长：两者来自同一次 decodeAudioData，
 * 分开各解一次等于把整段音频下载并解码两遍（用户强调"节点可能非常多，要高效"）。
 */
import { WAVEFORM_BUCKETS, bucketPeaks, normalizeToPercent } from './waveform'

/** 一次解码的产物：波形（1..100 的整数，长度恒定）与时长秒数（读不到给 0） */
export interface AudioInspection {
  peaks: number[]
  duration: number
}

/** Web Audio 构造函数（带 webkit 前缀兜底） */
type AudioContextCtor = new () => AudioContext

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

/**
 * 解码音频，拿到波形与时长。
 *
 * 多声道逐帧取**绝对值最大**再桶化（不是把声道平均）：左右反相的一段音乐平均后会变成静音，
 * 波形会凭空消失；取最大值才能如实反映"这一小段有多响"。
 *
 * @returns 失败（非浏览器 / 网络失败 / 格式不支持 / 解码抛错）返回 null，调用方用回落波形兜底
 */
export async function analyzeAudio(url: string, buckets = WAVEFORM_BUCKETS): Promise<AudioInspection | null> {
  if (typeof fetch !== 'function' || !url) return null
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  let ctx: AudioContext | null = null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    ctx = new Ctor()
    const buffer = await ctx.decodeAudioData(bytes)
    const frames = buffer.length
    const channels = buffer.numberOfChannels
    if (frames <= 0 || channels <= 0) return null
    const mono = new Float32Array(frames)
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < frames; i++) {
        const v = Math.abs(data[i])
        if (v > mono[i]) mono[i] = v
      }
    }
    return {
      peaks: normalizeToPercent(bucketPeaks(mono, buckets)),
      duration: Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : 0,
    }
  } catch {
    return null
  } finally {
    // 一定要关：AudioContext 会占用音频硬件，画布上音频节点多时不关会累积（浏览器有数量上限），
    // 关掉之后本节点也不需要它——波形已经算成纯数字了。
    try {
      await ctx?.close()
    } catch {
      /* 已经关了/环境不支持 close：忽略，不影响结果 */
    }
  }
}

/** 打开系统选音频框并等用户选完（仅浏览器；非浏览器/取消都返回 null） */
export function pickAudioFile(): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
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
 * 触发浏览器下载（非浏览器环境 no-op）。
 *
 * 只允许 blob: / data:audio / http(s) 这几种地址 —— 与视频节点同一道防线，
 * 免得嵌进来的脚本地址被当作下载地址执行。
 */
export function downloadAudio(url: string, fileName: string): boolean {
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
    (parsed.protocol === 'data:' && url.startsWith('data:audio/'))
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
 * File/Blob → objectURL。
 *
 * 音频刻意不转 dataURL（与图片不同）：一段几分钟的音频转成 base64 会膨胀约三分之一，
 * 写进 localStorage 直接撑爆配额、刷新反而丢数据。所以走 objectURL（当前会话可见，
 * 配合宿主 resources 服务登记回收），并在 data 里记 resourceId。
 */
export function audioObjectUrl(blob: Blob): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return ''
  return URL.createObjectURL(blob)
}


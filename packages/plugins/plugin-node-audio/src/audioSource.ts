import { PeakCache } from './peakCache'

export interface AudioSource {
  duration: number
  sampleRate: number
  peaks(startSec: number, endSec: number, buckets: number): Promise<number[]>
  dispose(): void
}
type Wav = { offset: number; channels: number; rate: number; bits: number; frames: number }

function parseWav(data: ArrayBuffer): Wav | null {
  const v = new DataView(data)
  if (v.byteLength < 12 || v.getUint32(0) !== 0x46464952 || v.getUint32(8) !== 0x45564157) return null
  let fmt = 0, channels = 0, rate = 0, bits = 0, offset = 0, length = 0
  for (let p = 12; p + 8 <= v.byteLength;) {
    const id = v.getUint32(p), size = v.getUint32(p + 4)
    if (id === 0x20746d66 && p + 24 <= v.byteLength) { fmt = v.getUint16(p + 8); channels = v.getUint16(p + 10); rate = v.getUint32(p + 12); bits = v.getUint16(p + 22) }
    if (id === 0x61746164) { offset = p + 8; length = size; break }
    p += 8 + size + (size & 1)
  }
  if (fmt !== 1 || !channels || !rate || ![8, 16, 24, 32].includes(bits) || !length) return null
  return { offset, channels, rate, bits, frames: Math.floor(length / (channels * bits / 8)) }
}

function wavSamples(data: ArrayBuffer, bits: number, channels: number, count: number): number[] {
  const v = new DataView(data), stride = channels * bits / 8, frames = Math.floor(data.byteLength / stride)
  const out = Array(count).fill(0)
  for (let b = 0; b < count; b++) for (let f = Math.floor(frames * b / count); f < Math.max(Math.floor(frames * b / count) + 1, Math.floor(frames * (b + 1) / count)) && f < frames; f++) for (let c = 0; c < channels; c++) {
    const p = (f * channels + c) * bits / 8
    const x = bits === 8 ? (v.getUint8(p) - 128) / 128 : bits === 16 ? v.getInt16(p, true) / 32768 : bits === 24 ? (v.getUint8(p) | v.getUint8(p + 1) << 8 | v.getInt8(p + 2) << 16) / 8388608 : v.getInt32(p, true) / 2147483648
    out[b] = Math.max(out[b], Math.abs(x))
  }
  // 返回**绝对振幅 0..1**，不做归一化 —— 归一化要等整个窗口的数据齐了一次性做，
  // 否则每块各自拉伸，安静段被拉满、响度关系全丢（实测"后面一片平"）。
  return out
}

/** WAV 按 Range 只取窗口；压缩格式整段解码一次，保留 AudioBuffer 数据但关闭硬件上下文。 */
export async function openAudioSource(url: string): Promise<AudioSource | null> {
  if (typeof fetch !== 'function' || typeof window === 'undefined' || !url) return null
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-65535' } })
    if (!response.ok) return null
    const info = parseWav(await response.arrayBuffer())
    if (info) {
      const duration = info.frames / info.rate, cache = new PeakCache(duration), frameBytes = info.channels * info.bits / 8
      const sample = async (a: number, b: number, n: number): Promise<number[]> => {
        const from = Math.max(0, Math.floor(a * info.rate)), to = Math.min(info.frames, Math.ceil(b * info.rate))
        const byteFrom = info.offset + from * frameBytes, byteTo = info.offset + to * frameBytes - 1
        const r = await fetch(url, { headers: { Range: 'bytes=' + byteFrom + '-' + byteTo } })
        return wavSamples(await r.arrayBuffer(), info.bits, info.channels, n)
      }
      return { duration, sampleRate: info.rate, peaks: (a, b, n) => cache.get(a, b, n, sample), dispose: () => cache.clear() }
    }
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    try {
      const r = await fetch(url)
      if (!r.ok) return null
      const buffer = await ctx.decodeAudioData(await r.arrayBuffer())
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
      const cache = new PeakCache(buffer.duration)
      // 返回**原始振幅 0..1**（不在此处归一化：归一化要等整个窗口的数据齐了一次性做，
      // 否则每块各自拉伸，安静段被拉满、响度关系全丢 —— 实测"后面一片平"就是这个）
      const sample = async (a: number, b: number, n: number): Promise<number[]> => Array.from({ length: n }, (_, j) => {
        const from = Math.max(0, Math.floor(a * buffer.sampleRate)), to = Math.min(buffer.length, Math.ceil(b * buffer.sampleRate))
        const lo = from + Math.floor((to - from) * j / n), hi = Math.max(lo + 1, from + Math.floor((to - from) * (j + 1) / n))
        let peak = 0
        for (let i = lo; i < hi; i++) for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i] ?? 0))
        return peak
      })
      return { duration: buffer.duration, sampleRate: buffer.sampleRate, peaks: (a, b, n) => cache.get(a, b, n, sample), dispose: () => cache.clear() }
    } finally { await ctx.close() }
  } catch { return null }
}

/**
 * mediaSize —— 从**字节**里读出图片 / 视频的像素宽高（纯函数，零依赖，Node 可单测）。
 *
 * 为什么后台需要它：AI 用 MCP 下的单，产物字节是后台自己抓回来的；节点上若没有 `imageWidth/Height`
 * （图片）或 `videoWidth/Height`（视频），前端那条「按图片比例调卡片尺寸」的逻辑就无从下手，
 * 卡片停在类型默认的 4:3 —— 于是 9:16 的竖图被塞成横的（用户实测）。
 * 前端本来靠 `<img>/<video>` 的 naturalWidth 量；后台没有 DOM，只能解析容器头拿尺寸。
 *
 * 覆盖生成产物最常见的几种：PNG / JPEG / GIF / WEBP（图片），MP4/MOV（视频，读 tkhd）。
 * 认不出就返回 null —— 调用方保持原样，绝不猜一个数字。
 */

export interface MediaSize {
  width: number
  height: number
}

/** 大端读 u16 / u32（带边界检查） */
function u16be(b: Uint8Array, o: number): number | null {
  if (o + 2 > b.length) return null
  return (b[o] << 8) | b[o + 1]
}
function u32be(b: Uint8Array, o: number): number | null {
  if (o + 4 > b.length) return null
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}
function u16le(b: Uint8Array, o: number): number | null {
  if (o + 2 > b.length) return null
  return b[o] | (b[o + 1] << 8)
}
function u24le(b: Uint8Array, o: number): number | null {
  if (o + 3 > b.length) return null
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
}
function ascii(b: Uint8Array, o: number, n: number): string {
  if (o + n > b.length) return ''
  let s = ''
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i])
  return s
}
const ok = (w: number, h: number): MediaSize | null => (w > 0 && h > 0 ? { width: w, height: h } : null)

/** PNG：签名后紧跟 IHDR（宽高在固定偏移 16 / 20） */
function pngSize(b: Uint8Array): MediaSize | null {
  if (!(b[0] === 0x89 && ascii(b, 1, 3) === 'PNG')) return null
  return ok(u32be(b, 16) ?? 0, u32be(b, 20) ?? 0)
}

/** JPEG：扫段找 SOFn（C0–CF，除 C4/C8/CC），宽高在该段 */
function jpegSize(b: Uint8Array): MediaSize | null {
  if (!(b[0] === 0xff && b[1] === 0xd8)) return null
  let o = 2
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) {
      o++ // 填充字节
      continue
    }
    const marker = b[o + 1]
    // 无负载的段
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2
      continue
    }
    const len = u16be(b, o + 2)
    if (len === null) return null
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSOF) {
      const h = u16be(b, o + 5)
      const w = u16be(b, o + 7)
      return w === null || h === null ? null : ok(w, h)
    }
    o += 2 + len
  }
  return null
}

/** GIF：头部就是宽高（小端） */
function gifSize(b: Uint8Array): MediaSize | null {
  const sig = ascii(b, 0, 6)
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null
  return ok(u16le(b, 6) ?? 0, u16le(b, 8) ?? 0)
}

/** WEBP：VP8X（扩展）/ VP8 （有损）/ VP8L（无损）三种各读各的 */
function webpSize(b: Uint8Array): MediaSize | null {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null
  const fourcc = ascii(b, 12, 4)
  if (fourcc === 'VP8X') return ok(((u24le(b, 24) ?? 0) & 0xffffff) + 1, ((u24le(b, 27) ?? 0) & 0xffffff) + 1)
  if (fourcc === 'VP8 ') {
    // 关键帧起始码 9D 01 2A 之后才是宽高（小端，14 位有效）
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null
    return ok((u16le(b, 26) ?? 0) & 0x3fff, (u16le(b, 28) ?? 0) & 0x3fff)
  }
  if (fourcc === 'VP8L') {
    // 0x2F 签名后：14 位宽-1、14 位高-1（小端位流）
    if (b[20] !== 0x2f) return null
    const bits = (u32le(b, 21) ?? 0) >>> 0
    return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  return null
}
function u32le(b: Uint8Array, o: number): number | null {
  if (o + 4 > b.length) return null
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

/** 读图片尺寸（认不出返回 null） */
export function imageSizeFromBytes(bytes: Uint8Array): MediaSize | null {
  return pngSize(bytes) ?? jpegSize(bytes) ?? gifSize(bytes) ?? webpSize(bytes)
}

/** 遍历 MP4 盒子树，找第一个 `tkhd` 的宽高 */
function findTkhd(b: Uint8Array, start: number, end: number, depth: number): MediaSize | null {
  if (depth > 6) return null
  let o = start
  while (o + 8 <= end) {
    const size = u32be(b, o)
    if (size === null || size < 8) return null
    const type = ascii(b, o + 4, 4)
    const boxEnd = Math.min(o + size, end)
    if (type === 'tkhd') {
      const version = b[o + 8]
      // version 0：宽高在内容起始 + 76；version 1：+ 88（都是 16.16 定点）
      const wo = o + 8 + (version === 1 ? 88 : 76)
      const w = u32be(b, wo)
      const h = u32be(b, wo + 4)
      if (w === null || h === null) return null
      return ok(w >>> 16, h >>> 16)
    }
    if (type === 'moov' || type === 'trak' || type === 'mdia') {
      const inner = findTkhd(b, o + 8, boxEnd, depth + 1)
      if (inner) return inner
    }
    o = boxEnd
  }
  return null
}

/** 读视频尺寸（MP4/MOV 的 tkhd；认不出返回 null） */
export function videoSizeFromBytes(bytes: Uint8Array): MediaSize | null {
  // ftyp 开头才是 ISO BMFF（mp4/mov），否则别乱解析
  if (ascii(bytes, 4, 4) !== 'ftyp') return null
  return findTkhd(bytes, 0, bytes.length, 0)
}

/**
 * 读 MP4 系列容器的时长（毫秒）：读 moov 下 mvhd 的 timescale 与 duration。
 * version 0 是 u32 duration，version 1 是 u64；认不出返回 null，绝不猜。
 */
export function videoDurationFromBytes(bytes: Uint8Array): number | null {
  const found = findMvhd(bytes, 0, bytes.length, 0)
  if (!found) return null
  const { timescale, duration } = found
  if (!(timescale > 0) || !(duration > 0)) return null
  return Math.round((duration / timescale) * 1000)
}

/** 遍历盒子树找第一个 mvhd（返回 timescale / duration） */
function findMvhd(
  b: Uint8Array,
  start: number,
  end: number,
  depth: number,
): { timescale: number; duration: number } | null {
  if (depth > 6) return null
  let o = start
  while (o + 8 <= end) {
    const size = u32be(b, o)
    if (size === null || size < 8) return null
    const type = ascii(b, o + 4, 4)
    const boxEnd = Math.min(o + size, end)
    if (type === 'mvhd') {
      const version = b[o + 8]
      const base = o + 8
      if (version === 1) {
        // version 1：creation/modification 各 8 字节，timescale 在 +20，duration 在 +24（u64）
        const timescale = u32be(b, base + 20)
        const hi = u32be(b, base + 24)
        const lo = u32be(b, base + 28)
        if (timescale === null || hi === null || lo === null) return null
        return { timescale, duration: hi * 2 ** 32 + lo }
      }
      // version 0：creation/modification 各 4 字节，timescale 在 +12，duration 在 +16（u32）
      const timescale = u32be(b, base + 12)
      const duration = u32be(b, base + 16)
      if (timescale === null || duration === null) return null
      return { timescale, duration }
    }
    if (type === 'moov') {
      const inner = findMvhd(b, o + 8, boxEnd, depth + 1)
      if (inner) return inner
    }
    o = boxEnd
  }
  return null
}

/**
 * 读音频时长（毫秒）。
 *
 * 分三路：
 * - MP4 容器里的音频（m4a）→ 与视频同一个 mvhd；
 * - WAV → 头里的 byteRate 与 data 长度；
 * - MP3 → 帧头比特率 + 文件长度估算（VBR 会有偏差，属已知近似）。
 * 认不出（ogg / flac / opus 等）返回 null，由前端 audio 的 loadedmetadata 兜底。
 */
export function audioDurationFromBytes(bytes: Uint8Array, fileName?: string): number | null {
  const ext = (fileName ?? '').toLowerCase().split('?')[0].split('.').pop() ?? ''
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const d = videoDurationFromBytes(bytes)
    if (d !== null) return d
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return wavDuration(bytes)
  if (ext === 'mp3' || ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return mp3Duration(bytes)
  }
  return null
}

/** WAV：fmt 段给 byteRate，data 段给字节数 → 时长 */
function wavDuration(b: Uint8Array): number | null {
  let o = 12
  let byteRate = 0
  let dataBytes = 0
  while (o + 8 <= b.length) {
    const id = ascii(b, o, 4)
    const size = u32le(b, o + 4)
    if (size === null) return null
    if (id === 'fmt ') byteRate = u32le(b, o + 16) ?? 0
    else if (id === 'data') {
      dataBytes = Math.min(size, b.length - (o + 8))
      break
    }
    o += 8 + size + (size % 2)
  }
  if (!(byteRate > 0) || !(dataBytes > 0)) return null
  return Math.round((dataBytes / byteRate) * 1000)
}

/** MP3：跳过 ID3v2，按第一帧比特率与总长估算 */
function mp3Duration(b: Uint8Array): number | null {
  let o = 0
  if (ascii(b, 0, 3) === 'ID3' && b.length > 10) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
    o = 10 + size
  }
  while (o + 4 <= b.length) {
    if (b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0) {
      const bitrate = parseMp3Bitrate(b, o)
      if (bitrate) {
        const audioBytes = b.length - o
        return Math.round((audioBytes * 8 * 1000) / bitrate)
      }
    }
    o++
  }
  return null
}

/** MPEG-1/2/2.5 Layer III 帧头 → 比特率（bps） */
function parseMp3Bitrate(b: Uint8Array, o: number): number | null {
  const versionBits = (b[o + 1] >> 3) & 0x3
  const layerBits = (b[o + 1] >> 1) & 0x3
  const bitrateIdx = (b[o + 2] >> 4) & 0xf
  if (layerBits !== 0x1) return null
  const table: Record<number, number[]> = {
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    0: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  }
  const kbps = table[versionBits]?.[bitrateIdx] ?? 0
  return kbps > 0 ? kbps * 1000 : null
}

/** 产物媒体元数据（历史卡片用） */
export interface MediaProbe {
  width?: number
  height?: number
  durationMs?: number
  bytes?: number
}

/**
 * 从产物字节量出历史卡片需要的元数据。
 *
 * 为什么要一次性量全：卡片要画"真实比例"和"时长/大小"角标；前端等视频 metadata
 * 才拿到时长，会先闪一个 16:9 的占位，之后尺寸跳一下（用户实测的卡顿感）。
 * 认不出就不给该字段 —— 宁可少显示，不要瞎猜。
 */
export function probeMedia(bytes: Uint8Array, fileName: string): MediaProbe {
  const kind = mediaKindFromName(fileName)
  const probe: MediaProbe = { bytes: bytes.length }
  if (kind === 'image') {
    const s = imageSizeFromBytes(bytes)
    if (s) {
      probe.width = s.width
      probe.height = s.height
    }
    return probe
  }
  if (kind === 'video') {
    const s = videoSizeFromBytes(bytes)
    if (s) {
      probe.width = s.width
      probe.height = s.height
    }
    const d = videoDurationFromBytes(bytes)
    if (d !== null) probe.durationMs = d
    return probe
  }
  if (kind === 'audio') {
    const d = audioDurationFromBytes(bytes, fileName)
    if (d !== null) probe.durationMs = d
    return probe
  }
  // 后缀认不出：图 / 视频都试一下（产物常见就是这两类）
  const s = imageSizeFromBytes(bytes) ?? videoSizeFromBytes(bytes)
  if (s) {
    probe.width = s.width
    probe.height = s.height
  }
  return probe
}

/** 按文件名后缀判断产物是图还是视频（用于决定读哪种尺寸、写哪对字段） */
export function mediaKindFromName(name: string): 'image' | 'video' | 'audio' | 'unknown' {
  const ext = name.toLowerCase().split('?')[0].split('.').pop() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  return 'unknown'
}

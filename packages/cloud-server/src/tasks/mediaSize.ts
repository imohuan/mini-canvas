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

/** 按文件名后缀判断产物是图还是视频（用于决定读哪种尺寸、写哪对字段） */
export function mediaKindFromName(name: string): 'image' | 'video' | 'audio' | 'unknown' {
  const ext = name.toLowerCase().split('?')[0].split('.').pop() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  return 'unknown'
}

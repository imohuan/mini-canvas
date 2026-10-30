/**
 * videoThumbKey —— 视频帧图的**引用名规则**（纯逻辑：零 Vue / 零 DOM / 零 Node）。
 *
 * 与图片插件那份是各自独立的两份实现（两个插件不互相依赖，也不共享中间包）——
 * 与 thumbTier / videoThumbTier 同一处理。规则很短，重复的代价小于"插件之间互相依赖"。
 *
 * 名字形状：`vid-<源标识>-<参数>`（例如 `vid-c798226d6387af67-t2-t0x0`），
 * 参数里带上**档位与取帧时刻**：同一段视频在不同时刻定格，是两张不同的图。
 */

/**
 * 允许的字符集：**只留字母数字与 _ -**（不放点号）。

 * 服务端对"固定名"（槽位）的校验是 `^[A-Za-z0-9_-]{1,64}$` —— 点号会让整个请求 400。
 * 2026-10-15 实测踩到：名字里带 `t1.00`（两位小数的时刻）时每个请求都被拒，
 * 表现是"帧图怎么都不出来、控制台一片 400"，而本地模式看不出问题（IndexedDB 键随便起）。
 */
const UNSAFE = /[^A-Za-z0-9_-]/g

/**
 * 名字总长上限。
 *
 * 云端派生资源走服务的「槽位」上传口，槽位 id 上限是 **64**（见 cloud-server 的
 * isSafeSlotId）。名字超过 64 时本地 IndexedDB 还能存，云端却会被拒 —— 表现是
 * 「每次打开都要重新生成、永远不命中」。所以这里直接按云端上限收口，
 * 超长源名在 makeFrameRef 里改用短哈希，不再留下"只在本地能用"的名字。
 */
export const MAX_REF_LENGTH = 64

/**
 * 源标识：从源地址取一个短而稳的指纹（文件名优先，取不到再用哈希）。
 * **必须确定性** —— 否则同一段视频每次算出不同名字，命中率等于零。
 */
export function sourceKeyOf(src: string): string {
  const cleaned = (typeof src === 'string' ? src : '').split('?')[0].split('#')[0]
  const tail = cleaned.split('/').pop() ?? ''
  const plain = tail.replace(/[^A-Za-z0-9_.-]/g, '')
  if (plain && plain.length <= 64) return plain
  return hash32(cleaned || 'empty')
}

/** FNV-1a 32 位（确定性、够短；只作标识，不做安全用途） */
export function hash32(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 拼一个引用名；参数缺失或超长 → undefined（调用方按"不缓存、直接生成"处理） */
export function makeFrameRef(prefix: string, src: string, param: string): string | undefined {
  const srcKey = sourceKeyOf(src)
  const cleanParam = String(param ?? '').replace(UNSAFE, '')
  if (!srcKey || !cleanParam) return undefined
  const name = (prefix + '-' + srcKey + '-' + cleanParam).replace(UNSAFE, '-')
  if (name.length <= MAX_REF_LENGTH) return name
  // 源名太长（长文件名 / 外链）→ 用 8 位确定性哈希代替源名。
  // 仍然是「同一源同名」：哈希只取决于源地址，不随会话变化。
  const short = (prefix + '-' + hash32(srcKey) + '-' + cleanParam).replace(UNSAFE, '-')
  return short.length <= MAX_REF_LENGTH ? short : undefined
}

/**
 * 定格帧的参数串：**档位 + 取帧时刻**。
 *
 * 时刻取两位小数就够（帧精度）；它进名字，所以"停下来看第 5 秒"与"第 7 秒"
 * 是两张不同的图，各自能命中缓存、互不覆盖。
 */
export function frameRefParam(tier: number, at: number): string {
  const safeAt = Number.isFinite(at) && at > 0 ? at : 0
  // 两位小数的时刻改写成整数毫秒段（`t1.25` → `t125`）：避开点号，名字仍在字符集内
  return 't' + tier + '-a' + Math.round(safeAt * 100)
}

/** 取景身份：同样影响帧图内容的源画面尺寸与裁剪框 */
export interface FrameRefIdentity {
  /** 生成时用来缩放的源画面尺寸（视频像素）；拿不到按 0 记 */
  frameWidth?: number
  frameHeight?: number
  /** 节点上的裁剪框；null / undefined = 整幅 */
  cropRect?: { x: number; y: number; width: number; height: number } | null
}

/** 帧图生成算法版本：取景 / 缩放规则一变就 +1，旧名字自动作废 */
export const FRAME_REF_VERSION = 2

/**
 * 帧图的参数串：**档位 + 取帧时刻 + 目标尺寸 + 质量 + 取景身份**。
 *
 * 尺寸必须进名字：它是"这份缓存的身份"里最容易漏、后果又最明显的一项 ——
 * 2026-10-15 用户实测：「我这边在配置中重新设置了最大宽高……它依然使用的是之前的图片」，
 * 就是因为名字只带档位与时刻，改尺寸后名字不变、一直命中旧图。
 *
 * 2026-10-30 又补两项（必须一起进身份）：
 * - **裁剪框**：同一时刻、同一尺寸，裁 A 区域与裁 B 区域是两张不同的图；
 * - **源画面尺寸**：缩放按它算，数据里的宽高变了也必须换一张。
 * 两项拼成短哈希附在末尾，既保证身份完整，又让名字保持在云端槽位的 64 字上限内。
 * 旧版本生成的名字没有 `v2`，于是历史上尺寸不对、取景不对的坏图不会被继续命中。
 */
export function frameRefParamFor(
  tier: number,
  at: number,
  width: number,
  height: number,
  quality: number,
  identity: FrameRefIdentity = {},
): string {
  const safeAt = Number.isFinite(at) && at > 0 ? at : 0
  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  const q = Number.isFinite(quality) && quality > 0 ? Math.round(quality * 100) : 0
  const fw = Number.isFinite(identity.frameWidth) && (identity.frameWidth ?? 0) > 0 ? Math.round(identity.frameWidth!) : 0
  const fh = Number.isFinite(identity.frameHeight) && (identity.frameHeight ?? 0) > 0 ? Math.round(identity.frameHeight!) : 0
  const c = identity.cropRect
  const crop =
    c && [c.x, c.y, c.width, c.height].every((v) => Number.isFinite(v)) && c.width > 0 && c.height > 0
      ? [c.x, c.y, c.width, c.height].map((v) => Math.round(v)).join('x')
      : 'full'
  // 取景身份压成 8 位哈希：名字可读部分仍保留档位/时刻/尺寸，排查时一眼能看懂；
  // 源尺寸与裁框则通过哈希参与身份，避免名字超过云端槽位上限。
  const digest = hash32([FRAME_REF_VERSION, fw, fh, crop].join('|'))
  // 时刻用整数毫秒段（避开点号：服务端槽位名只收 [A-Za-z0-9_-]）
  return 'v' + FRAME_REF_VERSION + 't' + tier + 'a' + Math.round(safeAt * 100) + 'w' + w + 'h' + h + 'q' + q + 'i' + digest
}


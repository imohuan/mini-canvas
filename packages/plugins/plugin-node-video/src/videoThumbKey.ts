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

/** 名字总长上限（超长就退化成"自命名"，调用方按未命中处理） */
export const MAX_REF_LENGTH = 120

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
  return name.length <= MAX_REF_LENGTH ? name : undefined
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

/**
 * 定格帧的参数串：**档位 + 取帧时刻 + 目标尺寸 + 质量**。
 *
 * 尺寸必须进名字：它是"这份缓存的身份"里最容易漏、后果又最明显的一项 ——
 * 2026-10-15 用户实测：「我这边在配置中重新设置了最大宽高……它依然使用的是之前的图片」，
 * 就是因为名字只带档位与时刻，改尺寸后名字不变、一直命中旧图。
 */
export function frameRefParamFor(
  tier: number,
  at: number,
  width: number,
  height: number,
  quality: number,
): string {
  const safeAt = Number.isFinite(at) && at > 0 ? at : 0
  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  const q = Number.isFinite(quality) && quality > 0 ? Math.round(quality * 100) : 0
  // 时刻用整数毫秒段（避开点号：服务端槽位名只收 [A-Za-z0-9_-]）
  return 't' + tier + '-a' + Math.round(safeAt * 100) + 'w' + w + 'h' + h + 'q' + q
}


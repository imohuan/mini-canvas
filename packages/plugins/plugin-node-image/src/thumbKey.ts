/**
 * thumbKey —— 缩略图 / 帧图的**引用名规则**（纯逻辑：零 Vue / 零 DOM / 零 Node）。
 *
 * 为什么要"名字可推算"：生成一张缩略图要解码原图，不便宜。名字能算出来，
 * 就能**先问一句"这个名字存在吗"**（`resources.resolve(ref)`），存在直接复用。
 *
 * ## 名字里必须编进**所有影响内容的参数**（这条踩过坑）
 * 名字是"这份缓存的身份"。凡是会改变产出的输入，都必须进名字 ——
 * 少编一个，用户改了那个设置之后就会**一直命中旧图**。
 *
 * 2026-10-15 用户实测报的：「我在配置中重新设置了最大宽高……它依然使用的是之前的图片」——
 * 当时的名字只有 `t2q80`（档位 + 质量），**没带尺寸**，所以把第二档从 512 改成 1024
 * 名字还是同一个、命中那张 512 的旧图。
 * 现在名字是 `t2w512h512q80`：档位、**目标宽高**、质量，一个都不少。
 */

/** 允许的字符集：资源名要能进 URL 路径与本地存储键，安全起见收窄到字母数字与 _ - */
const UNSAFE = /[^A-Za-z0-9_-]/g

/** 名字总长上限（超长就退化成"自命名"，调用方按未命中处理） */
export const MAX_REF_LENGTH = 120

/**
 * 源标识：从源地址里取一个短而稳的指纹。
 *
 * 优先取文件名（画布资源名本身就是内容哈希，天然稳定且短）；
 * 取不到（外链、dataURL、本地 res- 引用）就用 FNV-1a 的 16 进制 ——
 * **必须是确定性的**，否则同一个源每次算出不同名字，命中率就等于零。
 */
export function sourceKeyOf(src: string): string {
  const cleaned = (typeof src === 'string' ? src : '').split('?')[0].split('#')[0]
  const tail = cleaned.split('/').pop() ?? ''
  const plain = tail.replace(/[^A-Za-z0-9_.-]/g, '')
  if (plain && plain.length <= 64) return plain
  return hash32(cleaned || 'empty')
}

/** FNV-1a 32 位（确定性、够短；只用来做"同一源同名"的标识，不做安全用途） */
export function hash32(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 一档缩略图的参数串：**档位 + 目标尺寸 + 质量**。
 *
 * 三者缺一不可（见文件头那段"改了宽高还是旧图"的教训）。尺寸为 0/非法时按 0 记，
 * 调用方本来就只在尺寸有效时才生成。
 */
export function thumbRefParam(tier: number, width: number, height: number, quality: number): string {
  const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 0
  const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 0
  const q = Number.isFinite(quality) && quality > 0 ? Math.round(quality * 100) : 0
  return 't' + tier + 'w' + w + 'h' + h + 'q' + q
}

/**
 * 拼一个引用名。
 * @returns 名字；参数缺失或总长超限 → undefined（调用方按"不缓存、直接生成"处理）
 */
export function makeThumbRef(prefix: string, src: string, param: string): string | undefined {
  const srcKey = sourceKeyOf(src)
  const cleanParam = String(param ?? '').replace(UNSAFE, '')
  if (!srcKey || !cleanParam) return undefined
  const name = (prefix + '-' + srcKey + '-' + cleanParam).replace(UNSAFE, '-')
  return name.length <= MAX_REF_LENGTH ? name : undefined
}


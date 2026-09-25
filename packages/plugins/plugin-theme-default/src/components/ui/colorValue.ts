/**
 * colorValue —— 颜色字符串的解析 / 规范化（取色控件与各颜色消费方的共同地基；纯逻辑、零 Vue、零 DOM）。
 *
 * 为什么需要它：用户要求"色块要能看见透明度、也能调透明度"。承载透明度最省事的载体是
 * **8 位 hex（#rrggbbaa）** —— CSS / SVG / canvas 2d 都原生认它（实测 `ctx.fillStyle = '#3b82f680'`
 * 出像素 (59,130,246,128)、SVG 描边与 CSS 颜色也都吃这个写法），于是：
 *   - 老数据、老消费者（只认 #rgb/#rrggbb 的正则）不受影响：不透明时我们**仍旧写 6 位**；
 *   - 只有用户真的把透明度拉下去，值才变成 8 位，消费方按需读 `colorAlpha`。
 *
 * 三条不变量（测试逐条钉死）：
 *   1. 合法写法全认：#rgb / #rgba / #rrggbb / #rrggbbaa，大小写不敏感；
 *   2. 规范化只有两种输出形态 —— a >= 1 回落 **6 位**，a < 1 才写 **8 位**；
 *   3. 脏值绝不写坏数据：回落到给定默认色，默认色本身也脏则回到 #000000。
 *
 * 形态选择：`#rgb`/`#rgba` 这类缩写只在**入参**接受，输出一律展开成 6/8 位 ——
 * 缩写对"读回一个确定的颜色"没有好处，反而让下游正则要处理两种长度。
 */

/** 拆开的颜色四元组：r/g/b 为 0..255，a 为 0..1 */
export interface RgbaChannels {
  r: number
  g: number
  b: number
  a: number
}

/**
 * 合法 hex 颜色（#rgb / #rgba / #rrggbb / #rrggbbaa）。
 * 刻意不吃 `rgb()`/`rgba()`/`hsl()` 与颜色关键字：本仓颜色值一律走 hex（见 kernel configSchema
 * 的 color 校验），多收几种写法只会让"存进去的到底是什么形态"变得不确定。
 */
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** 是不是一个合法的 hex 颜色字符串 */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value)
}

/** 单通道夹到 0..255 并取整（容忍小数与越界输入） */
function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(255, Math.max(0, Math.round(n)))
}

/** 透明度夹到 0..1（NaN → 0，与"写不出坏值"一致） */
function clampAlpha(a: number): number {
  if (!Number.isFinite(a)) return 0
  return Math.min(1, Math.max(0, a))
}

/** 一个字节 → 两位小写十六进制 */
function toHexByte(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0')
}

/**
 * 解析 hex 颜色。非法值返回 undefined（调用方自行回落，本模块不抛异常 ——
 * 颜色来自用户输入/存档，任何一处脏值都不该把整条渲染链打断）。
 */
export function parseHexColor(value: unknown): RgbaChannels | undefined {
  if (!isHexColor(value)) return undefined
  let body = value.slice(1)
  // 缩写展开：每位复制一遍（#abc → #aabbcc、#f008 → #ff0088）
  if (body.length === 3 || body.length === 4) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const r = parseInt(body.slice(0, 2), 16)
  const g = parseInt(body.slice(2, 4), 16)
  const b = parseInt(body.slice(4, 6), 16)
  const a = body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

/**
 * 四元组 → 规范 hex 字符串。
 * 不透明（a >= 1）写 6 位，半透明写 8 位 —— 这条是"老存档形态不变"的关键。
 */
export function formatHexColor(channels: RgbaChannels): string {
  const base = '#' + toHexByte(channels.r) + toHexByte(channels.g) + toHexByte(channels.b)
  const a = clampAlpha(channels.a)
  if (a >= 1) return base
  return base + toHexByte(a * 255)
}

/**
 * 把任意颜色输入收敛成规范写法；脏值回落到 `fallback`（fallback 也脏则 #000000）。
 * 所有"从配置/存档读颜色"的地方都该过这一道，拿到手的就是确定的形态。
 */
export function normalizeHexColor(value: unknown, fallback: string): string {
  const parsed = parseHexColor(value)
  if (parsed) return formatHexColor(parsed)
  const fb = parseHexColor(fallback)
  // 最后兜底 #000000：这是"非法输入"的确定化默认，不是主题色（调用方都自带 fallback）
  return fb ? formatHexColor(fb) : '#000000' // 主题色白名单: 颜色解析函数的最终兜底常量，非主题外观
}

/**
 * 读一个颜色的透明度（0..1）。
 * 读不出来时返回 1（不透明）—— 对渲染来说"当成实色"比"当成隐形"安全得多。
 */
export function colorAlpha(value: unknown): number {
  const parsed = parseHexColor(value)
  return parsed ? parsed.a : 1
}

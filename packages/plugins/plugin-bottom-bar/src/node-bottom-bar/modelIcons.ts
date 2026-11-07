/**
 * 底栏「模型」下拉的图标（用户 2026-11-06：trigger 和 content 都要有模型图标）。
 *
 * 用户口径（2026-11-07）：图标只有一份，放 Agent 插件里；底栏按服务名取用。
 * 所以这里不再手画品牌图形：真图标来自 `modelIcons` 服务的 svgOfName()，
 * 本文件只保留「认家族」和「认不出时的兜底」。
 *
 * 兜底图形用 currentColor 画，颜色由 CSS 的 `data-tone` 决定；
 * 品牌图标是内容资产，颜色写在 SVG 里，不跟主题变。
 */

/** 图标家族：CSS 用 `[data-tone='…']` 上色 */
export type ModelTone =
  | 'seedream'
  | 'seedance'
  | 'doubao'
  | 'openai'
  | 'dola'
  | 'volcengine'
  | 'kling'
  | 'sora'
  | 'veo'
  | 'runway'
  | 'pika'
  | 'hailuo'
  | 'qwen'
  | 'midjourney'
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  /** provider 自带图标（SVG 或 Base64 图片）；颜色由图片本身决定 */
  | 'custom'

export interface ModelIcon {
  tone: ModelTone
  /** 完整 `<svg>` 字符串（v-html 用） */
  svg: string
}

/** 图形主体（不带 `fill/stroke`，由 wrapSvg 统一加） */
// custom 不在这张表里：它来自 provider 的 icon，不是按家族画出来的
const BODY: Record<Exclude<ModelTone, 'custom'>, string> = {
  // 豆包 Seedream：照片 + 右上角星芒（「图片生成」）
  seedream:
    '<rect x="3" y="4.5" width="15" height="15" rx="3"/>'
    + '<path d="m4 16 3.4-3.4 2.6 2.6 2.4-2.4L18 18"/>'
    + '<circle cx="8" cy="9.2" r="1.4"/>'
    + '<path d="M19.5 2.2v3.2M18 3.8h3"/>'
    + '<path d="M21.5 6.6v1.8M20.6 7.5h1.8"/>',
  // 豆包 Seedream 之外的文案/图片模型的伙伴图：镜头/画框 + 星芒
  doubao:
    '<path d="M12 3.2c1.5 2.1 3.2 2.9 5.5 3.1-1.7 1.5-2.4 3.2-2.4 5.6 0 2.4.7 4.1 2.4 5.6-2.3.2-4 1-5.5 3.1-1.5-2.1-3.2-2.9-5.5-3.1 1.7-1.5 2.4-3.2 2.4-5.6 0-2.4-.7-4.1-2.4-5.6 2.3-.2 4-1 5.5-3.1z"/>'
    + '<circle cx="12" cy="11.9" r="2"/>',
  // Seedance：画面 + 播放键 + 两侧动感线（视频生成）
  seedance:
    '<rect x="2.6" y="5.4" width="18.8" height="13.2" rx="3"/>'
    + '<path d="M10 9.4v5.2l4.6-2.6z" fill="currentColor" stroke="none"/>'
    + '<path d="M5.4 8.8v6.4M18.6 8.8v6.4" opacity=".55"/>',
  // ChatGPT / GPT Image：OpenAI 结（MIT，来源同 plugin-agent 的 modelBrandIcons）
  openai:
    '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0z"/>',
  // Dola：圆形里的 D
  dola:
    '<circle cx="12" cy="12" r="8.4"/>'
    + '<path d="M9.2 7.8h3.4a4.2 4.2 0 0 1 0 8.4H9.2z"/>',
  // 火山引擎：六边形 + 方芯
  volcengine:
    '<path d="M12 2.8 19.6 7.6v8.8L12 21.2 4.4 16.4V7.6z"/>'
    + '<rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1.2"/>',
  // 可灵 Kling：菱形 + 星芒
  kling:
    '<path d="M12 2.6 21.4 12 12 21.4 2.6 12z"/>'
    + '<path d="M12 7.4v9.2M7.4 12h9.2" opacity=".6"/>',
  // Sora：双环（天空/轨道）
  sora:
    '<circle cx="12" cy="12" r="8.6"/>'
    + '<path d="M4.4 9.6c4.6 2.2 10.6 2.2 15.2 0M4.4 14.4c4.6-2.2 10.6-2.2 15.2 0"/>'
    + '<circle cx="12" cy="12" r="2.1"/>',
  // Veo：镜头 + 播放
  veo:
    '<rect x="3" y="5" width="12.4" height="14" rx="2.6"/>'
    + '<path d="M15.4 9.4 21 6.6v10.8l-5.6-2.8z"/>'
    + '<path d="m7.2 9.4 3.4 2.6-3.4 2.6z" fill="currentColor" stroke="none"/>',
  // Runway：跑道 + 箭头
  runway:
    '<path d="M6.6 3.6h10.8M4.2 8.4h15.6M2.8 13.2h18.4M5.4 18h13.2"/>'
    + '<path d="M9 20.4 12 17l3 3.4" opacity=".6"/>',
  // Pika：闪电（快）
  pika: '<path d="M13.6 2.6 5.4 13.6h5.4l-.8 7.8 8.4-11.2h-5.6z"/>',
  // 海螺 Hailuo：螺旋
  hailuo:
    '<path d="M12 21a9 9 0 1 0-9-9c0 4.4 3 7 6.4 7 2.8 0 4.6-1.8 4.6-4.2 0-2-1.4-3.4-3.2-3.4-1.5 0-2.6 1-2.6 2.4 0 1.1.8 1.9 1.8 1.9"/>',
  // 通义 / 万相：三角结
  qwen:
    '<path d="M12 2.6 21.2 8v8L12 21.4 2.8 16V8z"/>'
    + '<path d="M12 7.4 16.6 10v4L12 16.6 7.4 14v-4z" opacity=".55"/>',
  // Midjourney：帆船
  midjourney:
    '<path d="M12 2.8v12.6M12 5.4c3.6 1.8 5.4 4.6 5.4 8H12z"/>'
    + '<path d="M4.4 16.6h15.2l-2.2 3.6H6.6z"/>',
  // 兜底：图片 / 视频 / 音频 / 文本（与节点类型图标同款）
  image:
    '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/>'
    + '<circle cx="8.6" cy="9.6" r="1.6"/>'
    + '<path d="m21 15.4-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 19.4"/>',
  video:
    '<rect x="3" y="5.4" width="13" height="13.2" rx="2.4"/>'
    + '<path d="m16 9.6 5-2.8v10.4l-5-2.8z"/>',
  audio:
    '<path d="M3 10v4M7 6.6v10.8M11 3.6v16.8M15 7.4v9.2M19 10v4"/>',
  text:
    '<path d="M4 7V4h16v3M12 4v16M8 20h8"/>',
}

function wrapSvg(body: string): string {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'
}

/** 某个家族 → 图标（对外只暴露这一个取图入口） */
export function modelIcon(tone: ModelTone): ModelIcon {
  // custom 只能经 customModelIcon 构造；这里兜一层，避免拿到空图形
  if (tone === 'custom') return { tone, svg: wrapSvg(BODY.text) }
  return { tone, svg: wrapSvg(BODY[tone]) }
}

/** 模型名 / 动作 id → 图标家族（顺序有意义：seedance 先于 seedream，tts 先于豆包生图） */
export function detectModelTone(name: string, fallbackKind?: string): ModelTone {
  const s = String(name ?? '').toLowerCase()
  if (/seedance|即梦视频|豆包.*视频|视频.*seedance/.test(s)) return 'seedance'
  if (/seedream|即梦|豆包.*(生图|图像|图片)/.test(s)) return 'seedream'
  if (/tts|语音|音色|朗读|配音/.test(s)) return 'audio'
  if (/chatgpt|openai|gpt[- ]?image|apimart/.test(s)) return 'openai'
  if (/dola/.test(s)) return 'dola'
  if (/volc|火山/.test(s)) return 'volcengine'
  if (/kling|可灵/.test(s)) return 'kling'
  if (/sora/.test(s)) return 'sora'
  if (/(^|[^a-z])veo([^a-z]|$)/.test(s)) return 'veo'
  if (/runway/.test(s)) return 'runway'
  if (/pika/.test(s)) return 'pika'
  if (/hailuo|海螺/.test(s)) return 'hailuo'
  if (/qwen|通义|万相|wan2|wanx/.test(s)) return 'qwen'
  if (/midjourney|mj/.test(s)) return 'midjourney'
  if (/doubao|豆包/.test(s)) return 'doubao'
  if (/audio|音频|音乐|music/.test(s)) return 'audio'
  const kind = String(fallbackKind ?? '')
  if (kind === 'image') return 'image'
  if (kind === 'video') return 'video'
  if (kind === 'audio') return 'audio'
  return 'text'
}

/** 动作下拉的一项 → 图标（名字优先，认不出再看节点类型） */
export function modelIconOf(name: string, nodeType?: string): ModelIcon {
  return modelIcon(detectModelTone(name, nodeType))
}

/**
 * provider 自带图标：SVG 字符串，或 `data:image/…;base64,…`。
 *
 * 为什么先校验再用：这段字符串最终走 `v-html`，来源是「丢进 providers 目录的文件」。
 * 只放行两种确定安全的形态，认不出就返回 undefined，让调用方回落按名字猜的图标 ——
 * 宁可显示通用图标，也不要让一段带脚本的字符串进 DOM。
 *
 * SVG 里的 `on*=` / `<script>` / `<foreignObject>` / `javascript:` 一律拒绝；
 * Base64 图片用 `<img>` 承载，浏览器按图片解码，不会执行里面的脚本。
 */
export function customModelIcon(raw: unknown): ModelIcon | undefined {
  if (typeof raw !== 'string') return undefined
  let s = raw.trim()
  if (!s) return undefined

  // 允许带 XML 声明；真正的图形从第一个 <svg 开始
  const svgAt = s.search(/<svg[\s>]/i)
  if (svgAt > 0) s = s.slice(svgAt)

  if (/^<svg[\s>]/i.test(s)) {
    if (/<script|<foreignObject|javascript:|\son[a-z]+\s*=/i.test(s)) return undefined
    // 没有 viewBox 也没有宽高，换到 14×14 的格子里会按原始像素乱放
    if (!/viewBox\s*=|width\s*=/i.test(s)) return undefined
    return { tone: 'custom', svg: s }
  }

  const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(s)
  if (!m) return undefined
  const mime = 'image/' + m[1].toLowerCase()
  return {
    tone: 'custom',
    svg: '<img src="data:' + mime + ';base64,' + m[2].replace(/\s+/g, '') + '" alt="" draggable="false">',
  }
}

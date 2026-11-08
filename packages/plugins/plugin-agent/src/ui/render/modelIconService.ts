/**
 * modelIconService —— 平台图标的**唯一来源**，由 Agent 插件提供给其它插件。
 *
 * 为什么放在 Agent 里：模型清单、平台分组、图标本来就是同一份知识。
 * 底栏只列生成动作，不需要再维护第二套「模型名 → 图形」的手绘映射
 *（那套映射 2026-11-07 已经证明会漂移：Seedream 与 Seedance 被画成同一类通用图形）。
 *
 * 用法（消费方）：
 * ```ts
 * const icons = ctx.tryGet<ModelIconService>('modelIcons')
 * icons?.svgOfModel(modelId, provider)   // 对话模型：按模型 ID 认平台
 * icons?.svgOfName('豆包 Seedance 2.0 Fast') // 底栏动作：按显示名认
 * ```
 *
 * 不做成 `registryOf('ui')` 组件：这里只要字符串，v-html 直接用；
 * 主题热替换与 UI 目录无关。
 */
import {
  MODEL_BRAND_ICONS,
  brandName,
  brandPlatforms,
  brandSvg,
  detectPlatform,
  stripProviderPrefix,
  type ModelBrandIcon,
} from './modelBrandIcons.js'

export interface ModelIconService {
  /** 平台 key（如 seedance / hunyuan / custom） */
  platformOf(modelId: string, provider?: string): string
  /** 平台展示名 */
  nameOf(platform: string): string
  /** 平台 key → 完整 `<svg>` 字符串 */
  svgOf(platform: string): string
  /** 对话模型：模型 ID + provider → `<svg>` */
  svgOfModel(modelId: string, provider?: string): string
  /** 底栏动作：显示名（如「豆包 Seedance 2.0 Fast」）→ `<svg>` */
  svgOfName(name: string): string
  /**
   * provider 的 `icon` 写成一个图标名 / 平台名时的查表入口。
   *
   * 支持三种写法：
   * 1. 平台 key 原样（`seedance` / `volcengine`）—— 直接命中图标表；
   * 2. 平台展示名 / 关键字（`火山引擎`、`可灵`）—— 走 NAME_RULES；
   * 3. 带空白的模糊描述（`kling video`）—— 同上，命中哪个用哪个。
   */
  svgOfIconHint(hint: string): string
  /** 同上，返回平台 key（`custom` 表示自建网关）；**认不出返回空串** */
  platformOfIconHint(hint: string): string
  /** 底栏动作：显示名 → 平台 key */
  platformOfName(name: string): string
  /** 当前有图标的平台清单 */
  platforms(): string[]
  /** 原始图标表（只读，给需要自己组合标题的场景） */
  icons(): Record<string, ModelBrandIcon>
  /** 去掉网关 / 供应商前缀后的模型名（排查识别问题用） */
  bareModelId(modelId: string): string
}

/**
 * 底栏动作名里认家族。
 *
 * 与 `detectPlatform` 分开：那边认的是模型 ID（seedance-v2.0），
 * 这边认的是人写的中文标题（「豆包 Seedance 2.0 Fast」「火山引擎·音频生成」）。
 */
const NAME_RULES: Array<[RegExp, string]> = [
  // 平台名先于模型名（「Dola Seedream 5.0 Pro」是 Dola 的渠道，不是豆包）
  [/dola/, 'dola'],
  [/seedance|即梦.*视频/, 'seedance'],
  [/seedream|即梦/, 'doubao'],
  [/(^|[^a-z])veo([^a-z]|$)/, 'veo'],
  [/sora/, 'sora'],
  [/可灵|kling/, 'kling'],
  [/海螺|hailuo/, 'hailuo'],
  [/runway/, 'runway'],
  [/pika/, 'pika'],
  [/luma|dream ?machine/, 'luma'],
  [/vidu/, 'vidu'],
  [/midjourney/, 'midjourney'],
  [/chatgpt|openai|gpt[- ]?image|apimart/, 'openai'],
  [/火山|volc/, 'volcengine'],
  [/通义|万相|qwen|wanx/, 'qwen'],
  [/混元|hunyuan|^hy/, 'hunyuan'],
  [/智谱|glm/, 'zhipu'],
  [/kimi|moonshot/, 'kimi'],
  [/豆包|doubao/, 'doubao'],
  [/tts|语音|音色|朗读|配音/, 'audio'],
]

/**
 * `icon` 写成名字时的查表：先认平台 key 原样，再走 NAME_RULES 的关键字。
 *
 * 为什么要先认 key：provider 作者最自然的写法就是 `icon: 'seedance'`，
 * 而 NAME_RULES 里没有 `/^seedance$/` 这类精确规则（它认的是人写的标题）。
 *
 * 返回值约定：认得出 → 平台 key（`custom` 也算认得出，它是自建网关那一格）；
 * 认不出 → 空串。空串与 `custom` 必须分开，否则 `icon: 'custom'` 会被当成没认出。
 */
function platformOfIconHint(hint: string): string {
  const raw = String(hint ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (Object.prototype.hasOwnProperty.call(MODEL_BRAND_ICONS, raw)) return raw
  for (const [re, key] of NAME_RULES) if (re.test(raw)) return key
  return ''
}

export function createModelIconService(): ModelIconService {
  const platformOfName = (name: string): string => {
    const s = String(name ?? '').toLowerCase()
    for (const [re, key] of NAME_RULES) if (re.test(s)) return key
    return 'custom'
  }
  return {
    platformOf: (modelId, provider) => detectPlatform(modelId, provider ?? ''),
    nameOf: (platform) => brandName(platform),
    svgOf: (platform) => brandSvg(platform),
    svgOfModel: (modelId, provider) => brandSvg(detectPlatform(modelId, provider ?? '')),
    svgOfName: (name) => brandSvg(platformOfName(name)),
    platformOfName,
    platformOfIconHint: (hint) => platformOfIconHint(hint),
    svgOfIconHint: (hint) => brandSvg(platformOfIconHint(hint)),
    platforms: () => brandPlatforms(),
    icons: () => MODEL_BRAND_ICONS,
    bareModelId: (modelId) => stripProviderPrefix(modelId),
  }
}


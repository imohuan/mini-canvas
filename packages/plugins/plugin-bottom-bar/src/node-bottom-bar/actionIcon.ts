/**
 * actionIcon —— 一个生成动作在图里长什么样（**唯一判定处**）。
 *
 * 为什么单独成文件：同一个图标要在三个地方出现 —— 触发器、下拉列表、预设弹窗。
 * 从前只有触发器走了 provider 的 `icon`，下拉列表由 Agent 的 ChoicePicker 自己按
 * 标题猜平台，于是「触发器是自有图标、列表里全是兜底图标」（用户 2026-11-08 截图）。
 * 判定收在这里，三处共用一份，谁也不会再漏。
 *
 * 优先级（与用户口径一致）：
 * 1. `icon` 是 SVG 字符串 / Base64 图片 → 直接用（provider 最精确的意图）；
 * 2. `icon` 是名字（`seedance` / `火山引擎` / `kling`）→ 交给 Agent 的图标服务模糊查；
 * 3. `icon` 没给 → 按动作标题猜平台（老行为，保持不变）；
 * 4. 都认不出 → 本地兜底图形（按节点类型）。
 */
import { customModelIcon, modelIconOf, type ModelIcon, type ModelTone } from './modelIcons'

/** 图标形状从 modelIcons 转出，调用方不必再单独找那个文件 */
export type { ModelIcon }

/** Agent 的 modelIcons 服务（可选依赖；没装 Agent 时为 undefined） */
export interface ModelIconServiceLike {
  svgOfName(name: string): string
  platformOfName(name: string): string
  /** 模型 ID / provider → 平台 key（Agent 服务有；测试桩可能没有） */
  platformOf?(modelId: string, provider?: string): string
  /** 平台 key → 完整 `<svg>`（品牌图标，自带颜色） */
  svgOf?(platform: string): string
  /** `icon` 写名字时的查表（见 modelIconService.ts） */
  svgOfIconHint?(hint: string): string
  platformOfIconHint?(hint: string): string
}

/**
 * 平台 key → 图标家族。
 *
 * Agent 的图标表是开放的（`MODEL_BRAND_ICONS` 有 31 格），本地 `ModelTone` 只列了
 * 常用的一批；认出来的 key 一律当家族用（CSS 上色走 `[data-tone]`，认不出的样式
 * 就是默认前景色，不会出问题）。
 */
function toneOf(platform: string): ModelTone {
  return platform as ModelTone
}

/**
 * 解析一个动作的图标。
 *
 * @param title     动作标题（没有 icon 时按它猜平台）
 * @param icon      provider 声明的 icon：SVG / Base64 / 图标名
 * @param service   Agent 的图标服务
 * @param nodeType  节点类型（最后兜底用）
 * @param providerIcon  所属平台声明的 icon（动作与品牌都认不出时用它兜底，用户口径 2026-11-10）
 */
export function resolveActionIcon(
  title: string,
  icon: unknown,
  service: ModelIconServiceLike | undefined,
  nodeType?: string,
  providerIcon?: unknown,
): ModelIcon {
  // 1. SVG / Base64：provider 直接给了图形
  const own = customModelIcon(icon)
  if (own) return own

  // 2. icon 写的是名字：先精确命中平台 key，再模糊认关键字
  if (typeof icon === 'string' && icon.trim() !== '') {
    const hint = icon.trim()
    if (service?.platformOfIconHint && service.svgOfIconHint) {
      const platform = service.platformOfIconHint(hint)
      // 空串 = 这个名字认不出，落到第 3 步；不能拿兜底图形冒充「命中」
      if (platform !== '') return { tone: toneOf(platform), svg: service.svgOfIconHint(hint) }
    } else if (service) {
      const platform = service.platformOfName(hint)
      if (platform !== 'custom') return { tone: toneOf(platform), svg: service.svgOfName(hint) }
    }
  }

  // 3. 没给 icon（或 icon 认不出）：按标题猜平台（老行为）
  if (service) {
    const platform = service.platformOfName(title)
    if (platform !== 'custom') return { tone: toneOf(platform), svg: service.svgOfName(title) }
  }

  // 4. 平台自己的图标：动作没写、品牌也认不出时，用 provider 声明的 icon 兜底
  const fromProvider = customModelIcon(providerIcon)
  if (fromProvider) return fromProvider

  // 5. 本地兜底：按节点类型给个通用图形，绝不空白
  return modelIconOf(title, nodeType)
}

/**
 * 选中的 Agent 模型 → 图标（底栏聊天 trigger 用，用户 2026-11-09：
 * 图片/视频/音频的触发器都有模型图标，文本对话那条也要有）。
 *
 * 判定与 Agent 面板同一把尺子（modelBrandIcons.detectPlatform）：
 * 1. 先按模型 ID 认平台（deepseek-* / glm-* / seedance-* …）；
 * 2. 认不出再看显示名（displayName 里写「DeepSeek 官方」这类）；
 * 3. 再看 provider（openrouter 上的 claude-* 靠 provider 落对）；
 * 4. 都认不出 → 本地兜底（`text` 家族的线稿图形，绝不空白）。
 *
 * @param displayName 可选；Agent 配置里的显示名（帮「test 模型」这类认不出 ID 的补一手）
 */
export function resolveModelRowIcon(
  modelId: string,
  provider: string,
  service: ModelIconServiceLike | undefined,
  displayName?: string,
): ModelIcon {
  const tryPlatform = service?.platformOf && service.svgOf
  if (tryPlatform) {
    // 1. 模型 ID（与面板同源）；custom = 自建网关那一格，也算认出
    const p1 = service.platformOf!(modelId, provider)
    if (p1 !== 'custom') return { tone: toneOf(p1), svg: service.svgOf!(p1) }
    // 2. 显示名（「DeepSeek 官方」「test 模型」这类 modelId 认不出的）
    const p2 = service.platformOfName(displayName?.trim() || '')
    if (p2 !== 'custom') return { tone: toneOf(p2), svg: service.svgOfName(p2) }
    // 3. provider 名（openrouter/anthropic、newapi/deepseek 这类前缀）
    const p3 = service.platformOfName(provider)
    if (p3 !== 'custom') return { tone: toneOf(p3), svg: service.svgOfName(p3) }
  }
  // 4. 兜底：显示名 → 本地家族表（认不出给 text 线稿，绝不空白）
  return modelIconOf(displayName || modelId, 'text')
}

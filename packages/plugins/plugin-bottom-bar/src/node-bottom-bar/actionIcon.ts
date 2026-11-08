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

/** Agent 的 modelIcons 服务（可选依赖；没装 Agent 时为 undefined） */
export interface ModelIconServiceLike {
  svgOfName(name: string): string
  platformOfName(name: string): string
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
 */
export function resolveActionIcon(
  title: string,
  icon: unknown,
  service: ModelIconServiceLike | undefined,
  nodeType?: string,
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

  // 4. 本地兜底：按节点类型给个通用图形，绝不空白
  return modelIconOf(title, nodeType)
}

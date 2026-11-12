import type { ResourceItem } from "../types";
import { buildSlotItem } from "./chipRegistry";

/**
 * 文字 → 标签的匹配结果。
 *
 * `from` / `to` 是**这段文字在文本节点内的偏移**（不含节点起始位置，由调用方加上）。
 */
export interface TagMatch {
  from: number
  to: number
  item: ResourceItem
}

/**
 * 标签识别规格：由调用方提供（用户口径 2026-10-27）。
 *
 * 为什么外置：编辑器不该知道「图片N 就是槽位」这种业务规则。
 * 插件想用 `@角色1`、`@素材A` 或完全不同的写法，只提供自己的 scan 即可。
 *
 * `scan` 必须支持一段文字里的**多个**匹配（`看 @图片1 和 @图片2` 要转两个）。
 */
export interface TagSpec {
  scan(text: string): TagMatch[]
  /**
   * 兜底渲染：注册表里没有条目时才用（例如冷启动恢复文档）。
   * 不传 = 组件内置 chip。
   */
  render?(item: ResourceItem): HTMLElement | [string, Record<string, any>, ...any[]]
}

/**
 * 全局标签规格。
 *
 * 为什么用模块级而不是 prop：toDOM 是 schema 的静态方法（mySchema 是模块级单例），
 * 渲染时拿不到组件实例，只能从这里读。
 */
export let activeTagSpec: TagSpec | null = null

/** 注册标签规格（传 null = 取消注册，恢复组件默认规则） */
export function registerTagSpec(spec: TagSpec | null): void {
  activeTagSpec = spec
}

/** 读当前标签规格（渲染兜底用） */
export function currentTagSpec(): TagSpec | null {
  return activeTagSpec
}
/**
 * 组件内置的标签识别规则（没注册 tagSpec 时使用）。
 *
 * 认 `@图片N / @视频N / @音频N / @文本N / @音视频N`（中英双写），
 * 生成 `ref-slot:<kind>:<N>` 的槽位标签。插件注册了 tagSpec 就不会走到这里。
 */
export function builtinScan(text: string): TagMatch[] {
  const out: TagMatch[] = []
  // 用户 2026-10-28：@文本N 也要能转成标签（之前只认图片/视频/音频）
  const re = /@(图片|视频|音频|文本|音视频|image|video|audio|text|media|av)\s*(\d{1,4})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase()
    const slotKind: 'image' | 'video' | 'audio' | 'av' | 'text' =
      kind === '图片' || kind === 'image' ? 'image'
      : kind === '视频' || kind === 'video' ? 'video'
      : kind === '音频' || kind === 'audio' ? 'audio'
      : kind === '文本' || kind === 'text' ? 'text'
      : 'av'
    const label =
      slotKind === 'image' ? '图片'
      : slotKind === 'video' ? '视频'
      : slotKind === 'audio' ? '音频'
      : slotKind === 'text' ? '文本'
      : '音视频'
    const index = Number(m[2])
    if (!index) continue
    out.push({ from: m.index, to: m.index + m[0].length, item: buildSlotItem(slotKind, label + index) })
  }
  return out
}

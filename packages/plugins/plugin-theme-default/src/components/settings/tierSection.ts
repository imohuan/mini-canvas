/**
 * 图片 / 视频缩略图分档的菜单切片。
 *
 * 两个插件的 Config 都把 7 个字段挂在同一个 group「节点/缩略图」里；
 * 菜单层用两个 section 收同一 group，再按字段前缀切片，用户就不必在
 * 一张卡里先翻过图片的 7 项再找视频的 7 项。持久化 key 不变。
 */
import type { SettingEntry } from '@mini-canvas/canvas-render'

export const TIER_FIELD_KEYS = [
  'Tier2Zoom',
  'Tier2Width',
  'Tier2Height',
  'Tier3Zoom',
  'Tier3Width',
  'Tier3Height',
  'ThumbQuality',
] as const

/** 设置皮 provide 的分档预览件 / 切片规则名；自绘页按同一名取。 */
export const SETTINGS_TIER_PREVIEW = 'settingsTierPreview'
export const SETTINGS_TIER_SPEC = 'settingsTierSpec'

export type TierPrefix = 'image' | 'video'

export interface TierSectionSpec {
  prefix: TierPrefix
  title: string
  /** 编辑器上方的说明 */
  description: string
}

const SPECS: Readonly<Record<string, TierSectionSpec>> = {
  'section/canvas/node/image-tiers': {
    prefix: 'image',
    title: '图片分档',
    description: '图片节点按缩放切三档：原图、第二档、第三档。阈值越高越早进入省流档位。',
  },
  'section/canvas/node/video-tiers': {
    prefix: 'video',
    title: '视频分档',
    description: '视频节点用三档帧图代替整段视频解码；三档各自有阈值、目标尺寸和清晰度。',
  },
}

export function tierSectionSpec(sectionId: string): TierSectionSpec | undefined {
  return SPECS[sectionId]
}

/** 该 section 是否接受这个字段（非分档 section 不筛）。 */
export function tierSectionAllowsField(sectionId: string, fieldKey: string): boolean {
  const spec = tierSectionSpec(sectionId)
  if (!spec) return true
  return TIER_FIELD_KEYS.some((suffix) => fieldKey === spec.prefix + suffix)
}

/** 只保留本 section 对应的字段，并保持原顺序。 */
export function filterTierSectionFields(sectionId: string, fields: SettingEntry[]): SettingEntry[] {
  const spec = tierSectionSpec(sectionId)
  if (!spec) return fields
  return fields.filter((field) => tierSectionAllowsField(sectionId, field.key))
}

export interface TierPreviewRow {
  tier: 1 | 2 | 3
  zoom: number | null
  label: string
  tone: 'original' | 'middle' | 'small'
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 三行预览：第三档 → 第二档 → 第一档（从最省流到原图），和画布缩小的方向一致。 */
export function tierPreviewRows(prefix: TierPrefix, get: (key: string) => unknown): TierPreviewRow[] {
  const tier2Zoom = num(get(prefix + 'Tier2Zoom'), 0.45)
  const tier2Width = Math.round(num(get(prefix + 'Tier2Width'), 512))
  const tier2Height = Math.round(num(get(prefix + 'Tier2Height'), 512))
  const tier3Zoom = Math.min(num(get(prefix + 'Tier3Zoom'), 0.3), tier2Zoom)
  const tier3Width = Math.round(num(get(prefix + 'Tier3Width'), 160))
  const tier3Height = Math.round(num(get(prefix + 'Tier3Height'), 160))
  return [
    {
      tier: 3,
      zoom: tier3Zoom,
      label: '第三档 · ' + tier3Width + ' × ' + tier3Height,
      tone: 'small',
    },
    {
      tier: 2,
      zoom: tier2Zoom,
      label: '第二档 · ' + tier2Width + ' × ' + tier2Height,
      tone: 'middle',
    },
    {
      tier: 1,
      zoom: null,
      label: prefix === 'image' ? '第一档 · 原图' : '第一档 · 原生帧',
      tone: 'original',
    },
  ]
}

/**
 * 图片 / 视频分档的菜单切片：两者共用 Config.group「节点/缩略图」，
 * 但设置页必须按字段前缀拆成两块，不能互相翻过对方的 7 项。
 */
import { describe, expect, it } from 'vitest'
import {
  TIER_FIELD_KEYS,
  tierSectionSpec,
  tierSectionAllowsField,
  tierPreviewRows,
} from '../tierSection'

describe('图片 / 视频分档设置切片', () => {
  it('按 section id 识别图片 / 视频两套前缀', () => {
    expect(tierSectionSpec('section/canvas/node/image-tiers')?.prefix).toBe('image')
    expect(tierSectionSpec('section/canvas/node/video-tiers')?.prefix).toBe('video')
    expect(tierSectionSpec('section/canvas/node/detail')).toBeUndefined()
  })

  it('同一 group 的字段只归各自的 section', () => {
    for (const key of TIER_FIELD_KEYS) {
      expect(tierSectionAllowsField('section/canvas/node/image-tiers', 'image' + key)).toBe(true)
      expect(tierSectionAllowsField('section/canvas/node/image-tiers', 'video' + key)).toBe(false)
      expect(tierSectionAllowsField('section/canvas/node/video-tiers', 'video' + key)).toBe(true)
      expect(tierSectionAllowsField('section/canvas/node/video-tiers', 'image' + key)).toBe(false)
    }
    // 非分档 section 不筛字段
    expect(tierSectionAllowsField('section/canvas/node/content', 'imageTier2Zoom')).toBe(true)
  })

  it('预览行给出两档阈值与目标尺寸，阈值顺序稳定', () => {
    const rows = tierPreviewRows('image', (key) => ({
      imageTier2Zoom: 0.45,
      imageTier2Width: 512,
      imageTier2Height: 512,
      imageTier3Zoom: 0.3,
      imageTier3Width: 160,
      imageTier3Height: 160,
      imageThumbQuality: 80,
    })[key])
    expect(rows.map((r) => r.tier)).toEqual([3, 2, 1])
    expect(rows.find((r) => r.tier === 2)?.label).toContain('512')
    expect(rows.find((r) => r.tier === 3)?.label).toContain('160')
    expect(rows.find((r) => r.tier === 2)?.zoom).toBe(0.45)
  })
})

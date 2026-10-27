import { describe, expect, it } from 'vitest'
import { collectUpstreamMaterials } from '../panelSource'

describe('空媒体节点连进来也要占格（用户 2026-10-28）', () => {
  /**
   * 用户「先连线、后上传」是正常流程。空视频/图片节点（url、resourceId 都还没有）
   * 以前被 collectUpstreamMaterials 完全跳过 —— 连了它，参考区却不出现它的格子，
   * displayOrder 里有它但 tiles 里没有，后面格子的序号全部错位，
   * 正文引用它的标签也拿不到 item，缩略图渲染成空白。
   */
  it('collectUpstreamMaterials：空视频节点收下，kind=video、url 空', () => {
    const mats = collectUpstreamMaterials(
      [{ source: 'v1', target: 'me' }],
      'me',
      (id) => (id === 'v1' ? { type: 'video', data: { label: '视频 1' } } : undefined),
    )
    const hit = mats.find((m) => m.id === 'v1')
    expect(hit).toBeTruthy()
    expect(hit?.kind).toBe('video')
    expect(hit?.url).toBeUndefined()
  })
})


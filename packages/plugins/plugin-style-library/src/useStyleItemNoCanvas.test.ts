/**
 * 项目页没有画布时的降级：media 能力缺失 → 返回 no-media，不创建半成品节点。
 *
 * 这条对应 18 号文档的验收：项目页能浏览素材，但“使用”必须禁用 + 可见提示。
 */
import { describe, expect, it, vi } from 'vitest'
import { useStyleItem } from './useStyleItem'

describe('缺 media 能力（项目页）', () => {
  it('不造节点，返回 no-media 与可见提示', async () => {
    const setLabel = vi.fn()
    const result = await useStyleItem(
      { media: undefined, setLabel, onError: () => {} },
      { url: '/x.png', label: '测试' },
      { x: 0, y: 0 },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('no-media')
    expect(result.message).toMatch(/画布/)
    expect(setLabel).not.toHaveBeenCalled()
  })
})

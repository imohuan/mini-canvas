import { describe, it, expect } from 'vitest'
import { openPreview, closePreview, previewItem, previewOwner, previewActive } from '../mediaPreview'

describe('mediaPreview 会话状态', () => {
  it('openPreview 记住素材来源与发起节点（删除连线时要用）', () => {
    openPreview({ name: '音频1', kind: 'audio', url: 'x.ogg', nodeId: 'src1' }, 'owner1')
    expect(previewItem()?.nodeId).toBe('src1')
    expect(previewOwner()).toBe('owner1')
    expect(previewActive()).toBe(true)
    closePreview()
    expect(previewActive()).toBe(false)
    expect(previewOwner()).toBe('')
  })
})

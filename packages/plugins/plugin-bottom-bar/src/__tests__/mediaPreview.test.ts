import { describe, it, expect } from 'vitest'
import {
  openPreview,
  closePreview,
  previewItem,
  previewOwner,
  previewActive,
  currentPreview,
  setPreviewIndex,
} from '../mediaPreview'

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

  /**
   * 多张同类素材的轮播：MediaViewer 用 ← / → 切换后报回下标（用户口径 2026-10-12：
   * 「我有多个图片，需要按左右快捷键进行切换」）—— 会话里的「当前这张」要跟着换，
   * 标题与删除按钮才指向同一张图。
   */
  it('多张素材切换后：当前项换成新那张（名字/地址/素材节点 id 一起换）', () => {
    openPreview(
      {
        name: '图A',
        kind: 'image',
        url: 'a.png',
        nodeId: 'na',
        list: ['a.png', 'b.png', 'c.png'],
        index: 0,
        ids: ['na', 'nb', 'nc'],
        names: ['图A', '图B', '图C'],
      },
      'owner1',
    )
    setPreviewIndex(2)
    expect(previewItem()?.index).toBe(2)
    expect(currentPreview()).toMatchObject({ name: '图C', url: 'c.png', nodeId: 'nc' })
    setPreviewIndex(1)
    expect(currentPreview()).toMatchObject({ name: '图B', url: 'b.png', nodeId: 'nb' })
    closePreview()
  })

  it('越界下标收敛在 0..N-1；没有 list 时当前项就是它自己', () => {
    openPreview({ name: '图A', kind: 'image', url: 'a.png', list: ['a.png', 'b.png'], index: 0 })
    setPreviewIndex(9)
    expect(previewItem()?.index).toBe(1)
    closePreview()
    openPreview({ name: '音频1', kind: 'audio', url: 'x.ogg' })
    expect(currentPreview()).toMatchObject({ name: '音频1', url: 'x.ogg' })
    closePreview()
  })
})

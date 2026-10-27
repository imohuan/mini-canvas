import { describe, expect, it } from 'vitest'
import { refSlotsFromDoc } from '../refSlots'

it('refSlotsFromDoc —— 只认真正的标签节点', () => {
  const doc = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: '@图片9 只是文字' },
        { type: 'resource', attrs: { id: 'ref-slot:image:1' } },
        { type: 'resource', attrs: { id: 'ref-slot:audio:2' } },
      ],
    }],
  }
  const slots = refSlotsFromDoc(doc)
  expect(slots.map((s) => s.key)).toEqual(['image:1', 'audio:2'])
  // 纯文字里的 @图片9 不算声明
  expect(slots.some((s) => s.kind === 'image' && s.index === 9)).toBe(false)
})

it('refSlotsFromDoc —— 空/坏形状返回空数组', () => {
  expect(refSlotsFromDoc(undefined)).toEqual([])
  expect(refSlotsFromDoc({ type: 'paragraph' })).toEqual([])
})


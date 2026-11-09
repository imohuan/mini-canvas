/**
 * 提示词分段（用户 2026-11-09）：
 *
 * - 标签只给**资源 id**，resources 里按同一个 id 找名称；
 * - 文字单独成段，保持输入框里的顺序；
 * - 标签名不允许空格（「音频 3」→「音频3」）。
 */
import { describe, expect, it } from 'vitest'
import { promptSegmentsFromDoc, promptSegmentsText } from '../promptSegments'

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'resource', attrs: { id: 'ref-node:40', name: '音频3' } },
        { type: 'text', text: ' 他说："我爱你宝贝"' },
      ],
    },
  ],
}

describe('promptSegmentsFromDoc', () => {
  it('标签给资源 id，文字单独成段（顺序不变）', () => {
    expect(promptSegmentsFromDoc(doc)).toEqual([
      { type: 'tag', value: '40' },
      { type: 'prompt', value: ' 他说："我爱你宝贝"' },
    ])
  })

  it('多段落之间补换行', () => {
    expect(
      promptSegmentsFromDoc({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '第一行' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '第二行' }] },
        ],
      }),
    ).toEqual([{ type: 'prompt', value: '第一行\n第二行' }])
  })

  it('待绑定标签（ref-name）没有资源 id → 当普通文字，标签名去空格', () => {
    expect(
      promptSegmentsFromDoc({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'resource', attrs: { id: 'ref-name:音频 3', name: '音频 3' } }],
          },
        ],
      }),
    ).toEqual([{ type: 'prompt', value: '@音频3' }])
  })

  it('没有富文本快照 → 纯文本整段当 prompt', () => {
    expect(promptSegmentsFromDoc(undefined, '画一只猫')).toEqual([{ type: 'prompt', value: '画一只猫' }])
    expect(promptSegmentsFromDoc(undefined, '')).toEqual([])
  })
})

describe('promptSegmentsText（只给纯文本调用方）', () => {
  it('标签按 resources 名称展开', () => {
    expect(
      promptSegmentsText(
        [
          { type: 'tag', value: '40' },
          { type: 'prompt', value: ' 他说：你好' },
        ],
        [{ id: '40', name: '音频3' }],
      ),
    ).toBe('@音频3 他说：你好')
  })
})

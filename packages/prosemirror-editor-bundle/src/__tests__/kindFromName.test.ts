/**
 * 标签类型从**名字**解析（用户 2026-10-28）。
 *
 * 为什么：类型原本只存在注册表的 mediaType 里，重开底栏/组件刷新时注册表条目被重建
 * （只剩 name/id）→ 所有图标退化成文本图标。名字是节点属性，刷新多少次都在。
 */
import { describe, expect, it } from 'vitest'
import { kindFromName, builtinScan } from '../useEditor.ts'

describe('kindFromName：从标签名读类型', () => {
  it('四种前缀各自识别', () => {
    expect(kindFromName('图片1')).toBe('image')
    expect(kindFromName('视频2')).toBe('video')
    expect(kindFromName('音频3')).toBe('audio')
    expect(kindFromName('文本1')).toBe('text')
  })

  it('带宽空格也认（历史数据里出现过「图片 54」）', () => {
    expect(kindFromName('图片 54')).toBe('image')
  })

  it('认不出 → text（缺省安全值）', () => {
    expect(kindFromName('随便一个名字')).toBe('text')
    expect(kindFromName('')).toBe('text')
    expect(kindFromName(undefined)).toBe('text')
  })
})

describe('builtinScan：@文本N 也要能转成标签', () => {
  it('四种类型都能识别，且带正确 id', () => {
    const hits = builtinScan('@图片1 @视频2 @音频3 @文本4')
    expect(hits.map((h) => h.item.id)).toEqual([
      'ref-slot:image:1',
      'ref-slot:video:2',
      'ref-slot:audio:3',
      'ref-slot:text:4',
    ])
    expect(hits.map((h) => h.item.name)).toEqual(['图片1', '视频2', '音频3', '文本4'])
  })
})


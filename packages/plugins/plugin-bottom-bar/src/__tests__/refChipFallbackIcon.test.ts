/**
 * 标签左侧「图标永远在」契约（用户 2026-10-29：标签的缩略图/图标会莫名不见）。
 *
 * 根因：旧实现是二选一 —— 能画图就只输出 img，图 404 / 还没 resolve 时左侧空白。
 * 现在底图固定是类型图标，图片作为叠加层（加载成功才显示）。
 */
import { describe, expect, it } from 'vitest'
import { collectUpstreamMaterials, toEditorResources } from '../panelSource'

function specOf(nodeType: 'image' | 'audio' | 'text', data: Record<string, unknown>) {
  const materials = collectUpstreamMaterials(
    [{ source: 'u1', target: 't' }],
    't',
    () => ({ type: nodeType, data: { label: '样例', ...data } }),
  )
  const items = toEditorResources(materials)
  const item = items[0]
  return (item.renderEditor!(item) as unknown[]).slice(2) as unknown[][]
}

describe('标签左侧：图标是底图，图片只是叠加层', () => {
  it('图片节点：第一颗是类型图标，第二颗才是缩略图', () => {
    const children = specOf('image', { imageUrl: 'https://x/a.png' })
    expect((children[0][1] as Record<string, string>).class).toBe('resource-chip-icon')
    expect((children[0][1] as Record<string, string>)['data-icon']).toBe('image')
    expect(children[1][0]).toBe('img')
    expect((children[1][1] as Record<string, string>).class).toBe('resource-chip-thumb')
  })

  it('图片地址为空（还没 resolve）：仍然有图标，没有缩略图', () => {
    const children = specOf('image', {})
    expect((children[0][1] as Record<string, string>).class).toBe('resource-chip-icon')
    expect(children.some((c) => c[0] === 'img')).toBe(false)
  })

  it('音频节点：只有图标（mp3 不能当图片画）', () => {
    const children = specOf('audio', { audioUrl: 'https://x/a.mp3' })
    expect((children[0][1] as Record<string, string>)['data-icon']).toBe('audio')
    expect(children.some((c) => c[0] === 'img')).toBe(false)
  })

  it('文本节点：只有图标', () => {
    const children = specOf('text', { text: '正文' })
    expect((children[0][1] as Record<string, string>)['data-icon']).toBe('text')
    expect(children.some((c) => c[0] === 'img')).toBe(false)
  })
})

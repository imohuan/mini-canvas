/**
 * 粘贴文件交给外部（用户 2026-10-27）。
 *
 * 组件不知道「建节点、连参考线」这些业务，只负责从剪贴板取出文件并交给调用方。
 * 这里钉住取文件的两条真实路径：`clipboardData.files` 优先，为空时退回 `items`。
 */
import { describe, expect, it } from 'vitest'
import { pickFilesFromClipboard } from '../useEditor.ts'

const asData = (data: unknown) => data as unknown as DataTransfer

describe('pickFilesFromClipboard', () => {
  it('files 有内容时直接用', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const got = pickFilesFromClipboard(asData({ files: [file], items: [] }))
    expect(got).toHaveLength(1)
    expect(got[0].name).toBe('a.png')
  })

  it('files 为空时退回 items（真实浏览器复制图片常见）', () => {
    const file = new File(['x'], 'b.png', { type: 'image/png' })
    const got = pickFilesFromClipboard(
      asData({ files: [], items: [{ kind: 'file', getAsFile: () => file }] }),
    )
    expect(got).toHaveLength(1)
    expect(got[0].name).toBe('b.png')
  })

  it('items 里的字符串项被忽略', () => {
    const got = pickFilesFromClipboard(
      asData({ files: [], items: [{ kind: 'string', getAsFile: () => null }] }),
    )
    expect(got).toHaveLength(0)
  })

  it('没有剪贴板数据 → 空数组', () => {
    expect(pickFilesFromClipboard(null)).toEqual([])
    expect(pickFilesFromClipboard(undefined)).toEqual([])
  })
})


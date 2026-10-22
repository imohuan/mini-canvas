/**
 * 「素材库 → 画布」必须走 media 能力（用户口径 2026-10-22 + 插件开发规范 §3.1）。
 *
 * 锁的是这条顺序：取字节 → media.put → media.addNode（由图片插件写字段）。
 * 回归点有两个：
 *   1. 早先直接把 `/api/style-library/file?name=…` 写进 imageUrl —— 素材库目录一改就全裂；
 *   2. 只把地址换成 resourceId、仍由本插件手写节点 data 并塞 resolve 出来的地址 ——
 *      违反 §2.2/§3.3（临时地址不写回节点），也绕过了图片插件的尺寸/缩略图逻辑。
 */
import { describe, it, expect, vi } from 'vitest'
import { useStyleItem, fileNameOf, type StyleItemMedia } from './useStyleItem'

const URL_STYLE = '/api/style-library/file?name=abc_123.png'

function fakeMedia(over: Partial<StyleItemMedia> = {}): StyleItemMedia & {
  put: ReturnType<typeof vi.fn>
  addNode: ReturnType<typeof vi.fn>
} {
  const put = vi.fn(async () => 'default/deadbeefdeadbeef.png')
  const addNode = vi.fn(() => 'n1')
  return { put, addNode, ...over } as never
}

describe('useStyleItem：先存资源、再交给图片插件建节点', () => {
  it('★ 顺序正确：put 在 addNode 之前；只传引用与文件名，不传任何地址', async () => {
    const calls: string[] = []
    const media = fakeMedia({
      put: vi.fn(async () => {
        calls.push('put')
        return 'default/deadbeefdeadbeef.png'
      }),
      addNode: vi.fn((kind: string, resourceId: string, _p: unknown, opts?: { meta?: Record<string, unknown> }) => {
        calls.push('addNode')
        expect(kind).toBe('image')
        expect(resourceId).toBe('default/deadbeefdeadbeef.png')
        // 只有文件名，没有任何地址字段（临时地址不写回节点）
        expect(opts?.meta).toEqual({ name: 'abc_123.png' })
        expect(JSON.stringify(opts)).not.toContain('/api/')
        return 'n1'
      }),
    })
    const setLabel = vi.fn()

    const r = await useStyleItem(
      { media, setLabel, fetchBlob: async () => new Blob(['x'], { type: 'image/png' }) },
      { url: URL_STYLE, label: '风格 A' },
      { x: 10, y: 20 },
    )

    expect(r).toMatchObject({ ok: true, nodeId: 'n1' })
    expect(calls).toEqual(['put', 'addNode'])
    // 标题走公开入口，不往 data 里手塞
    expect(setLabel).toHaveBeenCalledWith('n1', '风格 A')
    // 落库时带上素材文件名与图片类型
    expect(media.put).toHaveBeenCalledWith(expect.any(Blob), {
      kind: 'image',
      name: 'abc_123.png',
    })
  })

  it('取字节失败 → 不落库、不建节点，并给可见文案', async () => {
    const media = fakeMedia()
    const r = await useStyleItem(
      { media, fetchBlob: async () => { throw new Error('404') } },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toMatchObject({ ok: false, reason: 'fetch-failed' })
    expect((r as { message: string }).message).toBeTruthy()
    expect(media.put).not.toHaveBeenCalled()
    expect(media.addNode).not.toHaveBeenCalled()
  })

  it('没有 media 能力 → 不建节点（不写临时地址）', async () => {
    const r = await useStyleItem(
      { media: undefined, fetchBlob: async () => new Blob(['x']) },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toMatchObject({ ok: false, reason: 'no-media' })
  })

  it('宿主没装 image 创建器（addNode 返回 undefined）→ 报可见错误', async () => {
    const media = fakeMedia({ addNode: vi.fn(() => undefined) } as never)
    const r = await useStyleItem(
      { media, fetchBlob: async () => new Blob(['x']) },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toMatchObject({ ok: false, reason: 'add-node-failed' })
    expect((r as { message: string }).message).toContain('图片节点')
  })

  it('资源库落盘失败 → 不建节点', async () => {
    const media = fakeMedia({ put: vi.fn(async () => { throw new Error('disk full') }) } as never)
    const r = await useStyleItem(
      { media, fetchBlob: async () => new Blob(['x']) },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toMatchObject({ ok: false, reason: 'put-failed' })
    expect(media.addNode).not.toHaveBeenCalled()
  })
})

describe('fileNameOf：风格库的查询串形态', () => {
  it('从 ?name= 取文件名（含 URL 编码）', () => {
    expect(fileNameOf(URL_STYLE)).toBe('abc_123.png')
    expect(fileNameOf('/api/style-library/file?name=a%20b.png')).toBe('a b.png')
  })
  it('普通路径取最后一段；空串不炸', () => {
    expect(fileNameOf('/api/assets/files/x.jpeg')).toBe('x.jpeg')
    expect(fileNameOf('')).toBe('')
  })
})

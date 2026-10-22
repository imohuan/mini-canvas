/**
 * 「素材库 → 画布」必须走资源库（用户口径 2026-10-22）。
 *
 * 锁的是这条顺序：取字节 → resources.put → resources.resolve → doc.createNode。
 * 回归点：早先直接把 `/api/style-library/file?name=…` 写进节点的 imageUrl，
 * 素材库目录一改 / 插件没装，画布上的图就全裂了。
 */
import { describe, it, expect, vi } from 'vitest'
import { useStyleItem, fileNameOf, type StyleItemResources } from './useStyleItem'

const URL_STYLE = '/api/style-library/file?name=abc_123.png'

function fakeResources(over: Partial<StyleItemResources> = {}): StyleItemResources & {
  put: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
} {
  const put = vi.fn(async () => 'default/deadbeefdeadbeef.png')
  const resolve = vi.fn(async () => '/api/canvases/default/resources/deadbeefdeadbeef.png')
  return { put, resolve, ...over } as never
}

describe('useStyleItem：先存资源、再建节点', () => {
  it('★ 顺序正确：put 在 createNode 之前，节点写的是 resourceId', async () => {
    const calls: string[] = []
    const resources = fakeResources({
      put: vi.fn(async () => {
        calls.push('put')
        return 'default/deadbeefdeadbeef.png'
      }),
      resolve: vi.fn(async () => {
        calls.push('resolve')
        return '/api/canvases/default/resources/deadbeefdeadbeef.png'
      }),
    })
    const doc = {
      createNode: vi.fn((_t: string, _p: { x: number; y: number }, data?: Record<string, unknown>) => {
        calls.push('createNode')
        expect(data?.resourceId).toBe('default/deadbeefdeadbeef.png')
        // 迁移期仍写显示地址，旧渲染路径能直接显示
        expect(data?.imageUrl).toBe('/api/canvases/default/resources/deadbeefdeadbeef.png')
        // 绝不能把素材库地址当资源引用写进去
        expect(data?.resourceId).not.toContain('/api/style-library/')
        return 'n1'
      }),
    }

    const r = await useStyleItem(
      { doc, resources, fetchBlob: async () => new Blob(['x'], { type: 'image/png' }) },
      { url: URL_STYLE, label: '风格 A' },
      { x: 10, y: 20 },
    )

    expect(r).toMatchObject({ ok: true, nodeId: 'n1' })
    expect(calls).toEqual(['put', 'resolve', 'createNode'])
    // 落库时带上素材文件名与图片类型
    expect(resources.put).toHaveBeenCalledWith(expect.any(Blob), {
      kind: 'image',
      name: 'abc_123.png',
    })
  })

  it('取字节失败 → 不建节点（不退回写素材库地址）', async () => {
    const resources = fakeResources()
    const doc = { createNode: vi.fn(() => 'n1') }
    const r = await useStyleItem(
      { doc, resources, fetchBlob: async () => { throw new Error('404') } },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toEqual({ ok: false, reason: 'fetch-failed' })
    expect(resources.put).not.toHaveBeenCalled()
    expect(doc.createNode).not.toHaveBeenCalled()
  })

  it('没有资源服务 → 不建节点（不写临时地址）', async () => {
    const doc = { createNode: vi.fn(() => 'n1') }
    const r = await useStyleItem(
      { doc, resources: undefined, fetchBlob: async () => new Blob(['x']) },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toEqual({ ok: false, reason: 'no-resources' })
    expect(doc.createNode).not.toHaveBeenCalled()
  })

  it('资源库落盘失败 → 不建节点', async () => {
    const resources = fakeResources({ put: vi.fn(async () => { throw new Error('disk full') }) } as never)
    const doc = { createNode: vi.fn(() => 'n1') }
    const r = await useStyleItem(
      { doc, resources, fetchBlob: async () => new Blob(['x']) },
      { url: URL_STYLE, label: 'A' },
      { x: 0, y: 0 },
    )
    expect(r).toEqual({ ok: false, reason: 'put-failed' })
    expect(doc.createNode).not.toHaveBeenCalled()
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

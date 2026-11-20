// 常量防漂移：这些字面量在本插件里是**就地内联**的（产物要自包含），
// 与数据层 / 后端各有一份。改了一边没改另一边，这里立刻红。
import { describe, it, expect } from 'vitest'
import { ADMIN_TOKEN_KEY, ADMIN_TOKEN_HEADER, setAdminToken } from '@plume-canvas/plugin-sdk'
import { CloudApi } from '../api'
import {
  GRAPH_KEY,
  GRAPH_EDGES_KEY,
  GRAPH_VIEWPORT_KEY,
  PROVIDERS_VERSION_KEY,
  HISTORY_REV_KEY,
  CANVAS_ID,
  RESOURCE_URL_FIELDS,
  restoreMediaUrls,
} from '../keys'
import {
  GRAPH_KEY as DATA_GRAPH_KEY,
  GRAPH_EDGES_KEY as DATA_EDGES_KEY,
  GRAPH_VIEWPORT_KEY as DATA_VIEWPORT_KEY,
  SAVE_TYPES,
  scopedKey,
  restoreNodeMediaUrls,
} from '@plume-canvas/canvas-data'

describe('与 canvas-data 逐字一致', () => {
  it('三个画布 key', () => {
    expect(GRAPH_KEY).toBe(DATA_GRAPH_KEY)
    expect(GRAPH_EDGES_KEY).toBe(DATA_EDGES_KEY)
    expect(GRAPH_VIEWPORT_KEY).toBe(DATA_VIEWPORT_KEY)
  })

  it('canvas 域在四类 type 里（不然 useAdapter 会挂到不存在的域上）', () => {
    expect(SAVE_TYPES).toContain('canvas')
  })

  it('scopedKey 的产物（adapter 摘前缀时按它算）', () => {
    expect(scopedKey('canvas', GRAPH_KEY)).toBe('canvas:graph')
  })
  it('就地版 restoreMediaUrls 与数据层同口径（云端恢复重建地址靠它，漂移=图又变空白）', async () => {
    // 本插件产物必须零 import，所以就地实现了一份最小版；这里拿同一份输入分别跑两边，结果必须一致。
    const makeNodes = () => [
      { id: 'v1', type: 'video', data: { resourceId: '/api/canvases/c1/resources/a.mp4' } },
      { id: 'i1', type: 'image', data: { resourceId: '/api/canvases/c1/resources/b.png' } },
      { id: 'a1', type: 'audio', data: { resourceId: '/api/canvases/c1/resources/c.mp3' } },
      // 已有持久地址 → 不该被重建覆盖
      { id: 'i2', type: 'image', data: { resourceId: '/api/canvases/c1/resources/d.png', imageUrl: '/keep.png' } },
      // 资源取不到 → 应清掉失效地址
      { id: 'i3', type: 'image', data: { resourceId: 'gone', imageUrl: 'blob:dead' } },
      // 可视化节点：地址在 uiOutputUrl（漏了这条，云端恢复后 UI 产物会空白）
      { id: 'u1', type: 'ui', data: { resourceId: '/api/canvases/c1/resources/e.png' } },
    ]
    const local = makeNodes()
    const dataLayer = makeNodes()
    const restore = async (resourceId: string, kind: string): Promise<string | undefined> =>
      resourceId === 'gone' ? undefined : '/resolved/' + kind + '/' + resourceId.split('/').pop()

    await restoreMediaUrls(local, restore)
    await restoreNodeMediaUrls(dataLayer, restore)

    expect(local).toEqual(dataLayer)
  })

  // 字段表必须逐项一致：少一个类型时，只有真的出现那种节点才会炸（音频 / 对比图这类）。
  it('节点类型 → 地址字段 逐类型一致（含 audio / ui / 3d-preview / image-compare）', async () => {
    const types = ['image', 'video', 'audio', 'ui', '3d-preview', 'image-compare', 'unknown-type']
    const makeNodes = () => types.map((type, i) => ({
      id: 'n' + i,
      type,
      data: { resourceId: '/api/canvases/c1/resources/0123456789abcdef.png' },
    }))
    const local = makeNodes()
    const dataLayer = makeNodes()
    const restore = async (_resourceId: string, kind: string): Promise<string | undefined> =>
      '/resolved/' + kind + '.png'

    await restoreMediaUrls(local, restore)
    await restoreNodeMediaUrls(dataLayer, restore)
    expect(local).toEqual(dataLayer)

    // 再逐类型核对：**已知类型**都确实写进了自己的地址字段（没写＝只拿到引用、画面空白）。
    // unknown-type 两边都不写：类型未知且节点上没有现成地址键时，猜一个字段更危险。
    for (const [i, type] of types.entries()) {
      if (type === 'unknown-type') continue
      const data = local[i]!.data as Record<string, unknown>
      const filled = Object.keys(data).filter((k) => k.endsWith('Url'))
      expect(filled.length, type + ' 没写任何地址字段').toBeGreaterThan(0)
    }
  })
})

describe('自身约定', () => {
  it('默认画布 id 是 default', () => {
    expect(CANVAS_ID).toBe('default')
  })

  it('两个信号键落在 config 域（是"后台的元信息"，不是画布内容）', () => {
    expect(PROVIDERS_VERSION_KEY).toBe('providers-version')
    expect(HISTORY_REV_KEY).toBe('history-rev')
  })

  it('媒体字段清单覆盖九个（只写 imageUrl 会漏掉视频/音频/全景/对比图）', () => {
    expect([...RESOURCE_URL_FIELDS].sort()).toEqual(
      ['audioUrl', 'imageUrl', 'leftImageUrl', 'maskUrl', 'panoUrl', 'posterUrl', 'rightImageUrl', 'thumbUrl', 'videoUrl'].sort(),
    )
  })
})

describe('管理令牌：就地内联与 canvas-base 不漂移', () => {
  it('用 canvas-base 的 setAdminToken 写入后，CloudApi 必须读到同一个键并送出同一个头名', async () => {
    class MemoryStorage {
      private m = new Map<string, string>()
      getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
      setItem(k: string, v: string) { this.m.set(k, v) }
      removeItem(k: string) { this.m.delete(k) }
    }
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
    try {
      setAdminToken('shared-token')
      expect(ADMIN_TOKEN_KEY).toBe('plume_admin_token')
      let sent: Headers | undefined
      const api = new CloudApi({
        baseUrl: 'http://srv',
        fetchImpl: async (_url, init) => {
          sent = new Headers(init?.headers)
          return new Response('{}', { status: 200 })
        },
      })
      await api.patchNodes('c1', { add: [] })
      expect(sent?.get(ADMIN_TOKEN_HEADER)).toBe('shared-token')
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})

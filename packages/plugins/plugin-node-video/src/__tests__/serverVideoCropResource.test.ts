/**
 * 后台资源名判据的契约测试（用户 2026-10-30 实测报的错误）。
 *
 * 现象：画布里一个普通视频节点点「剪辑」，后台回
 *   400 「源视频不是画布资源（本地/外链地址暂不支持真剪辑）」
 * 根因：后台只认内容哈希名（16 位 hex），而画布服务本身还支持槽位名
 * （slot-<节点id>.mp4，可视化节点这类"原地覆盖同一份文件"的产物）。
 * 两边白名单不一致 → 对真实存在的文件拒绝服务。
 *
 * 这里锁三件事：
 *   1. 两种合法资源名都认（与 cloud-server 的 isSafeResourceName 同口径）；
 *   2. 路径穿越 / 非法画布 id / 非画布地址仍然拒绝；
 *   3. 路由层的判断顺序正确：槽位名不该在"资源名校验"这一步被拒（应进到"读文件"）。
 *
 * 2026-11-13 追加：跨画布引用（源在别的画布）要认得出来源、照样裁剪，产物落当前画布 ——
 * 用户实测「视频能播，一点裁剪就说不是画布资源」正是这条。
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error 后台插件是纯 JS（外挂形态，不参与本包 TS 编译）
import { isSafeResourceName, parseResourceName, parseResourceRef, apply } from '../../server/plugin-video-crop.js'

const CANVAS = '824e779f34314f86'

describe('后台资源名白名单：与画布服务同口径', () => {
  it('内容寻址名（16 位 hex）照旧认', () => {
    expect(isSafeResourceName('0ec818b240a04c92.mp4')).toBe(true)
    expect(isSafeResourceName('0ec818b240a04c92')).toBe(true)
  })

  it('槽位名（slot-<节点id>.mp4）也认 —— 这次报错的那一种', () => {
    expect(isSafeResourceName('slot-54.mp4')).toBe(true)
    expect(isSafeResourceName('slot-abc_DEF-1.webm')).toBe(true)
  })

  it('路径穿越 / 多段路径 / 其它前缀一律不认', () => {
    expect(isSafeResourceName('../secret.mp4')).toBe(false)
    expect(isSafeResourceName('slot-1/../2.mp4')).toBe(false)
    expect(isSafeResourceName('slot-1\\2.mp4')).toBe(false)
    expect(isSafeResourceName('foo-54.mp4')).toBe(false)
    expect(isSafeResourceName('')).toBe(false)
  })
})

describe('从节点地址里取资源名', () => {
  it('取得到槽位名（带 query 也不受影响）', () => {
    expect(parseResourceName('/api/canvases/' + CANVAS + '/resources/slot-54.mp4', CANVAS)).toBe('slot-54.mp4')
    expect(parseResourceName('/api/canvases/' + CANVAS + '/resources/slot-54.mp4?t=1', CANVAS)).toBe('slot-54.mp4')
  })

  it('带 origin 的同源地址也认', () => {
    expect(parseResourceName('http://127.0.0.1:8865/api/canvases/' + CANVAS + '/resources/slot-54.mp4', CANVAS))
      .toBe('slot-54.mp4')
  })

  // 2026-11-13 改口径：别的画布的**资源**要认（跨画布粘贴的引用，见下面那组用例），
  // 但「别的画布 id 长什么样」仍必须过白名单 —— 非法 id 不能当成可读目录。
  it('别的画布合法 id 认得出来源（就是那份跨画布引用）', () => {
    expect(parseResourceName('/api/canvases/other/resources/slot-54.mp4', CANVAS)).toBe('slot-54.mp4')
  })

  it('非法画布 id 仍不认（不能把任意目录当资源根）', () => {
    expect(parseResourceName('/api/canvases/../resources/slot-54.mp4', CANVAS)).toBeUndefined()
    expect(parseResourceName('/api/canvases/a/b/resources/slot-54.mp4', CANVAS)).toBeUndefined()
  })

  it('外链 / blob / dataURL 不认（后台拿不到字节）', () => {
    expect(parseResourceName('https://example.com/a.mp4', CANVAS)).toBeUndefined()
    expect(parseResourceName('blob:http://127.0.0.1:8865/abc', CANVAS)).toBeUndefined()
    expect(parseResourceName('', CANVAS)).toBeUndefined()
  })
})

/**
 * 跨画布粘贴的引用（用户 2026-11-13 实测报障）。
 *
 * 现象：视频节点在画布里正常播放，一点「裁剪」就回
 *   400 「源视频不是画布资源（本地/外链地址暂不支持真裁剪）」。
 * 根因：节点里的引用指向**另一张画布**（粘贴时资源引用原样带过来），画面能播是因为
 * `/api/canvases/<别的id>/resources/...` 本来就要求得到；后台却只认「当前画布」前缀，
 * 于是对真实存在的文件拒绝服务。
 *
 * 这里锁住：解析出「源在哪张画布」，产物仍写当前画布，路径穿越照旧拒绝。
 */
describe('跨画布来源：认得出来源画布，不误判成「不是画布资源」', () => {
  const OTHER = '824e779f34314f86'

  it('引用指向别的画布 → 解析出来源画布，而不是 undefined', () => {
    expect(parseResourceRef('/api/canvases/' + OTHER + '/resources/7c09a3901a62d034.mp4', CANVAS)).toEqual({
      canvasId: OTHER,
      name: '7c09a3901a62d034.mp4',
    })
  })

  it('自己的画布照旧按自己解析（顺序不影响）', () => {
    expect(parseResourceRef('/api/canvases/' + CANVAS + '/resources/slot-9.mp4', CANVAS)).toEqual({
      canvasId: CANVAS,
      name: 'slot-9.mp4',
    })
  })

  it('相对形态（不带 /api 前缀）也认得出源画布', () => {
    expect(parseResourceRef('/canvases/' + OTHER + '/resources/7c09a3901a62d034.mp4', CANVAS)?.canvasId).toBe(OTHER)
  })

  it('画布 id 不合白名单 / 资源名带路径 → 仍然拒绝（不放宽穿越）', () => {
    expect(parseResourceRef('/api/canvases/bad..id/resources/abc.mp4', CANVAS)).toBeUndefined()
    expect(parseResourceRef('/api/canvases/' + OTHER + '/resources/../secret.mp4', CANVAS)).toBeUndefined()
  })
})

describe('路由层：槽位名不再被"不是画布资源"挡掉', () => {
  /** 极简 ctx：只实现路由表与资源服务 */
  function boot(store: { read(canvasId: string, name: string): Promise<Uint8Array | undefined> }) {
    const routes = new Map<string, (c: unknown) => unknown>()
    const ctx = {
      routes: {
        post: (path: string, fn: (c: unknown) => unknown) => void routes.set(path, fn),
        get: (path: string, fn: (c: unknown) => unknown) => void routes.set(path, fn),
      },
      get: (name: string) => (name === 'canvasResources' ? store : undefined),
    }
    apply(ctx)
    return routes
  }

  function call(fn: (c: unknown) => unknown, body: Record<string, unknown>) {
    const c = {
      req: { json: async () => body },
      json: (payload: unknown, status?: number) => ({ status: status ?? 200, payload }),
    }
    return fn(c) as Promise<{ status: number; payload: { ok: boolean; error?: string } }>
  }

  it('slot- 源：通过资源名校验，只在"文件不存在"处停（404，而不是 400）', async () => {
    const routes = boot({ read: async () => undefined })
    const res = await call(routes.get('/api/video-cut')!, {
      canvasId: CANVAS,
      nodeId: '54',
      srcUrl: '/api/canvases/' + CANVAS + '/resources/slot-54.mp4',
      start: 4.511,
      end: 8.011,
    })
    expect(res.status).toBe(404)
    expect(res.payload.error).toBe('源视频不存在')
  })

  it('裁剪接口同样放行槽位名', async () => {
    const routes = boot({ read: async () => undefined })
    const res = await call(routes.get('/api/video-crop')!, {
      canvasId: CANVAS,
      nodeId: '54',
      srcUrl: '/api/canvases/' + CANVAS + '/resources/slot-54.mp4',
      rect: { x: 0, y: 0, width: 100, height: 100 },
    })
    expect(res.status).toBe(404)
    expect(res.payload.error).toBe('源视频不存在')
  })

  it('外链源仍明确拒绝（这条不能放宽）', async () => {
    const routes = boot({ read: async () => undefined })
    const res = await call(routes.get('/api/video-cut')!, {
      canvasId: CANVAS,
      nodeId: '54',
      srcUrl: 'https://example.com/a.mp4',
      start: 0,
      end: 1,
    })
    expect(res.status).toBe(400)
    expect(res.payload.error).toContain('不是画布资源')
  })

  /**
   * 跨画布来源：引用指向别的画布时，读那份文件而不是判失败，产物写回**当前**画布。
   * 这是用户 2026-11-13 报的那条（视频能播，一裁剪就说「不是画布资源」）。
   */
  it('源在别的画布：读的是它自己的画布，产物落当前画布', async () => {
    const reads: Array<{ canvasId: string; name: string }> = []
    const routes = boot({
      read: async (canvasId: string, name: string) => {
        reads.push({ canvasId, name })
        // 拿到字节也不真跑 ffmpeg：这里只验「读哪张画布」，交给下面立刻失败的分支
        return undefined
      },
    })
    const res = await call(routes.get('/api/video-cut')!, {
      canvasId: CANVAS,
      nodeId: '9',
      srcUrl: '/api/canvases/824e779f34314f86/resources/7c09a3901a62d034.mp4',
      start: 0,
      end: 1,
    })
    expect(reads).toEqual([{ canvasId: '824e779f34314f86', name: '7c09a3901a62d034.mp4' }])
    // 文件读不到 → 404「源视频不存在」；重点是没有在「不是画布资源」那一步被拒
    expect(res.status).toBe(404)
    expect(res.payload.error).toBe('源视频不存在')
  })
})

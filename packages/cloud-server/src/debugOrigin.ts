/**
 * 调试产物的**独立源**（另开一个端口，只读静态服务）。
 *
 * ## 为什么要有它
 *
 * 可视化节点的 HTML 是"用户（或 Agent）写的代码"。它原来被放在后台自己的
 * `/api/canvases/:id/resources/debug/*` 下以 `text/html` 回读 —— 那等于让这段
 * 代码在**后台的源**上执行：它读得到 `localStorage` 里的管理令牌，也能直接调
 * `/api/*` 改画布。沙箱 iframe 费那么大劲守住的那条边界，被调试页从后门绕开了。
 *
 * 解法很朴素：把调试产物搬到**另一个端口**。浏览器眼里它就是另一个源，
 * 读不到画布页的 localStorage、cookie，也调不了后台接口（除非后台显式放行）。
 * DevTools 仍然全通 —— 它还是普通页面，只是不再跟后台同源。
 *
 * ## 它只做三件事
 *
 *   · 认两个白名单（画布 id、文件名），别的一律 404；
 *   · 从 `<dataRoot>/canvases/<id>/resources/debug/<file>` 读文件；
 *   · 回正确的 content-type 与"不要缓存"。
 *
 * 不写文件、不列目录、不代理请求。写盘仍然在插件侧（`writeDebugFile`）。
 */
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { promises as fs } from 'node:fs'

export interface DebugOrigin {
  /** 起好之后的地址（`http://127.0.0.1:<端口>`）；没起时是空串 */
  readonly url: string
  /** 起服务，返回真实地址；端口被占会 reject，不会静默换端口 */
  start(): Promise<string>
  /** 关服务（没起过也能调） */
  stop(): Promise<void>
}

/** 画布 id 白名单（与 canvasPathsShared 同口径） */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 调试文件名白名单：`debug-<id>[-vN].html` / `context-<id>[-vN].js` / `sdk-<id>[-vN].js`。
 *
 * 三段都是"单段字母数字下划线连字符"，拼不出 `../`，也拼不出子目录。
 * 另外**前缀必须配对应的后缀**：`context-x.html` 这种组合不收（写盘的
 * `debugFileNames` 也不会产出它）。
 */
const DEBUG_FILE_RE = /^(debug-[A-Za-z0-9_-]{1,64}(?:-v[A-Za-z0-9_-]{0,63})?\.html|(?:context|sdk)-[A-Za-z0-9_-]{1,64}(?:-v[A-Za-z0-9_-]{0,63})?\.js)$/

export function isSafeDebugFileName(name: string): boolean {
  return DEBUG_FILE_RE.test(name)
}

function contentTypeOf(name: string): string {
  return name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8'
}

export function createDebugOrigin(opts: { dataRoot: string; hostname?: string; port?: number }): DebugOrigin {
  const hostname = opts.hostname ?? '127.0.0.1'
  const port = opts.port ?? 0
  const dataRoot = opts.dataRoot

  let server: Server | undefined
  let url = ''

  /**
   * 允许的 Host（端口起来后才能定）。
   *
   * 为什么必须校验：不校验的话，`Host: evil.example` 照样能读到调试产物 ——
   * 配合 DNS 重绑定，一个网页就能把某个域名解析到 127.0.0.1，然后读走节点 HTML 与
   * `context-*.js`（里面有上游数据与那张 10 分钟短令牌）。短令牌跨源带不上，但内容泄露是真的。
   */
  const allowedHosts = new Set<string>()

  /** 把 URL 路径拆成 [canvasId, file]，任何不合白名单的输入都返回 undefined */
  function routeOf(rawUrl: string): { canvasId: string; file: string; abs: string } | undefined {
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(rawUrl, 'http://debug.local').pathname)
    } catch {
      return undefined
    }
    // 只认 /<canvasId>/<file> 这一层
    const parts = pathname.split('/').filter((s) => s.length > 0)
    if (parts.length !== 2) return undefined
    const [canvasId, file] = parts
    if (!CANVAS_ID_RE.test(canvasId) || !isSafeDebugFileName(file)) return undefined
    const dir = path.join(dataRoot, 'canvases', canvasId, 'resources', 'debug')
    const abs = path.resolve(dir, file)
    // 双保险：resolve 之后必须仍落在这个 debug/ 目录里
    if (!abs.startsWith(path.resolve(dir) + path.sep)) return undefined
    return { canvasId, file, abs }
  }

  return {
    get url() {
      return url
    },

    start() {
      if (url) return Promise.resolve(url)
      return new Promise<string>((resolve, reject) => {
        const s = createServer((req, res) => {
          const notFound = (): void => {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            res.end('not found')
          }
          if (req.method !== 'GET') return notFound()
          // Host 白名单先看（防 DNS 重绑定读走调试产物）
          const reqHost = String(req.headers.host ?? '').toLowerCase()
          if (!allowedHosts.has(reqHost)) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
            res.end('host not allowed')
            return
          }
          const hit = routeOf(req.url ?? '/')
          if (!hit) return notFound()
          fs.readFile(hit.abs).then(
            (buf) => {
              res.writeHead(200, {
                'content-type': contentTypeOf(hit.file),
                // 调试文件随构建重写，缓存住就看不到新内容
                'cache-control': 'no-store, no-cache, must-revalidate',
                'x-content-type-options': 'nosniff',
              })
              res.end(buf)
            },
            () => notFound(),
          )
        })
        s.once('error', (err) => {
          server = undefined
          reject(err)
        })
        s.listen(port, hostname, () => {
          const addr = s.address()
          if (!addr || typeof addr === 'string') {
            s.close()
            reject(new Error('调试源没拿到监听端口'))
            return
          }
          server = s
          url = 'http://' + hostname + ':' + addr.port
          // Host 白名单：本机两种写法 + 显式配置的 hostname（反代场景由它自己加）
          allowedHosts.add(('127.0.0.1:' + addr.port).toLowerCase())
          allowedHosts.add(('localhost:' + addr.port).toLowerCase())
          allowedHosts.add((hostname + ':' + addr.port).toLowerCase())
          resolve(url)
        })
      })
    },

    stop() {
      const s = server
      server = undefined
      url = ''
      allowedHosts.clear()
      if (!s) return Promise.resolve()
      return new Promise<void>((resolve) => s.close(() => resolve()))
    },
  }
}

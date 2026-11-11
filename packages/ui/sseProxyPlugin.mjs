/**
 * sseProxyPlugin —— 开发期把 `/api/kv/events`（SSE）单独转发给后台。
 *
 * 为什么不能交给 vite 的 `server.proxy`（2026-11-10 实测）：
 *   后台 `GET :8867/api/kv/events` 6ms 就回 200 + 响应头；同一个请求经 dev 代理
 *   （:5289）→ 4 秒内连响应头都收不到。页面里的 EventSource 永远停在 CONNECTING，
 *   于是生成进度、AI 流式文字全不刷新 —— 用户看到的就是「一直卡在 0%」。
 *   用最小复现钉住了这一点：同一条代理转发普通 SSE 服务（自己写的 200 + chunked）
 *   正常，转发真实后台就挂；说明是 `http-proxy-3` 对这条长响应的处理问题，
 *   不是来源边界、也不是后台实现。
 *
 * 做法：只接这一条路径，用 `node:http` 自己转发。要点：
 *   1. 把 Origin 改写成后台地址（与其它 /api 请求同一条信任规则）；
 *   2. 上游响应头原样写回，并确保 `flushHeaders()` —— 浏览器要先拿到 200 才会
 *      认为 EventSource 已连接；
 *   3. 双向 `pipe`，客户端断开就掐上游，别把长连接留在后台。
 *
 * 只在 dev（vite serve）生效；生产由 cloud-server 同源直供，没有代理这一层。
 */
import http from 'node:http'
import https from 'node:https'

/** 需要自己转发的事件流路径（目前只有 KV/画布变更这一条） */
const SSE_PATH = '/api/kv/events'

export function sseProxyPlugin(options = {}) {
  const target = options.target || 'http://localhost:8865'
  return {
    name: 'plume-canvas-sse-proxy',
    apply: 'serve',
    configureServer(server) {
      // 必须在 vite 内置代理之前挂上：`configureServer` 返回的函数在内部中间件之**后**跑，
      // 所以这里直接 push 到前置中间件数组。
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (!url.startsWith(SSE_PATH)) return next()

        const upstream = new URL(url, target)
        const mod = upstream.protocol === 'https:' ? https : http
        const headers = { ...req.headers, host: upstream.host, origin: target }
        const upReq = mod.request(
          {
            protocol: upstream.protocol,
            hostname: upstream.hostname,
            port: upstream.port,
            path: upstream.pathname + upstream.search,
            method: req.method,
            headers,
          },
          (upRes) => {
            res.writeHead(upRes.statusCode || 502, upRes.headers)
            // 让浏览器立刻看到响应头：EventSource 只有拿到 200 才会进入 OPEN
            res.flushHeaders?.()
            upRes.pipe(res)
            res.on('close', () => upRes.destroy())
          },
        )
        upReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('SSE 代理连不上后台：' + err.message)
          } else {
            res.end()
          }
        })
        // 客户端断开（关页面 / 切走）→ 掐上游，别让后台留一条没人听的长连接
        res.on('close', () => upReq.destroy())
        req.pipe(upReq)
      })
    },
  }
}

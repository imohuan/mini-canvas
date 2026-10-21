/**
 * 调试源的契约：真起服务、真发 HTTP。
 *
 * 为什么不用假 ctx / 假 fetch：这条服务的全部价值就是"另一个源"，只有真的
 * 监听一个端口、真的发请求，才能证明路径白名单与响应头是对的。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, request as httpRequest } from 'node:http'
import { createDebugOrigin, isSafeDebugFileName, type DebugOrigin } from '../debugOrigin.js'

let root = ''
let origin: DebugOrigin | undefined

function debugDir(canvasId: string): string {
  return path.join(root, 'canvases', canvasId, 'resources', 'debug')
}

async function write(canvasId: string, file: string, content: string): Promise<void> {
  const dir = debugDir(canvasId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, file), content, 'utf8')
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-debug-origin-'))
  origin = createDebugOrigin({ dataRoot: root })
  await origin.start()
})

afterEach(async () => {
  await origin?.stop()
  origin = undefined
  await fs.rm(root, { recursive: true, force: true })
})

describe('调试源：只读静态服务', () => {
  it('读 html：text/html + 不缓存 + nosniff', async () => {
    await write('c1', 'debug-7.html', '<h1>hi</h1>')
    const res = await fetch(origin!.url + '/c1/debug-7.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toBe('<h1>hi</h1>')
  })

  it('读 js：application/javascript（带版本号的文件名也认）', async () => {
    await write('c1', 'context-7-v2.js', 'window.x=1')
    await write('c1', 'sdk-7-v2.js', 'window.y=2')
    const a = await fetch(origin!.url + '/c1/context-7-v2.js')
    expect(a.status).toBe(200)
    expect(a.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(await a.text()).toBe('window.x=1')
    const b = await fetch(origin!.url + '/c1/sdk-7-v2.js')
    expect(b.status).toBe(200)
    expect(await b.text()).toBe('window.y=2')
  })

  it('非法画布 id → 404', async () => {
    await write('c1', 'debug-7.html', 'x')
    for (const p of ['/../debug-7.html', '/a%2Fb/debug-7.html', '/' + 'x'.repeat(65) + '/debug-7.html']) {
      const res = await fetch(origin!.url + p)
      expect(res.status, p).toBe(404)
    }
  })

  it('非法文件名（穿越 / 不在白名单）→ 404', async () => {
    await write('c1', 'debug-7.html', 'x')
    for (const p of [
      '/c1/../debug-7.html',
      '/c1/x.html',
      '/c1/debug-7.txt',
      '/c1/context-7.html',
      '/c1/debug-7.html.js',
      '/c1/debug-7.html/extra',
    ]) {
      const res = await fetch(origin!.url + p)
      expect(res.status, p).toBe(404)
    }
  })

  it('文件不存在 → 404；非 GET → 404', async () => {
    const a = await fetch(origin!.url + '/c1/debug-404.html')
    expect(a.status).toBe(404)
    const b = await fetch(origin!.url + '/c1/debug-404.html', { method: 'POST' })
    expect(b.status).toBe(404)
  })

  it('stop 之后端口就没人接了', async () => {
    const u = origin!.url
    await origin!.stop()
    await expect(fetch(u + '/c1/debug-7.html')).rejects.toBeTruthy()
    // 允许重复 stop
    await origin!.stop()
  })

  it('端口被占用 → start 直接 reject（不静默换端口）', async () => {
    const blocker = createServer((_req, res) => res.end(''))
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()))
    const addr = blocker.address()
    const busy = typeof addr === 'object' && addr ? addr.port : 0
    try {
      const other = createDebugOrigin({ dataRoot: root, port: busy })
      await expect(other.start()).rejects.toBeTruthy()
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('文件名白名单与写盘那侧的形态一致', () => {
    expect(isSafeDebugFileName('debug-7.html')).toBe(true)
    expect(isSafeDebugFileName('debug-7-v3.html')).toBe(true)
    expect(isSafeDebugFileName('context-7.js')).toBe(true)
    expect(isSafeDebugFileName('sdk-7-v1.js')).toBe(true)
    expect(isSafeDebugFileName('x.html')).toBe(false)
    expect(isSafeDebugFileName('../debug-7.html')).toBe(false)
  })

  /**
   * ★ Host 白名单：防 DNS 重绑定读走调试产物。
   *
   * 不校验 Host 的话，`Host: evil.example` 照样 200；一个网页可以把域名解析到 127.0.0.1
   * 然后读走节点 HTML 与 `context-*.js`（含上游数据与那张 10 分钟短令牌）。
   */
  it('★ 别的 Host 一律 403（只认 127.0.0.1 / localhost 的那个端口）', async () => {
    const origin = createDebugOrigin({ dataRoot: root })
    const url = await origin.start()
    try {
      const port = new URL(url).port
      await fs.mkdir(path.join(root, 'canvases', 'c1', 'resources', 'debug'), { recursive: true })
      await fs.writeFile(path.join(root, 'canvases', 'c1', 'resources', 'debug', 'debug-7.html'), 'x', 'utf8')
      const ok = await fetch('http://127.0.0.1:' + port + '/c1/debug-7.html', { headers: { host: '127.0.0.1:' + port } })
      expect(ok.status).toBe(200)
      // fetch 的 host 是禁止改写的头，这里必须用 node:http 才能真的伪造 Host
      expect(await statusWithHost(Number(port), 'evil.example')).toBe(403)
      expect(await statusWithHost(Number(port), 'evil.example:' + port)).toBe(403)
      // localhost 这一种写法要认（浏览器里两种都可能出现）
      expect(await statusWithHost(Number(port), 'localhost:' + port)).toBe(200)
      // ★ 带转发头 → 403：调试源只该被本机直连（挂反代等于把产物给远程访客）
      expect(await statusWithHostAndHeader(Number(port), '127.0.0.1:' + port, 'x-forwarded-for', '1.2.3.4')).toBe(403)
    } finally {
      await origin.stop()
    }
  })
})

/** 用指定的 Host 头（可再加一个额外头）发一次 GET，返回状态码 */
function statusWithHostAndHeader(port: number, host: string, key: string, value: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/c1/debug-7.html', method: 'GET', headers: { host, [key]: value } },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** 用指定的 Host 头发一次 GET，返回状态码（fetch 改不了 Host，只能用 node:http） */
function statusWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/c1/debug-7.html', method: 'GET', headers: { host } },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

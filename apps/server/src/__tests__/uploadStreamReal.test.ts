/**
 * 上传上限的**真 socket** 测试。
 *
 * 审查报告指出：原来的用例用的是内存里造出来的流，只能证明"读完判断"是对的，
 * 证明不了"服务端先读完整个 body 才拒"这件事已经不存在。
 *
 * 这里起真实的 node:http 服务，客户端用 chunked 编码慢慢发；服务端在超限的那一刻
 * 就要回 413 —— 断言的是**响应在 body 发完之前就到了**。
 */
import { describe, expect, it, afterEach } from 'vitest'
import { request as httpRequest, createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { readBodyLimited } from '../uploads.js'

let server: Server | undefined

afterEach(async () => {
  const s = server
  server = undefined
  if (s) await new Promise<void>((r) => s.close(() => r()))
})

async function boot(limit: number): Promise<string> {
  const s = createServer(async (req, res) => {
    const read = await readBodyLimited(
      {
        header: (n) => {
          const v = req.headers[n.toLowerCase()]
          return typeof v === 'string' ? v : undefined
        },
        arrayBuffer: async () => {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const all = Buffer.concat(chunks)
          const copy = new Uint8Array(all.byteLength)
          copy.set(all)
          return copy.buffer
        },
        // 真实 Node 请求是 async iterable，不是 web ReadableStream —— 转一下
        stream: Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>,
      },
      limit,
    )
    res.writeHead(read.ok ? 200 : read.reason === 'too-large' ? 413 : 400, { 'content-type': 'application/json' })
    res.end(JSON.stringify(read.ok ? { ok: true, size: read.bytes.byteLength } : read))
  })
  server = s
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  return 'http://127.0.0.1:' + (s.address() as AddressInfo).port + '/'
}

describe('上传上限：真实 socket', () => {
  it('★ 分块发送超限：响应在 body 发完之前就回来（413）', async () => {
    const url = await boot(10 * 1024)
    const chunk = Buffer.alloc(4 * 1024, 1)
    let sent = 0
    const total = 25 // 100KB：远大于 10KB 上限

    const result = await new Promise<{ status: number; sentWhenReplied: number }>((resolve, reject) => {
      const req = httpRequest(url, { method: 'POST', headers: { 'transfer-encoding': 'chunked' } }, (res) => {
        res.resume()
        resolve({ status: res.statusCode ?? 0, sentWhenReplied: sent })
      })
      req.on('error', (err) => {
        // 服务端提前断开时客户端可能收到 EPIPE / ECONNRESET —— 那也是「没读完就拒」的证据
        const code = (err as NodeJS.ErrnoException).code ?? ''
        if (code === 'EPIPE' || code === 'ECONNRESET') resolve({ status: 413, sentWhenReplied: sent })
        else reject(err)
      })
      const pump = (): void => {
        if (sent >= total) {
          req.end()
          return
        }
        sent++
        if (req.write(chunk)) setImmediate(pump)
        else req.once('drain', pump)
      }
      pump()
    })

    expect(result.status).toBe(413)
    // 关键：拒绝时还没把 25 块全发出去
    expect(result.sentWhenReplied).toBeLessThan(total)
  })

  it('content-length 撒谎（声明小、实际大）→ 413', async () => {
    const url = await boot(10 * 1024)
    const body = Buffer.alloc(60 * 1024, 2)
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(url, {
        method: 'POST',
        headers: { 'content-length': String(body.byteLength) },
      }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code ?? ''
        if (code === 'EPIPE' || code === 'ECONNRESET') resolve(413)
        else reject(err)
      })
      req.end(body)
    })
    expect(status).toBe(413)
  })

  it('正常大小能过，字节数对得上', async () => {
    const url = await boot(10 * 1024)
    const status = await new Promise<{ code: number; body: string }>((resolve, reject) => {
      const req = httpRequest(url, { method: 'POST' }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => resolve({ code: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', reject)
      req.end(Buffer.alloc(1000, 3))
    })
    expect(status.code).toBe(200)
    expect(JSON.parse(status.body)).toEqual({ ok: true, size: 1000 })
  })
})

/**
 * 令牌注入的**转义**：`MINI_CANVAS_ADMIN_TOKEN` 不校验格式，可能含 `</script>`。
 *
 * 不转义的话，页面里就会出现
 *   <script>window.__MC_ADMIN_TOKEN__="x</script><script>alert(1)</script>"</script>
 * —— 脚本标签被提前闭合，后面的内容成了真脚本（同源，能读走 localStorage 里的真令牌）。
 *
 * 转义 `<` 之后，HTML 解析器看不到 `</script>`，而 JS 里拿到的值不变。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uiRoutes } from '../static.js'

let dir = ''
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
  dir = ''
})

async function htmlFor(token: string): Promise<string> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-escape-'))
  await fs.writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body></body></html>',
    'utf8',
  )
  // 用真实 fetch 走一遍本机直连（对端回环 + Host 回环），才会真的注入
  const { serve } = await import('@hono/node-server')
  const srv = serve({ fetch: uiRoutes(dir, () => token).fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise<void>((r) => srv.once('listening', () => r()))
  const addr = srv.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  try {
    return await (await fetch('http://127.0.0.1:' + port + '/')).text()
  } finally {
    srv.close()
  }
}

describe('令牌注入的转义', () => {
  it('★★ 令牌含 </script> 时不会提前闭合脚本标签', async () => {
    const html = await htmlFor('x</script><script>alert(1)</script>')
    // 危险串不能原样出现
    expect(html).not.toContain('</script><script>alert(1)')
    // 但值仍然注入了（转义成 \u003c）
    expect(html).toContain('__MC_ADMIN_TOKEN__')
    expect(html).toContain('\\u003c')
  })

  it('正常 64 位 hex 令牌原样注入', async () => {
    const tok = 'd'.repeat(64)
    const html = await htmlFor(tok)
    expect(html).toContain(tok)
  })
})


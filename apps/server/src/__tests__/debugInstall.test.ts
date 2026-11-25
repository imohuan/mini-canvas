/**
 * 「按绝对路径装卸后台插件」：路由住在**热重载插件自己的后台半**里，不在宿主内置插件里。
 *
 * 要证明的是**用户口径 2026-11-25** 的简化链路：watch 上报产物在仓库里的绝对路径，
 * 后台直接读它装/卸 —— 不复制进数据根的插件目录，也不需要 package.json 声明登录项。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServerFramework } from '../serverFramework/index.js'
import { apply as applyHotReloadServer, name as hotReloadName } from '../../../../packages/plugins/plugin-hot-reload/src/server.js'

describe('热重载插件后台半：按路径装卸', () => {
  it('装一个仓库外的文件 → 路由立刻可访问；卸掉后 404', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'plume-debug-install-'))
    const file = path.join(dir, 'server.js')
    await writeFile(
      file,
      `export const name = 'debug-probe'
export function apply(ctx) {
  ctx.routes.get('/api/debug-probe/ping', (c) => c.json({ ok: true }))
}
`,
      'utf8',
    )
    const host = createServerFramework({ hotFallback: true })
    try {
      host.ctx.plugin({ name: hotReloadName, apply: (scope) => applyHotReloadServer(scope as never) })
      await host.start()

      const body = JSON.stringify({ file, id: 'debug-probe' })
      const installed = await host.app.fetch(
        new Request('http://x/api/hot-reload/server/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
      )
      expect(installed.status).toBe(200)
      expect(await (await host.app.fetch(new Request('http://x/api/debug-probe/ping'))).json()).toEqual({ ok: true })

      const uninstalled = await host.app.fetch(
        new Request('http://x/api/hot-reload/server/uninstall', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file, id: 'debug-probe' }),
        }),
      )
      expect(uninstalled.status).toBe(200)
      expect((await host.app.fetch(new Request('http://x/api/debug-probe/ping'))).status).toBe(404)
    } finally {
      host.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('相对路径与不存在的文件都明确拒绝，不假装成功', async () => {
    const host = createServerFramework({ hotFallback: true })
    try {
      host.ctx.plugin({ name: hotReloadName, apply: (scope) => applyHotReloadServer(scope as never) })
      await host.start()
      const rel = await host.app.fetch(
        new Request('http://x/api/hot-reload/server/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: 'dist/server.js' }),
        }),
      )
      expect(rel.status).toBe(400)
      expect(await rel.json()).toMatchObject({ ok: false })

      const missing = await host.app.fetch(
        new Request('http://x/api/hot-reload/server/install', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: 'C:/definitely/not/here/server.js' }),
        }),
      )
      expect(missing.status).toBe(400)
    } finally {
      host.stop()
    }
  })
})

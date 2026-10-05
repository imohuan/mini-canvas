/**
 * 后台插件热装/热卸（闭环的真正最后一环）。
 *
 * 背景：原先后台半要"重启生效"。用户从 NPM 装完、界面立刻就用，不该被要求重启。
 * 内核 installPlugin/uninstallPlugin 本就支持运行期动作，路由代理也现查注册场，
 * 唯一障碍是 Hono 路由表冻死 —— 靠 start 时的 catch-all 兜底解决。
 *
 * 本测试钉住：同一进程内装完立刻可调、卸完立刻失效。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServerFramework } from '../serverFramework/index.js'
import { hotInstallServerPlugin, hotUninstallServerPlugin } from '../serverFramework/hotLoad.js'

const SHOWCASE_SERVER = path.resolve(__dirname, '../../../plugins/plugin-showcase/dist/server.js')

let dir: string
let serverDir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-hot-'))
  serverDir = path.join(dir, 'server-plugins')
  await fs.mkdir(serverDir, { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('后台插件热装/热卸（不重启）', () => {
  it('装完立刻可调、卸完立刻失效', async () => {
    const host = createServerFramework({ root: dir, hotFallback: true })
    await host.start()
    expect((await host.app.fetch(new Request('http://x/api/showcase/meta'))).status).toBe(404)
    await fs.copyFile(SHOWCASE_SERVER, path.join(serverDir, 'showcase.js'))
    const inst = await hotInstallServerPlugin(host.ctx, serverDir, 'showcase')
    expect(inst.ok, inst.error).toBe(true)
    const meta = await host.app.fetch(new Request('http://x/api/showcase/meta'))
    expect(meta.status).toBe(200)
    expect(((await meta.json()) as { name: string }).name).toBe('showcase')
    const un = hotUninstallServerPlugin(host.ctx, 'showcase')
    expect(un.ok, un.error).toBe(true)
    expect((await host.app.fetch(new Request('http://x/api/showcase/meta'))).status).toBe(404)
    host.stop()
  }, 30_000)

  it('启动装载的插件（非热装）也能按 id 推出真名并卸掉', async () => {
    // 场景：服务启动时从目录扫进来（hotLoaded 里没有它），卸载只能从 id 现推真名。
    // id 是 mini-canvas-plugin-showcase、真名是 showcase —— 不推就摘不掉（实测：卸完后台还在跑）。
    const host = createServerFramework({ root: dir, hotFallback: true })
    await host.start()
    // 模拟"启动装载"：直接登记（不走 hotInstallServerPlugin，故 hotLoaded 为空）
    host.ctx.installPlugin({ name: 'showcase', apply: () => {} } as never)
    // 卸：靠 id 推名（mini-canvas-plugin-showcase → showcase）摘掉
    const un = hotUninstallServerPlugin(host.ctx, 'mini-canvas-plugin-showcase')
    expect(un.ok, '应能从包名推出真名并卸载').toBe(true)
    host.stop()
  }, 30_000)
})

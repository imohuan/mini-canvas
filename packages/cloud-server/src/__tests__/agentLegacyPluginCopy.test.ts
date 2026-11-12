/**
 * 全局插件目录里存着**旧版本副本**时，服务必须还能起来。
 *
 * 真实现象（2026-11-12 用户实测）：数据根 `<数据根>/plugins/plugin-agent/` 是早先复制过去的
 * 前端半（只有 dist/web.js，package.json 里没有 `plume.server.entry`）。
 * 插件目录改成「全局优先」后，加载器读到这份旧副本 → Agent 后台半根本不存在 →
 * 宿主在 listen 回调里调 agentServices() 抛出，**整个服务起不来**：
 *
 *   Error: [cloud-server] Agent 已关闭，不能访问 Agent 服务
 *
 * 修法两条（本文件各锁一条）：
 * 1. 找后台半时只认「真的声明了 server.entry」的那一份，旧副本会被跳过、回落到随包版本；
 * 2. 就算一份都找不到，Agent 相关接口降级 404，服务照常启动。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'
import { resolvePluginDirWithServer } from '../plugins/pluginRoots.js'

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-agent-legacy-'))
})
afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

/** 造一个只有前端半的旧插件目录（没有 server.entry） */
async function writeLegacyCopy(root: string, name: string): Promise<void> {
  const d = path.join(root, name, 'dist')
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(path.join(d, 'web.js'), 'export const name = "x"')
  await fs.writeFile(
    path.join(root, name, 'package.json'),
    JSON.stringify({ name, plume: { pluginName: 'x', web: { entry: 'dist/web.js' } } }),
  )
}

/** 造一个带后台半的插件目录 */
async function writeWithServer(root: string, name: string): Promise<void> {
  const d = path.join(root, name, 'dist')
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(path.join(d, 'web.js'), 'export const name = "x"')
  await fs.writeFile(path.join(d, 'server.js'), 'export const name = "probe"\nexport function apply() {}')
  await fs.writeFile(
    path.join(root, name, 'package.json'),
    JSON.stringify({ name, plume: { pluginName: 'x', web: { entry: 'dist/web.js' }, server: { entry: 'dist/server.js' } } }),
  )
}

describe('全局目录里是旧副本时，后台半要回落到随包版本', () => {
  it('★ 只认声明了 server.entry 的那一份（全局旧副本会被跳过）', async () => {
    const globalRoot = path.join(dir, 'global')
    const packagedRoot = path.join(dir, 'packaged')
    await writeLegacyCopy(globalRoot, 'plugin-agent')
    await writeWithServer(packagedRoot, 'plugin-agent')

    const picked = await resolvePluginDirWithServer({ global: globalRoot, packaged: packagedRoot }, 'plugin-agent')
    expect(picked?.replace(/\\/g, '/')).toContain('/packaged/plugin-agent')
  })

  it('自带插件的全局副本不是 NPM 装的 → 用随包那份（避免旧副本盖住新构建）', async () => {
    const globalRoot = path.join(dir, 'global')
    const packagedRoot = path.join(dir, 'packaged')
    await writeWithServer(globalRoot, 'plugin-agent')
    await writeWithServer(packagedRoot, 'plugin-agent')

    const picked = await resolvePluginDirWithServer({ global: globalRoot, packaged: packagedRoot }, 'plugin-agent')
    expect(picked?.replace(/\\/g, '/')).toContain('/packaged/plugin-agent')
  })
})

describe('Agent 后台一份都找不到时，服务照常启动', () => {
  it('★ 旧副本（只有 web.js）不会让启动失败，Agent 接口降级 404', async () => {
    const pluginsDir = path.join(dir, 'plugins')
    await writeLegacyCopy(pluginsDir, 'plugin-agent')

    // 不抛就算过：这正是用户实测的崩溃点
    srv = await createCloudServer({ port: 0, dir, pluginsDir, watchProviders: false })
    const health = await srv.app.fetch(new Request('http://x/health'))
    expect(health.status).toBe(200)

    const cfg = await srv.app.fetch(new Request('http://x/api/agent/config'))
    expect(cfg.status).toBe(404)
  })
})

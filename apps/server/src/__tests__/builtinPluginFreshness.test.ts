/**
 * 自带插件必须用**随包新产物**，不能被数据根里的旧副本盖住。
 *
 * 真实现象（2026-11-12 用户实测）：`pnpm start` 已经重新编译，`assets/plugins/plugin-manager`
 * 是新产物；但 `<数据根>/plugins/plugin-manager` 还留着早先的旧副本，
 * “全局优先”让它继续生效 —— 页面上的「管理令牌」删掉了却还在显示。
 *
 * 规则：自带插件默认随包；只有从 NPM 安装/更新过（`plume.npmInstalled: true`）才用全局。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePluginDir, resolvePluginDirWithServer } from '../plugins/pluginRoots.js'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-plugin-freshness-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writePlugin(root: string, name: string, meta: { npmInstalled?: boolean; server?: boolean } = {}) {
  const d = path.join(root, name, 'dist')
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(path.join(d, 'web.js'), 'export const name = "' + name + '"')
  if (meta.server) await fs.writeFile(path.join(d, 'server.js'), 'export function apply() {}')
  await fs.writeFile(
    path.join(root, name, 'package.json'),
    JSON.stringify({
      name,
      plume: {
        pluginName: name,
        web: { entry: 'dist/web.js' },
        ...(meta.server ? { server: { entry: 'dist/server.js' } } : {}),
        ...(meta.npmInstalled ? { npmInstalled: true } : {}),
      },
    }),
  )
}

const norm = (p: string | undefined) => p?.replace(/\\/g, '/')

describe('自带插件的目录解析', () => {
  it('★ 全局有旧副本、随包是新产物 → 用随包（否则 pnpm start 的重新编译白做）', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await writePlugin(global, 'plugin-manager')
    await writePlugin(packaged, 'plugin-manager')

    expect(norm(await resolvePluginDir({ global, packaged }, 'plugin-manager'))).toContain('/packaged/plugin-manager')
  })

  it('全局那份是 NPM 安装副本 → 仍用全局（用户装过的新版优先）', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await writePlugin(global, 'plugin-manager', { npmInstalled: true })
    await writePlugin(packaged, 'plugin-manager')

    expect(norm(await resolvePluginDir({ global, packaged }, 'plugin-manager'))).toContain('/global/plugin-manager')
  })

  it('非自带插件仍以全局优先', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await writePlugin(global, 'plugin-custom')
    await writePlugin(packaged, 'plugin-custom')

    expect(norm(await resolvePluginDir({ global, packaged }, 'plugin-custom'))).toContain('/global/plugin-custom')
  })

  it('只有一份时就用那一份', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await fs.mkdir(packaged, { recursive: true })
    await writePlugin(global, 'plugin-manager')

    expect(norm(await resolvePluginDir({ global, packaged }, 'plugin-manager'))).toContain('/global/plugin-manager')
  })
})

describe('带后台半的解析同样优先随包（自带件）', () => {
  it('全局旧副本没有 server.entry 时，回落到随包', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await writePlugin(global, 'plugin-agent')
    await writePlugin(packaged, 'plugin-agent', { server: true })

    expect(norm(await resolvePluginDirWithServer({ global, packaged }, 'plugin-agent'))).toContain('/packaged/plugin-agent')
  })
})

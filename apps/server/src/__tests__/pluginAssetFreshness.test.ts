/**
 * `/plugins/<插件>/<文件>` 必须与清单指向**同一份产物**。
 *
 * 真实现象（2026-11-12 用户实测）：`pnpm start` 重新编译后，清单已经指向随包新产物，
 * 静态路由却还从数据根旧副本发文件 —— 页面上删掉的「管理令牌」又出现了。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pluginRoutes } from '../static.js'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-plugin-assets-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writePlugin(root: string, name: string, body: string, meta: { npmInstalled?: boolean } = {}) {
  const d = path.join(root, name, 'dist')
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(path.join(d, 'web.js'), body)
  await fs.writeFile(
    path.join(root, name, 'package.json'),
    JSON.stringify({
      name,
      plume: {
        pluginName: name,
        web: { entry: 'dist/web.js' },
        ...(meta.npmInstalled ? { npmInstalled: true } : {}),
      },
    }),
  )
}

async function fetchAsset(app: ReturnType<typeof pluginRoutes>, rel: string): Promise<string> {
  const res = await app.fetch(new Request('http://x' + rel))
  expect(res.status).toBe(200)
  return await res.text()
}

describe('/plugins/* 与清单同源', () => {
  it('★ 自带插件：数据根旧副本不生效，发随包新产物', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await writePlugin(global, 'plugin-manager', 'export const name = "OLD"')
    await writePlugin(packaged, 'plugin-manager', 'export const name = "NEW"')

    const text = await fetchAsset(pluginRoutes({ global, packaged }), '/plugins/plugin-manager/web.js')
    expect(text).toContain('NEW')
    expect(text).not.toContain('OLD')
  })

  it('NPM 安装副本仍然从全局发（用户装过的新版）', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await writePlugin(global, 'plugin-manager', 'export const name = "NPM"', { npmInstalled: true })
    await writePlugin(packaged, 'plugin-manager', 'export const name = "PKG"')

    const text = await fetchAsset(pluginRoutes({ global, packaged }), '/plugins/plugin-manager/web.js')
    expect(text).toContain('NPM')
  })

  it('非自带插件从全局发', async () => {
    const global = path.join(dir, 'global')
    const packaged = path.join(dir, 'packaged')
    await fs.mkdir(packaged, { recursive: true })
    await writePlugin(global, 'plugin-custom', 'export const name = "GLOBAL"')

    const text = await fetchAsset(pluginRoutes({ global, packaged }), '/plugins/plugin-custom/web.js')
    expect(text).toContain('GLOBAL')
  })
})

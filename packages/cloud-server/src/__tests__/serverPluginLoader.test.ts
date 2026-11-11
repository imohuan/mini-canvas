/**
 * 后台插件加载器 —— 一个插件一个目录，入口由 package.json 的 plume.server.entry 决定。
 *
 * 2026-11-12 起没有 server-plugins 扁平目录了。这里锁三件事：
 * 1. 读配置，不猜文件名（作者写 dist/my-server.js 也能加载）；
 * 2. 没声明后台入口的插件跳过（正常情况，不算错误）；
 * 3. 坏插件不影响其它，且会记一条 failure。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadServerPluginsFromPluginDirs } from '../serverFramework/pluginLoader.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-plugins-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const PLUGIN_SRC =
  'export const name = "hello"\nexport function apply(ctx) { ctx.routes.get("/api/hi", (c) => c.text("hi")) }\n'

/** 造一个插件目录：<name>/{package.json, <entry>} */
async function makePlugin(
  name: string,
  opts: { entry?: string; source?: string; packageJson?: unknown } = {},
): Promise<void> {
  const entry = opts.entry ?? 'dist/server.js'
  const pluginDir = path.join(dir, name)
  await fs.mkdir(path.dirname(path.join(pluginDir, entry)), { recursive: true })
  await fs.writeFile(path.join(pluginDir, entry), opts.source ?? PLUGIN_SRC, 'utf8')
  await fs.writeFile(
    path.join(pluginDir, 'package.json'),
    JSON.stringify(opts.packageJson ?? { name: '@plume-canvas/' + name, plume: { pluginName: name, server: { entry } } }),
    'utf8',
  )
}

describe('后台插件加载器（按配置读入口）', () => {
  it('目录不存在 → 空结果（不是错误）', async () => {
    const r = await loadServerPluginsFromPluginDirs(path.join(dir, 'nope'))
    expect(r.modules).toEqual([])
    expect(r.failures).toEqual([])
  })

  it('按 plume.server.entry 加载（导出 name + apply）', async () => {
    await makePlugin('plugin-hello')
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.failures).toEqual([])
    expect(r.modules.map((m) => m.name)).toEqual(['hello'])
    expect(r.sources).toEqual(['plugin-hello'])
  })

  it('★ 入口名不是 server.js 也照配置加载（dist/my-server.js）', async () => {
    await makePlugin('plugin-custom', { entry: 'dist/my-server.js' })
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.failures).toEqual([])
    expect(r.modules.map((m) => m.name)).toEqual(['hello'])
  })

  it('没声明 plume.server.entry → 跳过（纯前端插件是常态）', async () => {
    await makePlugin('plugin-web-only', {
      packageJson: { name: '@plume-canvas/plugin-web-only', plume: { pluginName: 'web-only' } },
    })
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.modules).toEqual([])
    expect(r.failures).toEqual([])
  })

  it('声明了入口但文件不存在 → 记 failure，说清缺哪个文件', async () => {
    const pluginDir = path.join(dir, 'plugin-missing')
    await fs.mkdir(pluginDir, { recursive: true })
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'x', plume: { pluginName: 'x', server: { entry: 'dist/server.js' } } }),
    )
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.modules).toEqual([])
    expect(r.failures[0]?.file).toBe('plugin-missing/dist/server.js')
  })

  it('坏文件不影响其它（记 failures、继续扫）', async () => {
    await makePlugin('plugin-bad', { source: 'this is not valid js at all (((' })
    await makePlugin('plugin-good')
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.modules.map((m) => m.name)).toEqual(['hello'])
    expect(r.failures).toHaveLength(1)
  })

  it('不是插件形状的产物 → 记 failure（缺 name/apply）', async () => {
    await makePlugin('plugin-notplugin', { source: 'export const foo = 1\n' })
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.modules).toEqual([])
    expect(r.failures).toHaveLength(1)
  })

  it('跳过 _ / . 开头的目录', async () => {
    await makePlugin('_skip')
    await makePlugin('.hidden')
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.modules).toEqual([])
  })

  it('入口写成绝对路径 / 含 .. → 拒绝（不读包外文件）', async () => {
    await makePlugin('plugin-evil', {
      packageJson: { name: 'x', plume: { pluginName: 'x', server: { entry: '../../outside.js' } } },
    })
    const r = await loadServerPluginsFromPluginDirs(dir)
    expect(r.modules).toEqual([])
    expect(r.failures[0]?.error).toContain('包内相对路径')
  })
})

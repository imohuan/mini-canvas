/**
 * 后台插件加载器（Task 4）——「丢一个 .js 进目录 = 多一个后台插件」。
 *
 * 与 providers/load.ts 对称：那边加载的是平台提供方，这边加载的是**任意后台插件**
 * （{name, inject?, apply} 形态，能注册路由/中间件/服务）。
 *
 * 安全边界照抄 providers/load.ts 的既有决策：只扫显式目录、不跟软链、不递归、
 * 单文件失败不影响其它。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadServerPluginsFromDir } from '../serverFramework/pluginLoader.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-plugins-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const PLUGIN_SRC = 'export const name = "hello"\nexport function apply(ctx) { ctx.routes.get("/api/hi", (c) => c.text("hi")) }\n'

describe('后台插件加载器', () => {
  it('目录不存在 → 空结果（不是错误）', async () => {
    const r = await loadServerPluginsFromDir(path.join(dir, 'nope'))
    expect(r.modules).toEqual([])
    expect(r.failures).toEqual([])
  })

  it('加载一个合法的插件文件（导出 name + apply）', async () => {
    await fs.writeFile(path.join(dir, 'hello.js'), PLUGIN_SRC)
    const r = await loadServerPluginsFromDir(dir)
    expect(r.failures).toEqual([])
    expect(r.modules.map((m) => m.name)).toEqual(['hello'])
  })

  it('支持 default 整体导出', async () => {
    await fs.writeFile(path.join(dir, 'def.js'), 'export default { name: "viadefault", apply() {} }\n')
    const r = await loadServerPluginsFromDir(dir)
    expect(r.modules.map((m) => m.name)).toEqual(['viadefault'])
  })

  it('坏文件不影响其它（记 failures、继续扫）', async () => {
    await fs.writeFile(path.join(dir, 'bad.js'), 'this is not valid js at all (((')
    await fs.writeFile(path.join(dir, 'good.js'), 'export const name = "good"\nexport function apply() {}\n')
    const r = await loadServerPluginsFromDir(dir)
    expect(r.modules.map((m) => m.name)).toEqual(['good'])
    expect(r.failures.map((f) => f.file)).toEqual(['bad.js'])
  })

  it('不是插件形状的文件 → 记 failure（缺 name/apply）', async () => {
    await fs.writeFile(path.join(dir, 'notplugin.js'), 'export const foo = 1\n')
    const r = await loadServerPluginsFromDir(dir)
    expect(r.modules).toEqual([])
    expect(r.failures).toHaveLength(1)
  })

  it('跳过 _ / . 开头的文件与子目录（不递归）', async () => {
    await fs.writeFile(path.join(dir, '_skip.js'), 'export const name = "skip"\nexport function apply() {}\n')
    await fs.mkdir(path.join(dir, 'sub'))
    await fs.writeFile(path.join(dir, 'sub', 'nested.js'), 'export const name = "nested"\nexport function apply() {}\n')
    const r = await loadServerPluginsFromDir(dir)
    expect(r.modules).toEqual([])
  })
})

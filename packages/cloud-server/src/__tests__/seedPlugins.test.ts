/**
 * seedPlugins —— 首启把随包插件铺到数据根。
 *
 * 锁三条（都是用户会被坑的场景）：
 * 1. 数据根没有 → 整目录复制（首启可用）；
 * 2. 数据根版本更高（用户自己更新过）→ 不动，不能被旧包盖回去；
 * 3. 包内版本更高（发了新版）→ 覆盖成新产物。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedPlugins, seedServerPlugins } from '../plugins/seedPlugins.js'

let root: string
let src: string
let dest: string

/** 造一个插件目录：<base>/<name>/{package.json, dist/web.js} */
async function makePlugin(base: string, name: string, version: string, marker: string): Promise<void> {
  const dir = path.join(base, name)
  await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@plume-canvas/' + name, version }))
  await fs.writeFile(path.join(dir, 'dist', 'web.js'), marker)
}

const markerOf = (dir: string) => fs.readFile(path.join(dir, 'dist', 'web.js'), 'utf8')

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-seed-'))
  src = path.join(root, 'assets')
  dest = path.join(root, 'data', 'plugins')
  await fs.mkdir(src, { recursive: true })
  await fs.mkdir(dest, { recursive: true })
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('seedPlugins：首启铺入 + 版本比较', () => {
  it('目标没有 → 复制进去（含 dist 与 package.json）', async () => {
    await makePlugin(src, 'plugin-a', '1.0.0', 'v1')
    const r = await seedPlugins(src, dest)
    expect(r.added).toEqual(['plugin-a'])
    expect(await markerOf(path.join(dest, 'plugin-a'))).toBe('v1')
    const pkg = JSON.parse(await fs.readFile(path.join(dest, 'plugin-a', 'package.json'), 'utf8'))
    expect(pkg.version).toBe('1.0.0')
  })

  it('数据根版本更高（用户自己更新过）→ 跳过，不覆盖', async () => {
    await makePlugin(src, 'plugin-a', '1.0.0', 'old')
    await makePlugin(dest, 'plugin-a', '2.0.0', 'new')
    const r = await seedPlugins(src, dest)
    expect(r.skipped).toEqual(['plugin-a'])
    expect(r.updated).toEqual([])
    expect(await markerOf(path.join(dest, 'plugin-a'))).toBe('new')
  })

  it('包内版本更高 → 覆盖成新产物', async () => {
    await makePlugin(src, 'plugin-a', '2.0.0', 'new')
    await makePlugin(dest, 'plugin-a', '1.0.0', 'old')
    const r = await seedPlugins(src, dest)
    expect(r.updated).toEqual(['plugin-a'])
    expect(await markerOf(path.join(dest, 'plugin-a'))).toBe('new')
  })

  it('版本相同 → 跳过（不白改磁盘，也不动用户改过的文件）', async () => {
    await makePlugin(src, 'plugin-a', '1.0.0', 'pkg')
    await makePlugin(dest, 'plugin-a', '1.0.0', 'local')
    const r = await seedPlugins(src, dest)
    expect(r.skipped).toEqual(['plugin-a'])
    expect(await markerOf(path.join(dest, 'plugin-a'))).toBe('local')
  })

  it('源目录不存在 / 目录里没有 package.json 的条目都安静跳过', async () => {
    expect((await seedPlugins(path.join(root, 'nope'), dest)).added).toEqual([])
    await fs.mkdir(path.join(src, 'not-a-plugin'), { recursive: true })
    const r = await seedPlugins(src, dest)
    expect(r.added).toEqual([])
    await expect(fs.access(path.join(dest, 'not-a-plugin'))).rejects.toThrow()
  })
})

describe('seedServerPlugins：内置插件的后台半铺成扁平 js', () => {
  /** 造一个带后台半的插件目录：<base>/<name>/{package.json, dist/server.js} */
  async function makeWithServer(base: string, name: string, version: string, marker: string): Promise<void> {
    const dir = path.join(base, name)
    await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@plume-canvas/' + name, version }))
    await fs.writeFile(path.join(dir, 'dist', 'server.js'), marker)
  }

  it('铺成 <名字>.js（扁平，与加载器一致），并记下版本', async () => {
    await makeWithServer(src, 'plugin-node-ui', '1.0.0', 'server-v1')
    const written = await seedServerPlugins(src, dest)
    expect(written).toEqual(['plugin-node-ui.js'])
    expect(await fs.readFile(path.join(dest, 'plugin-node-ui.js'), 'utf8')).toBe('server-v1')
  })

  it('版本不更高 → 不覆盖（用户/上次装的那份保留）', async () => {
    await makeWithServer(src, 'plugin-node-ui', '1.0.0', 'server-v1')
    await seedServerPlugins(src, dest)
    await fs.writeFile(path.join(dest, 'plugin-node-ui.js'), 'user-patched')
    const again = await seedServerPlugins(src, dest)
    expect(again).toEqual([])
    expect(await fs.readFile(path.join(dest, 'plugin-node-ui.js'), 'utf8')).toBe('user-patched')
  })

  it('包内版本更高 → 覆盖', async () => {
    await makeWithServer(src, 'plugin-node-ui', '1.0.0', 'server-v1')
    await seedServerPlugins(src, dest)
    await makeWithServer(src, 'plugin-node-ui', '2.0.0', 'server-v2')
    const written = await seedServerPlugins(src, dest)
    expect(written).toEqual(['plugin-node-ui.js'])
    expect(await fs.readFile(path.join(dest, 'plugin-node-ui.js'), 'utf8')).toBe('server-v2')
  })

  it('没有 dist/server.js 的插件不产生后台文件', async () => {
    await makePlugin(src, 'plugin-text', '1.0.0', 'web-only')
    expect(await seedServerPlugins(src, dest)).toEqual([])
    await expect(fs.access(path.join(dest, 'plugin-text.js'))).rejects.toThrow()
  })
})

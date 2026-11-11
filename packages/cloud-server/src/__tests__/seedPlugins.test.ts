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
import { cleanupLegacyServerPlugins, seedPlugins } from '../plugins/seedPlugins.js'

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

describe('cleanupLegacyServerPlugins：清掉与插件目录重复的扁平旧副本', () => {
  /** 造一个插件目录（可带后台半） */
  async function makePluginDir(base: string, name: string, withServer: boolean): Promise<void> {
    const dir = path.join(base, name)
    await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@plume-canvas/' + name }))
    await fs.writeFile(path.join(dir, 'dist', 'web.js'), 'web')
    if (withServer) await fs.writeFile(path.join(dir, 'dist', 'server.js'), 'server')
  }

  it('插件目录里有同名后台半 → 删掉扁平旧副本（否则启动报 Duplicate plugin name）', async () => {
    await makePluginDir(dest, 'plugin-node-video', true)
    const legacy = path.join(root, 'server-plugins')
    await fs.mkdir(legacy, { recursive: true })
    await fs.writeFile(path.join(legacy, 'plugin-node-video.js'), 'old-flat-copy')
    const removed = await cleanupLegacyServerPlugins(dest, legacy)
    expect(removed).toEqual(['plugin-node-video.js'])
    await expect(fs.access(path.join(legacy, 'plugin-node-video.js'))).rejects.toThrow()
  })

  it('使用者自己额外丢的后台插件（插件目录里没有同名）→ 保留', async () => {
    await makePluginDir(dest, 'plugin-node-text', false)
    const legacy = path.join(root, 'server-plugins')
    await fs.mkdir(legacy, { recursive: true })
    await fs.writeFile(path.join(legacy, 'my-extra.js'), 'extra')
    const removed = await cleanupLegacyServerPlugins(dest, legacy)
    expect(removed).toEqual([])
    await expect(fs.access(path.join(legacy, 'my-extra.js'))).resolves.toBeUndefined()
  })

  it('同名但插件没有后台半 → 不删（那份扁平件可能就是它唯一的后台半）', async () => {
    await makePluginDir(dest, 'plugin-node-text', false)
    const legacy = path.join(root, 'server-plugins')
    await fs.mkdir(legacy, { recursive: true })
    await fs.writeFile(path.join(legacy, 'plugin-node-text.js'), 'user-added')
    const removed = await cleanupLegacyServerPlugins(dest, legacy)
    expect(removed).toEqual([])
  })

  it('文件名与插件目录名不同、但导出的插件名相同 → 也清掉（plugin-video-crop.js vs plugin-node-video）', async () => {
    // 真实踩过的情况：旧副本叫 plugin-video-crop.js，导出的 name 是 video-crop；
    // 正式插件是 plugin-node-video，同样导出 video-crop —— 两者同名，启动直接报重复。
    const dir = path.join(dest, 'plugin-node-video')
    await fs.mkdir(path.join(dir, 'dist'), { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@plume-canvas/plugin-node-video' }))
    await fs.writeFile(path.join(dir, 'dist', 'server.js'), 'var name = "video-crop"\nexport { name }')
    const legacy = path.join(root, 'server-plugins')
    await fs.mkdir(legacy, { recursive: true })
    await fs.writeFile(path.join(legacy, 'plugin-video-crop.js'), 'old')
    const removed = await cleanupLegacyServerPlugins(dest, legacy)
    expect(removed).toEqual(['plugin-video-crop.js'])
  })
})


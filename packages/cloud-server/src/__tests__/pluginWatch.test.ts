import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pluginsDirSignature, watchPluginDirs } from '../plugins/pluginWatch'

/** 造一个插件目录：<root>/<pkg>/dist/<file>.js */
async function makePlugin(root: string, pkg: string, file: string, content: string, mtimeMs?: number): Promise<void> {
  const dist = path.join(root, pkg, 'dist')
  await mkdir(dist, { recursive: true })
  const f = path.join(dist, file)
  await writeFile(f, content, 'utf8')
  if (mtimeMs !== undefined) {
    const sec = mtimeMs / 1000
    await utimes(f, sec, sec)
  }
}

describe('pluginsDirSignature', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mc-plugin-watch-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('没 dist 的插件不参与签名（改源码不算）', async () => {
    await mkdir(path.join(root, 'plugin-no-dist', 'src'), { recursive: true })
    await writeFile(path.join(root, 'plugin-no-dist', 'src', 'index.ts'), 'export const name = "x"', 'utf8')
    expect(await pluginsDirSignature(root)).toBe('')
  })

  it('有 dist 的插件进签名；产物内容一变签名就变', async () => {
    await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v1', 1_000_000)
    const s1 = await pluginsDirSignature(root)
    expect(s1).toContain('plugin-a=')

    await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v2-longer', 2_000_000)
    const s2 = await pluginsDirSignature(root)
    expect(s2).not.toBe(s1)
  })

  it('碰一下文件但内容与 mtime 都没变 → 签名不变（不白通知）', async () => {
    await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v1', 1_000_000)
    const s1 = await pluginsDirSignature(root)
    const s2 = await pluginsDirSignature(root)
    expect(s2).toBe(s1)
  })

  it('_ 与 . 开头的插件目录不参与', async () => {
    await makePlugin(root, '_hidden', '_hidden.js', 'x', 1_000_000)
    await makePlugin(root, '.temp', '.temp.js', 'x', 1_000_000)
    expect(await pluginsDirSignature(root)).toBe('')
  })

  it('目录不存在 → 空签名（不抛）', async () => {
    expect(await pluginsDirSignature(path.join(root, 'nope'))).toBe('')
  })
})

describe('watchPluginDirs', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mc-plugin-watch-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('第一趟只取基准（不报变更），产物变了才报', async () => {
    await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v1', 1_000_000)
    const w = watchPluginDirs(root, () => {}, 50)
    try {
      const first = await w.check() // 取基准
      expect(first).toEqual([])

      // 产物变了（换个 mtime）
      await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v2', 3_000_000)
      const second = await w.check()
      expect(second).toHaveLength(1)
      expect(second[0]!.id).toBe('plugin-a')
      expect(second[0]!.name).toBe('plugin-a') // 没有 package.json 时回落目录名

      // 再查一次：没变 → 空
      expect(await w.check()).toEqual([])
    } finally {
      w.stop()
    }
  })

  it('读得到 package.json 的 miniCanvas.pluginName（报的是运行时名）', async () => {
    await makePlugin(root, 'plugin-style-library', 'plugin-style-library.js', 'v1', 1_000_000)
    await writeFile(
      path.join(root, 'plugin-style-library', 'package.json'),
      JSON.stringify({ name: '@mini-canvas/plugin-style-library', miniCanvas: { pluginName: 'style-library' } }),
      'utf8',
    )
    const w = watchPluginDirs(root, () => {}, 50)
    try {
      await w.check() // 基准
      await makePlugin(root, 'plugin-style-library', 'plugin-style-library.js', 'v2', 3_000_000)
      const changes = await w.check()
      expect(changes[0]!.name).toBe('style-library')
      expect(changes[0]!.id).toBe('plugin-style-library')
    } finally {
      w.stop()
    }
  })

  it('定时器到点会自动回调变更', async () => {
    await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v1', 1_000_000)
    const seen: Array<{ id: string }> = []
    const w = watchPluginDirs(root, (cs) => { for (const c of cs) seen.push(c) }, 40)
    try {
      await new Promise((r) => setTimeout(r, 90)) // 让基准先取到
      await makePlugin(root, 'plugin-a', 'plugin-a.js', 'v2', 5_000_000)
      await new Promise((r) => setTimeout(r, 160)) // 等一两个 tick
      expect(seen.map((s) => s.id)).toContain('plugin-a')
    } finally {
      w.stop()
    }
  })
})


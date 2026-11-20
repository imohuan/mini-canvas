/**
 * builtinManifest —— 内置清单的读与生成（发布体系 Task 1）。
 *
 * 清单是 server 包内的 JSON（dist/builtin-manifest.json），
 * 由 gen-builtin-manifest.mjs 从 BUILTIN_PLUGINS 生成；
 * bootstrap 启动时读它决定「该装哪些插件、什么版本」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readBuiltinManifest } from '../updater/builtinManifest.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-manifest-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('readBuiltinManifest', () => {
  it('gen 脚本产物形状：键是 npm 包名（防键形态漂移）', async () => {
    await fs.writeFile(path.join(dir, 'builtin-manifest.json'), JSON.stringify({
      plugins: { '@plume-canvas/plugin-agent': 'latest' },
    }))
    const m = await readBuiltinManifest(dir)
    const keys = Object.keys(m.plugins)
    expect(keys.every((k) => /^@[a-z0-9-]+\//.test(k) || /^[a-z0-9-]+$/.test(k))).toBe(true)
    expect(m.plugins['@plume-canvas/plugin-agent']).toBe('latest')
  })

  it('读到 plugins 段并解析成对象', async () => {
    await fs.writeFile(path.join(dir, 'builtin-manifest.json'), JSON.stringify({
      plugins: { 'plugin-agent': 'latest', 'plugin-node-text': '0.1.0' },
    }))
    const m = await readBuiltinManifest(dir)
    expect(m.plugins['plugin-agent']).toBe('latest')
    expect(m.plugins['plugin-node-text']).toBe('0.1.0')
  })

  it('文件缺失 → 返回空 plugins，不抛错', async () => {
    const m = await readBuiltinManifest(dir)
    expect(m.plugins).toEqual({})
  })

  it('JSON 坏了 → 返回空 plugins，不抛错', async () => {
    await fs.writeFile(path.join(dir, 'builtin-manifest.json'), 'not-json{')
    const m = await readBuiltinManifest(dir)
    expect(m.plugins).toEqual({})
  })
})

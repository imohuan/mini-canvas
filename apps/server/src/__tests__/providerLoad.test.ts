/**
 * provider 目录装载单测 —— 真写文件、真 import。
 *
 * 锁的是「后台的投递箱」这条承诺：往目录里丢一个 .js，它就成了一个平台。
 * 同时锁住几条边界：坏文件不该把服务带崩、非 .js / 下划线开头的不扫、
 * 目录不存在不是错误（可以一个外挂都没有）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadProvidersFromDir } from '../providers/load'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'providers-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const GOOD = `
export const id = 'my-platform'
export const actions = [{ id: 'my-platform:txt2img', title: '我的模型', nodeTypes: ['image'] }]
export async function submit() { return { done: true, urls: ['https://x/1.png'] } }
`

describe('从目录装载 provider', () => {
  it('丢一个 .js 进去就成了一个平台', async () => {
    await fs.writeFile(path.join(dir, 'my-platform.js'), GOOD)
    const { providers, failures } = await loadProvidersFromDir(dir)
    expect(failures).toEqual([])
    expect(providers).toHaveLength(1)
    expect(providers[0].id).toBe('my-platform')
    expect(providers[0].actions[0].id).toBe('my-platform:txt2img')
    expect(typeof providers[0].submit).toBe('function')
  })

  it('目录不存在 → 空（不是错误：可以一个外挂都没有）', async () => {
    const { providers, failures } = await loadProvidersFromDir(path.join(dir, 'nope'))
    expect(providers).toEqual([])
    expect(failures).toEqual([])
  })

  it('坏文件不影响其它（记下来、继续扫）', async () => {
    await fs.writeFile(path.join(dir, 'good.js'), GOOD)
    await fs.writeFile(path.join(dir, 'broken.js'), 'export const id = ;;; this is not js')
    const { providers, failures } = await loadProvidersFromDir(dir)
    expect(providers.map((p) => p.id)).toEqual(['my-platform'])
    expect(failures).toHaveLength(1)
    expect(failures[0].file).toBe('broken.js')
  })

  it('形状不对的 js（没有 actions / submit）被挡下，不当成 provider', async () => {
    await fs.writeFile(path.join(dir, 'notprovider.js'), 'export const hello = 1')
    const { providers, failures } = await loadProvidersFromDir(dir)
    expect(providers).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toContain('不是合法 provider')
  })

  it('非 .js 与下划线开头的文件不扫（_ 是"暂时关掉"的约定）', async () => {
    await fs.writeFile(path.join(dir, 'readme.md'), GOOD)
    await fs.writeFile(path.join(dir, '_disabled.js'), GOOD)
    await fs.writeFile(path.join(dir, '.hidden.js'), GOOD)
    const { providers } = await loadProvidersFromDir(dir)
    expect(providers).toEqual([])
  })

  it('支持 default 整体导出（两种写法都认）', async () => {
    await fs.writeFile(
      path.join(dir, 'via-default.js'),
      'export default { id: "d", actions: [{ id: "d:a", title: "A" }], async submit() { return { done: true } } }',
    )
    const { providers } = await loadProvidersFromDir(dir)
    expect(providers.map((p) => p.id)).toEqual(['d'])
  })
})

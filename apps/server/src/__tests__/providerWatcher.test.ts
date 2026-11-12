/**
 * provider 目录变更检测单测 —— 「改后台 → 前端菜单跟着变」的前半段。
 *
 * 锁三件事：内容变了签名就变；无关文件（README 之类）不触发；删掉的文件也从签名里消失。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { providerDirSignature, watchProviders } from '../providers/watch'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'providerwatch-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('provider 目录签名', () => {
  it('目录不存在 → 空签名（与"一个 provider 都没有"等价）', async () => {
    expect(await providerDirSignature(path.join(dir, 'nope'))).toBe('')
  })

  it('丢进一个 provider → 签名变化', async () => {
    const before = await providerDirSignature(dir)
    await fs.writeFile(path.join(dir, 'p.js'), 'export const id = "p"')
    const after = await providerDirSignature(dir)
    expect(after).not.toBe(before)
  })

  it('内容改了（大小或时间变）→ 签名变化', async () => {
    const f = path.join(dir, 'p.js')
    await fs.writeFile(f, 'export const id = "p"')
    const before = await providerDirSignature(dir)
    await new Promise((r) => setTimeout(r, 20))
    await fs.writeFile(f, 'export const id = "p"; export const extra = 1234567890')
    expect(await providerDirSignature(dir)).not.toBe(before)
  })

  it('无关文件（非 .js / 下划线开头）不参与签名', async () => {
    const before = await providerDirSignature(dir)
    await fs.writeFile(path.join(dir, 'README.md'), 'hello')
    await fs.writeFile(path.join(dir, '_off.js'), 'export const id = "off"')
    expect(await providerDirSignature(dir)).toBe(before)
  })

  it('删掉 provider → 签名回到之前的样子（删干净）', async () => {
    const empty = await providerDirSignature(dir)
    const f = path.join(dir, 'p.js')
    await fs.writeFile(f, 'export const id = "p"')
    expect(await providerDirSignature(dir)).not.toBe(empty)
    await fs.rm(f)
    expect(await providerDirSignature(dir)).toBe(empty)
  })
})

describe('目录监视：真能发现"第一次丢进来的 provider"', () => {
  /**
   * 这条是真出过的 bug：目录一开始不存在（签名是空串），
   * 若拿空串当"还没取基准"，那么第一次丢进 provider 会被当成基准记下来、不触发回调 ——
   * 表现就是"明明丢进去了，前端菜单没变"。
   */
  it('目录先前不存在 → 之后丢进第一个 provider，回调要触发', async () => {
    const target = path.join(dir, 'providers') // 先不存在
    let fired = 0
    const w = watchProviders(target, () => {
      fired += 1
    }, 20)
    try {
      await new Promise((r) => setTimeout(r, 80)) // 等它取完基准
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(path.join(target, 'p.js'), 'export const id = "p"')
      await new Promise((r) => setTimeout(r, 150))
      expect(fired).toBeGreaterThan(0)
    } finally {
      w.stop()
    }
  })

  it('没有任何变化时不触发（别白通知）', async () => {
    let fired = 0
    const w = watchProviders(dir, () => {
      fired += 1
    }, 20)
    try {
      await new Promise((r) => setTimeout(r, 150))
      expect(fired).toBe(0)
    } finally {
      w.stop()
    }
  })
})

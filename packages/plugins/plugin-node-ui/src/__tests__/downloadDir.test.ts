/**
 * 打包落到**本机下载目录**（用户口径 2026-10-14）：
 * 「调试通过之后自动打包成一个 zip 文件，保存到默认的下载地址。
 *  不然的话，你的这个节点一删，后台就完全没有意义了，还要重新写 HTML 代码」。
 *
 * 这里钉两条最容易出事的规矩：**不覆盖同名文件**（旧那份是用户的保命符）、
 * **文件名不能带路径分隔符**（防目录穿越）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { downloadDirCandidates, safeDownloadFileName, saveToDownloads, uniqueDownloadPath } from '../task/downloadDir'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-dl-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('文件名消毒', () => {
  it('补后缀；已带就不重复加', () => {
    expect(safeDownloadFileName('视频可视化')).toBe('视频可视化.mcnode')
    expect(safeDownloadFileName('x.mcnode')).toBe('x.mcnode')
  })

  it('★ 路径分隔符与非法字符被换掉（不许穿越出去）', () => {
    const name = safeDownloadFileName('../../etc/passwd')
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
    expect(name).not.toContain('..')
    expect(name.endsWith('.mcnode')).toBe(true)
  })

  it('空名 → 回落一个安全默认名', () => {
    expect(safeDownloadFileName('   ')).toBe('节点包.mcnode')
  })
})

describe('★ 不覆盖同名文件（旧那份是用户的保命符）', () => {
  it('第一个同名可用；已存在就往后加号', async () => {
    const first = await uniqueDownloadPath(dir, 'a.mcnode')
    expect(path.basename(first)).toBe('a.mcnode')
    await fs.writeFile(first, 'x')
    const second = await uniqueDownloadPath(dir, 'a.mcnode')
    expect(path.basename(second)).toBe('a (2).mcnode')
    await fs.writeFile(second, 'x')
    const third = await uniqueDownloadPath(dir, 'a.mcnode')
    expect(path.basename(third)).toBe('a (3).mcnode')
  })
})

describe('saveToDownloads', () => {
  it('写到指定目录（测试用 MINI_CANVAS_DOWNLOAD_DIR 指过来），返回绝对路径', async () => {
    const prev = process.env.MINI_CANVAS_DOWNLOAD_DIR
    process.env.MINI_CANVAS_DOWNLOAD_DIR = dir
    try {
      const r = await saveToDownloads(new Uint8Array([1, 2, 3]), 'demo')
      expect(r.path).toBe(path.join(dir, 'demo.mcnode'))
      expect(r.bytes).toBe(3)
      expect([...(await fs.readFile(r.path))]).toEqual([1, 2, 3])
      // 第二次不覆盖
      const r2 = await saveToDownloads(new Uint8Array([9]), 'demo')
      expect(path.basename(r2.path)).toBe('demo (2).mcnode')
      expect([...(await fs.readFile(path.join(dir, 'demo.mcnode')))]).toEqual([1, 2, 3])
    } finally {
      if (prev === undefined) delete process.env.MINI_CANVAS_DOWNLOAD_DIR
      else process.env.MINI_CANVAS_DOWNLOAD_DIR = prev
    }
  })

  it('候选目录里第一个是环境变量（测试 / 特殊部署能定向）', () => {
    const prev = process.env.MINI_CANVAS_DOWNLOAD_DIR
    process.env.MINI_CANVAS_DOWNLOAD_DIR = 'X:/somewhere'
    try {
      expect(downloadDirCandidates()[0]).toBe('X:/somewhere')
    } finally {
      if (prev === undefined) delete process.env.MINI_CANVAS_DOWNLOAD_DIR
      else process.env.MINI_CANVAS_DOWNLOAD_DIR = prev
    }
  })
})

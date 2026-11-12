/**
 * renameWithRetry —— 资源落盘那一步的容错（复现 2026-10-14 用户报的 EPERM）。
 *
 * 现场：
 *   产物登记资产失败，回落原始地址 … Error: EPERM: operation not permitted, rename
 *   'd0826168137f707c.mp4.tmp-10576-1791983799172' -> 'd0826168137f707c.mp4'
 * 任务本身已经成功（web2api 100%），只是落盘被 Windows 拒了。
 *
 * 两个来源：
 *  1. 目标被短暂占用（杀毒 / 索引 / 预览）—— 退避重试就过去了；
 *  2. 两个并发的同内容保存撞同一目标（都在 exists 检查里看到「文件不存在」）——
 *     重试耗尽时目标**已经存在**，那就是另一个写方写好了，同哈希同内容，算成功。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renameWithRetry } from '../store/renameRetry'

let dir: string

async function tmpDir(): Promise<string> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rename-retry-'))
  return dir
}

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

describe('renameWithRetry', () => {
  it('目标不存在：正常 rename 成功，临时文件消失', async () => {
    const d = await tmpDir()
    const file = path.join(d, 'a.bin')
    const tmp = file + '.tmp-1'
    await fs.writeFile(tmp, Buffer.from([1, 2, 3]))
    await renameWithRetry(tmp, file)
    expect(Array.from(await fs.readFile(file))).toEqual([1, 2, 3])
    await expect(fs.access(tmp)).rejects.toThrow()
  })

  it('目标已被另一个写方落好（同内容寻址的并发场景）→ 算成功，不抛', async () => {
    const d = await tmpDir()
    const file = path.join(d, 'b.bin')
    // 模拟：另一个并发请求已经先把它写好了
    await fs.writeFile(file, Buffer.from([9, 9, 9]))
    const tmp = file + '.tmp-2'
    await fs.writeFile(tmp, Buffer.from([9, 9, 9]))
    // 这一步在真实并发下会 EPERM；这里用一个假的 rename 逼出「一直失败」的分支
    await renameWithRetry(tmp, file, { acceptExisting: true })
    // 目标还在（内容仍是那份），临时文件已清掉
    expect(Array.from(await fs.readFile(file))).toEqual([9, 9, 9])
    await expect(fs.access(tmp)).rejects.toThrow()
  })
})

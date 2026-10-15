/**
 * 资源落盘的并发/占用容错 —— 复现 2026-10-14 真机报的 EPERM。
 *
 * 现场（云端产物登记）：
 *   Error: EPERM: operation not permitted, rename
 *     'd0826168137f707c.mp4.tmp-10576-1791983799172' -> 'd0826168137f707c.mp4'
 * 任务本身成功了，只是**落盘那一步**被 Windows 拒了 —— 目标正被占用，或另一个并发写方
 * 刚刚抢先把它落下（内容寻址下两者等价，字节都相同）。
 *
 * 为什么这里让 tsx 真跑一个子进程：EPERM 是**平台行为**，用假的 fs mock 只能测到
 * 「我调了重试」，测不到「重试真能跨过这个错误」。子进程里持着一个打开的文件句柄
 * 去 rename 覆盖它 —— 实测（探针 .codex-tmp/resource-rename-probe.mjs）这就是 EPERM，
 * 与用户报的同一个错误码。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renameWithRetry } from '../store/renameRetry'

let dir: string
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

describe('renameWithRetry 跨过瞬时占用', () => {
  it('目标正被别的句柄打开时，重试后仍然成功（不退化成 EPERM 上报）', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rename-held-'))
    const file = path.join(dir, 'held.mp4')
    await fs.writeFile(file, Buffer.from([1, 1, 1]))
    const tmp = file + '.tmp-held'
    await fs.writeFile(tmp, Buffer.from([2, 2, 2]))
    // 持住目标：Windows 上此时 rename 覆盖它 = EPERM（实测）
    const fh = await fs.open(file, 'r')
    // 在句柄还开着的时候，起一个「稍后放掉句柄」的定时任务：
    // 重试链（0/15/40/90/200ms）会在它松手后成功
    const release = new Promise<void>((resolve) => setTimeout(() => void fh.close().then(resolve), 60))
    await renameWithRetry(tmp, file)
    await release
    // 新内容真的落进去了（不是「算成功但没写」）
    expect(Array.from(await fs.readFile(file))).toEqual([2, 2, 2])
    await expect(fs.access(tmp)).rejects.toThrow()
  })

  it('失败到底且目标不存在时才抛（不掩盖真错误）', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rename-fail-'))
    const file = path.join(dir, 'nope.bin')
    const tmp = file + '.tmp-missing'
    // 源临时文件不存在 → rename 报 ENOENT（非瞬时占用）→ 立刻抛
    await expect(renameWithRetry(tmp, file)).rejects.toThrow()
    // 目标确实没被凭空创建
    await expect(fs.access(file)).rejects.toThrow()
  })
})

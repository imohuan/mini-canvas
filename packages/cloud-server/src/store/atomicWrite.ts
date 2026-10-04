/**
 * atomicWrite —— 原子写文件（先写唯一临时文件，再 rename 覆盖目标）。
 *
 * 为什么需要单独一层：cloud-server 有两处都靠"临时文件 + rename"避免读到半截 JSON ——
 * 画布文件夹（canvasStore）与 KV 存储（kvStore）。这一层把两处共用的细节收在一处。
 *
 * **为什么要对 rename 重试**：Windows 上 rename 覆盖一个**正被别人打开**的目标会直接
 * EPERM / EBUSY（"另一个程序正在使用此文件，进程无法访问"）。杀毒、系统索引、编辑器预览
 * 都可能短暂握住它。这不是逻辑错误，而是瞬时占用，几十毫秒就松手 —— 实测：并发写时偶发
 * 失败（表现为接口 500），退避重试一次即通过。所以这里退避重试几次，仍失败才抛（真出问题时
 * 不掩盖）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** rename 撞上"目标被短暂占用"的几种错误码（Windows 上是 EPERM/EBUSY/EACCES） */
function isTransientLock(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

/**
 * 退避序列即"最多试几次"：首轮立刻试，之后逐步拉长。
 * 总等待控制在 ~250ms 内 —— 瞬时占用几十毫秒就松手，等太久只会把一次请求拖成超时。
 */
const RETRY_DELAYS_MS = [0, 10, 25, 60, 150]

/**
 * 原子写入一段文本。
 *
 * @param file 目标文件绝对路径（父目录会自动创建）
 */
export async function atomicWriteText(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  // 临时名唯一化：同一毫秒、同一目标的两次写也不共用临时文件
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  await fs.writeFile(tmp, text, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (err) {
      if (!isTransientLock(err) || attempt >= RETRY_DELAYS_MS.length - 1) {
        // 放弃前把临时文件清掉，别在磁盘上留垃圾
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        throw err
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt + 1]))
    }
  }
}

/** 原子写入一个 JSON 值 */
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  return atomicWriteText(file, JSON.stringify(value))
}

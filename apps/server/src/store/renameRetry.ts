/**
 * renameWithRetry —— 原子写里那一步 rename 的**共用**容错层。
 *
 * ## 为什么需要（2026-10-14 真机报错）
 *
 * 产物登记时报 `EPERM: operation not permitted, rename 'xxx.mp4.tmp-<pid>-<ts>' -> 'xxx.mp4'`，
 * 任务本身已经成功（web2api 那边 100%），只是**落盘那一步**被系统拒了。
 *
 * 两个来源，都要在这里兜住：
 *
 * 1. **目标被短暂占用**：Windows 上 rename 覆盖一个正被打开/扫描的文件会直接
 *    EPERM / EBUSY / EACCES（杀毒、索引、播放器预览都可能握着它）。这不是逻辑错误，
 *    几十毫秒就松手 —— 与 atomicWrite.ts、canvasStore.ts 里已经踩过的同一个坑。
 * 2. **和另一个写方撞同一目标**：内容寻址的资源保存是「没有这个文件才写」
 *    （`if (!(await exists(file)))`），但两个并发的同内容保存会**同时**发现文件不存在，
 *    各自写一份临时文件、各自 rename 到同一个目标。第二个 rename 在 Windows 上会
 *    EPERM（实测：并发 5 次同内容保存，只有 2 次成功、3 次 EPERM）。
 *
 * ## 判成功的口径
 *
 * 重试耗尽后**再看一眼目标**：文件在 → 说明另一个写方已经把它落下了（同内容寻址下
 * 那份字节与本份相同），这就是成功，不是失败。只有「目标仍然不在」才抛原始错误 ——
 * 真出问题时不许掩盖，这一点与项目里其它容错层同口径。
 *
 * 无论成功失败，临时文件都要清掉（失败路径尤其重要：留在盘上就是垃圾，
 * 而且会让下一次「同内容保存」的 exists 判断更乱）。
 */
import { promises as fs } from 'node:fs'

/** rename 撞上「目标被短暂占用」的几种错误码（Windows 上是 EPERM/EBUSY/EACCES） */
function isTransientLock(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

/**
 * 退避序列即「最多试几次」：首轮立刻试，之后逐步拉长。
 * 总等待控制在 ~350ms 内 —— 瞬时占用几十毫秒就松手，等太久只会把一次请求拖成超时。
 */
const RETRY_DELAYS_MS = [0, 15, 40, 90, 200]

/** 目标文件在不在（不看内容，只看存在性） */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/**
 * 把临时文件原子地挪到目标位置，容忍瞬时占用与并发撞车。
 *
 * @param tmp  已写好的临时文件（调用方负责内容已经写进去）
 * @param file 目标路径
 * @param opts.acceptExisting 重试耗尽且目标已存在时，是否当作成功（默认 true）。
 *   内容寻址的资源保存传 true（同哈希 = 同字节，谁写的都一样）；
 *   覆盖槽位那种「原地换内容」也传 true —— 目标已存在就说明这一拍有别人写过，
 *   而这个接口本来就是 last-writer-wins 的语义，报错只会让产物白丢。
 */
export async function renameWithRetry(
  tmp: string,
  file: string,
  opts: { acceptExisting?: boolean } = {},
): Promise<void> {
  const acceptExisting = opts.acceptExisting ?? true
  let lastErr: unknown
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    try {
      await fs.rename(tmp, file)
      return
    } catch (err) {
      lastErr = err
      if (!isTransientLock(err)) break
    }
  }
  // 重试没成：先清掉临时文件，再判断「是不是别人已经写好了」
  await fs.rm(tmp, { force: true }).catch(() => undefined)
  if (acceptExisting && (await exists(file))) return
  throw lastErr
}

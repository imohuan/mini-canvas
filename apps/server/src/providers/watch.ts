/**
 * provider 目录的变更检测 —— 「改后台 → 前端菜单跟着变」的前半段。
 *
 * 为什么用**轮询比对内容签名**而不是 fs.watch：
 * fs.watch 在 Windows 上对"编辑器保存"的表现不一致（有的先删后建、有的写临时文件再改名），
 * 而且它不告诉你"内容到底变没变"。轮询一个几十字节的签名（文件名 + 大小 + 修改时间）
 * 每几秒一次，代价可以忽略，且跨平台行为一致。
 *
 * 签名比对的是**内容特征**：碰一下文件但内容没变，签名也不变，不会白通知一轮。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 算一个目录的内容签名。
 *
 * 只认会被扫的那些文件（`.js`、非 `_`/`.` 开头、普通文件），
 * 所以"丢进来一个无关文件（如 README）"不会触发重载。
 */
export async function providerDirSignature(dir: string): Promise<string> {
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return '' // 目录不存在 = 空签名（与"一个 provider 都没有"等价）
  }
  const parts: string[] = []
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.js')) continue
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue
    try {
      const st = await fs.stat(path.join(dir, e.name))
      parts.push(e.name + ':' + st.size + ':' + Math.round(st.mtimeMs))
    } catch {
      /* 文件在扫描间隙被删了：跳过，下一轮签名自然会变 */
    }
  }
  return parts.sort().join('|')
}

export interface ProviderWatcher {
  /** 立刻比对一次（启动时用，也用于测试） */
  check(): Promise<boolean>
  stop(): void
}

/**
 * 盯住目录；签名变了就调 `onChange`。
 *
 * @param intervalMs 轮询间隔（默认 3 秒：够快，且几乎不耗资源）
 * @param onChange    变更回调（由调用方去重扫 + 通知前端）
 */
export function watchProviders(
  dir: string,
  onChange: () => void | Promise<void>,
  intervalMs = 3000,
): ProviderWatcher {
  /**
   * 上次看到的签名。`null` = **还没取过基准**。
   *
   * 为什么不能拿空串当"没取过"：目录一开始就不存在时签名本来就是空串，
   * 那样"第一次真正发生变化"（比如刚丢进第一个 provider）会被当成基准记下来、不触发回调
   * —— 表现就是"明明丢进去了，菜单没变"。
   */
  let last: string | null = null
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function check(): Promise<boolean> {
    const sig = await providerDirSignature(dir)
    if (last === null) {
      last = sig // 取基准，不触发（启动时已经扫过一遍了）
      return false
    }
    if (sig === last) return false
    last = sig
    await onChange()
    return true
  }

  // 立刻取一次基准（不等第一个 tick，免得开局那 3 秒里的改动被当成基准吞掉）
  void check().catch(() => {
    /* 取基准失败无所谓：下一个 tick 会再取一次 */
  })

  timer = setInterval(() => {
    if (stopped) return
    void check().catch(() => {
      /* 单次比对失败不该把定时器带崩；下一轮会再试 */
    })
  }, intervalMs)

  return {
    check,
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

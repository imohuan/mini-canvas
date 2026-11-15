/**
 * 默认数据目录必须是 `~/.plume`，不能跟着启动目录跑。
 *
 * 踩过的坑：`pnpm start` 最后是在 `apps/server` 里执行 `serve`，
 * 之前默认值写成相对路径 `.plume`，数据就落到了 `apps/server/.plume`，
 * 和仓库根那个指向 `~/.plume` 的链接分成两份，画布看起来像丢了。
 */
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_DIR } from '../server.js'

describe('默认数据目录', () => {
  it('落在用户主目录下的 .plume，与启动目录无关', () => {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir()
    expect(path.isAbsolute(DEFAULT_DATA_DIR)).toBe(true)
    expect(path.resolve(DEFAULT_DATA_DIR)).toBe(path.resolve(home, '.plume'))
  })
})

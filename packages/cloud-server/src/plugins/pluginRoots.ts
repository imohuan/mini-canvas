/**
 * pluginRoots —— 插件目录的两层来源（2026-11-12 用户口径）。
 *
 * - **全局目录** `<数据根>/plugins`：优先级最高。安装、更新都落这里，
 *   更新就是真的改这一个目录里的内容；
 * - **随包目录** `cloud-server/assets/plugins`：只读兜底。
 *
 * 所以「一个插件在哪」是**按插件**解析的，不是「整个目录二选一」。
 * 首次运行也**不需要复制**：全局没有就用随包那份，等用户装了/更新了，
 * 全局那份自然浮到前面。
 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export interface PluginRoots {
  /** 全局目录（可写）：安装 / 更新 / 用户自己放插件都在这里 */
  global: string
  /** 随包目录（只读兜底）；没有就 undefined */
  packaged?: string
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 组装两个根。全局目录**不预先创建**：调用方需要写的时候自己建，
 * 这样「只读部署」不会因为读插件就在数据根里多出一个空目录。
 */
export async function resolvePluginRoots(dataDir: string, packagedDir: string): Promise<PluginRoots> {
  const packaged = (await isDir(packagedDir)) ? path.resolve(packagedDir) : undefined
  return {
    global: path.resolve(path.join(dataDir, 'plugins')),
    ...(packaged ? { packaged } : {}),
  }
}

/** 两个根里出现过的插件目录名（并集，排好序；跳过 `.` / `_` 开头的临时目录） */
export async function listPluginIds(roots: PluginRoots): Promise<string[]> {
  const ids = new Set<string>()
  for (const root of [roots.global, roots.packaged]) {
    if (!root) continue
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.') || name.startsWith('_')) continue
      if (await isDir(path.join(root, name))) ids.add(name)
    }
  }
  return [...ids].sort()
}

/**
 * 单个插件实际生效的目录：**全局优先**，全局没有才用随包那份。
 * 都没有 → undefined（调用方按「这个插件不存在」处理）。
 */
export async function resolvePluginDir(roots: PluginRoots, id: string): Promise<string | undefined> {
  if (id.startsWith('.') || id.startsWith('_') || id.includes('/') || id.includes('\\')) return undefined
  for (const root of [roots.global, roots.packaged]) {
    if (!root) continue
    const dir = path.join(root, id)
    if (await isDir(dir)) return dir
  }
  return undefined
}

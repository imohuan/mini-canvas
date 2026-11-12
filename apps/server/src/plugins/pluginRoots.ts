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
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { BUILTIN_BY_DIR } from './builtinPlugins.js'

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

/** 该目录的 package.json 是否声明了 `plume.npmInstalled: true`（NPM 安装副本的显式标记） */
async function isNpmInstalledDir(dir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
      plume?: { npmInstalled?: unknown }
    }
    return pkg.plume?.npmInstalled === true
  } catch {
    return false
  }
}

/**
 * 单个插件实际生效的目录。
 *
 * 规则（2026-11-12 用户实测修正）：
 * - **自带插件默认用随包那份**。否则数据根里早先留下的旧副本会一直盖住新构建的
 *   `assets/plugins`：`pnpm start` 明明重新编译了，页面却还是旧代码。
 * - 自带插件确实从 NPM 安装/更新过（`plume.npmInstalled: true`）时，仍用全局那份。
 * - 非自带插件维持「全局优先」（用户装的就在全局目录）。
 *
 * 都没有 → undefined（调用方按「这个插件不存在」处理）。
 */
export async function resolvePluginDir(roots: PluginRoots, id: string): Promise<string | undefined> {
  if (id.startsWith('.') || id.startsWith('_') || id.includes('/') || id.includes('\\')) return undefined
  const globalDir = roots.global ? path.join(roots.global, id) : undefined
  const packagedDir = roots.packaged ? path.join(roots.packaged, id) : undefined
  const globalExists = globalDir ? await isDir(globalDir) : false
  const packagedExists = packagedDir ? await isDir(packagedDir) : false

  if (BUILTIN_BY_DIR.has(id)) {
    if (globalExists && globalDir && (await isNpmInstalledDir(globalDir))) return globalDir
    if (packagedExists) return packagedDir
    if (globalExists) return globalDir
    return undefined
  }
  if (globalExists) return globalDir
  if (packagedExists) return packagedDir
  return undefined
}

/** 读一个插件目录 `package.json` 的 `plume.server.entry`（没有 / 坏了 → undefined） */
async function declaredServerEntry(dir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
      plume?: { server?: { entry?: unknown } }
    }
    const entry = pkg.plume?.server?.entry
    return typeof entry === 'string' && entry.trim() ? entry.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * 找**带后台半**的那一份：全局优先，但全局那份必须真的声明了 `plume.server.entry`。
 *
 * 为什么不能直接用 `resolvePluginDir`（用户实测的启动失败）：
 * 数据根里可能有**旧版本**的插件副本（只发布了前端半、`package.json` 里没有 server 段）。
 * 全局优先会挑到它，于是后台半「消失」，Agent 这类强依赖后台的服务直接起不来。
 * 这里改成：谁真的带后台入口就用谁 —— 旧副本没有就回落到随包那份。
 */
export async function resolvePluginDirWithServer(
  roots: PluginRoots,
  id: string,
): Promise<string | undefined> {
  if (id.startsWith('.') || id.startsWith('_') || id.includes('/') || id.includes('\\')) return undefined
  const globalDir = roots.global ? path.join(roots.global, id) : undefined
  const globalNpm = globalDir && (await isDir(globalDir)) ? await isNpmInstalledDir(globalDir) : false
  const rootsInOrder = BUILTIN_BY_DIR.has(id) && !globalNpm
    ? [roots.packaged, roots.global]
    : [roots.global, roots.packaged]
  for (const root of rootsInOrder) {
    if (!root) continue
    const dir = path.join(root, id)
    if (!(await isDir(dir))) continue
    if (await declaredServerEntry(dir)) return dir
  }
  return undefined
}

/**
 * seedPlugins —— 把 cloud-server 随包发布的插件铺到数据根 `plugins/`。
 *
 * 为什么需要（用户口径 2026-11-11）：
 * - 发布包里 `assets/plugins` 是只读的；插件要能被安装/更新/卸载，必须落在数据根。
 * - 前端首次启动时数据根是空的，需要有人把内置插件铺进去，否则界面没有任何插件。
 *
 * 规则：
 * - 目标目录不存在 → 整目录复制；
 * - 已存在 → 比较 package.json 的 `version`，**包内更高才覆盖**；相同或更低跳过。
 *   这样用户自己更新过（版本更高）的插件不会被旧包覆盖回去。
 *
 * 不做自动更新：更新由用户在界面上确认（后续实现弹框）。这里只保证「首装可用」。
 */
import { copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface SeedPluginsResult {
  /** 新复制进去的插件目录名 */
  added: string[]
  /** 版本更高、被覆盖的插件目录名 */
  updated: string[]
  /** 已存在且版本不低，跳过 */
  skipped: string[]
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function versionOf(dir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version
  } catch {
    return undefined
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, 'utf8')).trim() || undefined
  } catch {
    return undefined
  }
}

/** 简单的版本比较：只比较 1.2.3 这样的数字段，够用且不引依赖。 */
function isNewer(a: string | undefined, b: string | undefined): boolean {
  if (!a) return false
  if (!b) return true
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

export async function seedPlugins(sourceDir: string, targetDir: string): Promise<SeedPluginsResult> {
  const result: SeedPluginsResult = { added: [], updated: [], skipped: [] }
  let names: string[]
  try {
    names = await readdir(sourceDir)
  } catch {
    return result
  }
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) continue
    const src = path.join(sourceDir, name)
    if (!(await exists(path.join(src, 'package.json')))) continue
    const dest = path.join(targetDir, name)
    if (!(await exists(dest))) {
      await cp(src, dest, { recursive: true })
      result.added.push(name)
      continue
    }
    const srcVersion = await versionOf(src)
    const destVersion = await versionOf(dest)
    if (isNewer(srcVersion, destVersion)) {
      // 覆盖（force 会在写冲突时覆盖同名文件）
      await cp(src, dest, { recursive: true, force: true })
      result.updated.push(name)
    } else {
      result.skipped.push(name)
    }
  }
  return result
}

/**
 * 把**内置插件的后台半**铺到数据根的 server-plugins。
 *
 * 为什么单独一步（不用 seedPlugins）：两边目录结构不一样。
 * 插件目录是 `<插件>/dist/server.js`，而 server-plugins 是**扁平**的
 * （加载器按「一个 .js = 一个插件」扫，不递归子目录，见 pluginLoader.ts）。
 *
 * 只在**版本更高**时覆盖，规则与前端半一致：用户自己更新过的不能被旧包盖回去。
 * 版本记在旁边一个隐藏文件里（server-plugins 里只有扁平 js，没有 package.json 可比）。
 *
 * @param sourceDir  包内 assets/plugins
 * @param targetDir  数据根下的 server-plugins
 * @returns 实际写入的文件名列表
 */
export async function seedServerPlugins(sourceDir: string, targetDir: string): Promise<string[]> {
  const written: string[] = []
  let names: string[]
  try {
    names = await readdir(sourceDir)
  } catch {
    return written
  }
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) continue
    const pluginDir = path.join(sourceDir, name)
    const artifact = path.join(pluginDir, 'dist', 'server.js')
    if (!(await exists(artifact))) continue

    const target = path.join(targetDir, name + '.js')
    const srcVersion = await versionOf(pluginDir)
    const versionFile = path.join(targetDir, '.' + name + '.version')
    const destVersion = await readText(versionFile)
    if ((await exists(target)) && !isNewer(srcVersion, destVersion)) continue

    await mkdir(targetDir, { recursive: true })
    await copyFile(artifact, target)
    if (srcVersion) await writeFile(versionFile, srcVersion, 'utf8')
    written.push(name + '.js')
  }
  return written
}



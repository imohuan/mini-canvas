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
import { cp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 目标目录里这张「已铺入清单」的文件名。
 *
 * 为什么需要它：32 个插件每个约 1 个目录（含 dist），每次启动都 stat 一遍再比版本，
 * 单测里每建一次服务就多几百毫秒、几百个 IO —— 实测把一批 5 秒超时的用例拖红。
 * 记下「铺过哪一份」后，没变就直接返回，不再逐个 stat。
 */
const SEED_MARK_FILE = '.plume-seeded.json'

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
  /** 这次要铺的插件（目录名 → 版本），成功后整份写进标记文件 */
  const seeded: Record<string, string> = {}
  for (const name of names) {
    if (name.startsWith('.') || name.startsWith('_')) continue
    const src = path.join(sourceDir, name)
    if (!(await exists(path.join(src, 'package.json')))) continue
    const dest = path.join(targetDir, name)
    const srcVersion = (await versionOf(src)) ?? ''
    seeded[name] = srcVersion
    if (!(await exists(dest))) {
      await cp(src, dest, { recursive: true })
      result.added.push(name)
      continue
    }
    const destVersion = await versionOf(dest)
    if (isNewer(srcVersion, destVersion)) {
      // 覆盖（force 会在写冲突时覆盖同名文件）
      await cp(src, dest, { recursive: true, force: true })
      result.updated.push(name)
    } else {
      result.skipped.push(name)
    }
  }
  await writeFile(path.join(targetDir, SEED_MARK_FILE), JSON.stringify(seeded, null, 2) + '\n', 'utf8')
  return result
}

/**
 * 清掉 `server-plugins` 里**与插件目录重复**的旧副本。
 *
 * 为什么需要（2026-11-11 实测启动报错）：升级前后台半是扁平拷贝到 `server-plugins/<插件>.js`，
 * 升级后改为从 `<数据根>/plugins/<插件>/dist/server.js` 读。旧的扁平副本还在，两边都装上就报
 * `[core] Duplicate plugin name: "video-crop"`。
 *
 * 判定：插件目录里存在同名插件，**且**该插件确实带后台半（`dist/server.js`）→ 删扁平副本。
 * 只删我们认得的（同名的）文件，不碰使用者自己丢进来的额外后台插件。
 *
 * @returns 被删掉的文件名（启动日志用它说明做了清理）
 */
export async function cleanupLegacyServerPlugins(pluginsDir: string, serverPluginsDir: string): Promise<string[]> {
  const removed: string[] = []
  let files: string[]
  try {
    files = await readdir(serverPluginsDir)
  } catch {
    return removed
  }
  // 插件目录里「带后台半」的那批：目录名 + 它们导出的插件名。
  // 文件名不一定等于插件名（旧副本叫 plugin-video-crop.js，而它导出的 name 是 video-crop，
  // 正式插件目录叫 plugin-node-video）—— 只按文件名比会漏掉，导致启动时重复登记（实测）。
  const dirNames = new Set<string>()
  const moduleNames = new Set<string>()
  let entries: string[]
  try {
    entries = await readdir(pluginsDir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    const artifact = path.join(pluginsDir, name, 'dist', 'server.js')
    let text: string
    try {
      text = await readFile(artifact, 'utf8')
    } catch {
      continue
    }
    dirNames.add(name)
    const m = text.match(/\bname\s*=\s*["']([A-Za-z0-9_-]+)["']/)
    if (m) moduleNames.add(m[1]!)
  }
  for (const file of files) {
    if (!file.endsWith('.js')) continue
    const dirName = file.slice(0, -3)
    // 判据：插件目录里已经有这个插件（目录名对得上），或它导出的插件名已被目录版占用。
    const duplicate = dirNames.has(dirName) || moduleNames.has(legacyModuleName(dirName))
    if (!duplicate) continue
    await rm(path.join(serverPluginsDir, file), { force: true })
    await rm(path.join(serverPluginsDir, '.' + dirName + '.version'), { force: true })
    removed.push(file)
  }
  return removed
}

/** 扁平文件名 → 它大概率导出的插件名（`plugin-video-crop` → `video-crop`） */
function legacyModuleName(fileBase: string): string {
  return fileBase.replace(/^plugin-/, '')
}

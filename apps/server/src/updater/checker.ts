/**
 * updateChecker —— 更新检查器（发布体系 Task 2）。
 *
 * 职责单一：比对版本，报告「哪些有更新」。不做安装。
 * 数据源：
 * - 已装插件：installedRecordFile（npmPlugins 的 .npm-installed.json 安装记录）；
 * - server 自身：packument(serverPkgName) vs currentServerVersion；
 * - 内置归属：builtinManifest（决定报告里 builtin 标记）。
 *
 * npmClient 由调用方注入（测试用假 registry；生产用 createNpmClient()）。
 */
import { readFile } from 'node:fs/promises'

/** 已装记录（与 npmPlugins.ts 的 InstallRecord 对齐） */
interface InstalledRecord {
  pkg: string
  version: string
  installedAt: string
}

export interface UpdateReport {
  /** server 自身有新版时才有 */
  server?: { current: string; latest: string }
  /** 有新版的已装插件 */
  plugins: Array<{ pkg: string; local: string; latest: string; builtin: boolean }>
  /** 本次检查时间 */
  checkedAt: string
}

interface NpmClientLike {
  packument(name: string): Promise<{
    name: string
    "dist-tags": { latest?: string }
    versions: Record<string, { version: string; tarball: string }>
    time: Record<string, string>
  }>
}

export interface UpdateCheckerOptions {
  npmClient: NpmClientLike
  installedRecordFile: string
  serverPkgName: string
  currentServerVersion: string
  builtinManifest: { plugins: Record<string, string> }
}

export interface UpdateChecker {
  checkAll(): Promise<UpdateReport>
}

/**
 * semver 比较（简化实现，不引依赖）：按 . 切数字逐段比；
 * 带后缀（1.0.0-beta）的后缀段按「小于无后缀」处理。
 * 非数字段（异常版本串）按字符串比较兜底。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, ...suffix] = v.split("-")
    const nums = core.split(".").map((s) => {
      const n = parseInt(s, 10)
      return Number.isNaN(n) ? 0 : n  // 坏段按 0，不按「大于一切」（防坏版本号误判「无更新」）
    })
    // 预发布段拆成点分段逐个比（1.0.0-beta.1 < 1.0.0-beta.2）；纯数字段转数字比。
    // 注意 suffix 为空时 join 是空串，''.split('.') 会得到 ['']（一个空段）——
    // 必须显式给空数组，否则「无预发布」被当成「有一个空段」，与 1.0.0-beta 判等。
    const pre = suffix.length === 0 ? [] : suffix.join("-").split(".").map((s) => {
      const n = parseInt(s, 10)
      return Number.isNaN(n) ? s : n
    })
    return { nums, pre }
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const na = pa.nums[i] ?? 0
    const nb = pb.nums[i] ?? 0
    if (na !== nb) return na < nb ? -1 : 1
  }
  // 数字段相同：有预发布的小于无预发布的（1.0.0-beta < 1.0.0）
  if (pa.pre.length !== pb.pre.length) return pa.pre.length > pb.pre.length ? -1 : 1
  for (let i = 0; i < pa.pre.length; i++) {
    const xa = pa.pre[i]
    const xb = pb.pre[i]
    if (xa === xb) continue
    const numA = typeof xa === 'number'
    const numB = typeof xb === 'number'
    // 数字段 < 字符串段（semver 规则）；同为数字或同为字符串直接比
    if (numA !== numB) return numA ? -1 : 1
    return (xa as number) < (xb as number) ? -1 : 1
  }
  return 0
}

async function readInstalled(file: string): Promise<Record<string, InstalledRecord>> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, InstalledRecord>
  } catch {
    return {}
  }
}

export function createUpdateChecker(opts: UpdateCheckerOptions): UpdateChecker {
  async function checkAll(): Promise<UpdateReport> {
    const report: UpdateReport = { plugins: [], checkedAt: new Date().toISOString() }
    const installed = await readInstalled(opts.installedRecordFile)
    // builtin-manifest 的键是 npm 包名；老版本清单可能是目录名 —— 两种都认，
    // 比对时包名与「去 scope 的目录名」都查一遍。
    const builtinSet = new Set(
      Object.keys(opts.builtinManifest.plugins).flatMap((k) => {
        const dirName = k.replace(/^@[^/]+\//, '')
        return [k, dirName]
      }),
    )

    // 并发查所有已装插件 + server 自身；单个失败跳过（网络抖动不该炸整个检查）
    const targets: Array<{ name: string; local: string; builtin: boolean }> = [
      ...Object.values(installed).map((r) => ({ name: r.pkg, local: r.version, builtin: builtinSet.has(r.pkg) })),
      { name: opts.serverPkgName, local: opts.currentServerVersion, builtin: false },
    ]
    await Promise.all(
      targets.map(async (t) => {
        try {
          const pk = await opts.npmClient.packument(t.name)
          const latest = pk["dist-tags"].latest
          if (!latest) return
          if (compareVersions(t.local, latest) < 0) {
            if (t.name === opts.serverPkgName) {
              report.server = { current: t.local, latest }
            } else {
              report.plugins.push({ pkg: t.name, local: t.local, latest, builtin: t.builtin })
            }
          }
        } catch {
          /* 单项失败跳过 */
        }
      }),
    )
    return report
  }
  return { checkAll }
}

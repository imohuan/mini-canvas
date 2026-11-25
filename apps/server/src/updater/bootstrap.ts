/**
 * bootstrap —— 启动初始化（发布体系 Task 5）。
 *
 * cli.ts serve 入口异步调用（不 await，不拦启动）：
 * 1. ensurePlugins：读 builtin-manifest → 本地缺的插件从 registry 安装（复用 npmClient 全套）；
 * 2. ensureUi：.plume/ui/version.json 缺/旧 → 下载 @plume-canvas/web tarball 解包到 .plume/ui/<版本>/；
 *
 * 失败策略：每个动作独立 try/catch，失败进 failed 数组继续下一个；
 * bootstrap 永不抛 —— 网络不通只意味着「这次没装上」，服务照常起。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createNpmClient, extractTarball } from '../npm/npmClient.js'
import { readBuiltinManifest } from './builtinManifest.js'
import { resolveArtifact } from './artifactResolver.js'

export interface BootstrapOptions {
  /** 数据目录（.plume） */
  dataDir: string
  /** builtin-manifest.json 路径（包根下） */
  manifestPath: string
  /** registry 基址（默认 npmjs；测试注入假 registry） */
  registry?: string
  /** UI 包名 */
  uiPkgName: string
  /** server 包名 */
  serverPkgName: string
  /** 当前 server 版本 */
  currentServerVersion: string
  /** 跳过全部联网步骤（--offline） */
  offline?: boolean
}

export interface BootstrapResult {
  installed: string[]
  skipped: string[]
  failed: string[]
  uiVersion?: string
}

/** 包名 → 落盘目录名（与 npmPlugins.ts 的 dirNameOf 一致） */
const dirNameOf = (pkg: string): string => pkg.replace(/^@/, "").replace("/", "__")

export async function runBootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const result: BootstrapResult = { installed: [], skipped: [], failed: [] }
  if (opts.offline) return result

  const client = createNpmClient({ ...(opts.registry ? { registry: opts.registry } : {}) })
  // manifestPath 允许直接指文件（bootstrap 调用方拿到的就是文件路径）；readBuiltinManifest 要目录
  const manifest = await readBuiltinManifest(path.dirname(opts.manifestPath))
  const pluginsDir = path.join(opts.dataDir, "plugins")

  // ---- 1. 插件：本地缺的装上 ----
  for (const [pkgName, wantVersion] of Object.entries(manifest.plugins)) {
    const destDir = path.join(pluginsDir, dirNameOf(pkgName))
    try {
      const pkgJsonPath = path.join(destDir, "package.json")
      const existing = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as { name?: string; version?: string }
      if (existing.name === pkgName) {
        // manifest 指定 latest → 本地有就跳过（更新由 checker 提示、用户手动装）；
        // manifest 指定具体版本 → 版本一致才跳过，旧版由清单驱动升级。
        const upToDate = wantVersion === "latest" || existing.version === wantVersion
        if (upToDate) {
          result.skipped.push(pkgName)
          continue
        }
      }
    } catch { /* 没有或坏 → 走安装 */ }

    try {
      await installPluginFromRegistry(client, pluginsDir, pkgName, wantVersion)
      result.installed.push(pkgName)
    } catch (err) {
      console.warn("[bootstrap] 插件安装失败（不拦启动）：" + pkgName + " — " + (err instanceof Error ? err.message : String(err)))
      result.failed.push(pkgName)
    }
  }

  // ---- 2. UI：版本缺/旧 → 下载解包 ----
  try {
    const uiVersion = await ensureUi(client, opts.dataDir, opts.uiPkgName)
    if (uiVersion) result.uiVersion = uiVersion
  } catch (err) {
    console.warn("[bootstrap] UI 安装失败（不拦启动）：" + (err instanceof Error ? err.message : String(err)))
  }

  return result
}

/** 安装单个插件包到 pluginsDir（下载 → 解包 → 落盘 → 写来源记录） */
async function installPluginFromRegistry(
  client: ReturnType<typeof createNpmClient>,
  pluginsDir: string,
  pkgName: string,
  wantVersion: string,
): Promise<void> {
  const pk = await client.packument(pkgName)
  const version = !wantVersion || wantVersion === "latest" ? pk["dist-tags"].latest : wantVersion
  if (!version || !pk.versions[version]) throw new Error("版本不存在：" + pkgName + "@" + wantVersion)
  const vInfo = pk.versions[version] as unknown as { dist?: { tarball: string }; plume?: Record<string, unknown> }
  const tarballUrl = vInfo.dist?.tarball
  if (!tarballUrl) throw new Error("tarball 地址缺失：" + pkgName)
  const mini = vInfo.plume as Record<string, unknown> | undefined
  if (!mini || typeof mini.pluginName !== "string") throw new Error("不是 plume 插件：" + pkgName)

  const tmpDir = path.join(pluginsDir, ".tmp-boot-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8))
  try {
    await fs.mkdir(tmpDir, { recursive: true })
    const tgz = path.join(tmpDir, "pkg.tgz")
    await client.downloadTarball(tarballUrl, tgz)
    const pkgJsonPath = await extractTarball(tgz, tmpDir)
    const extracted = path.dirname(pkgJsonPath)

    const safeEntry = (value: unknown, field: string): string => {
      if (typeof value !== "string" || value.trim() === "") throw new Error("缺少 " + field)
      const rel = value.trim().replace(/\\/g, "/")
      if (path.isAbsolute(rel) || rel.split("/").includes("..")) throw new Error(field + " 必须是包内相对路径：" + value)
      if (!/\.[cm]?js$/i.test(rel)) throw new Error(field + " 只允许 .js / .mjs：" + value)
      return rel
    }
    const webRel = safeEntry((mini.web as { entry?: unknown } | undefined)?.entry, "plume.web.entry")
    const serverDecl = (mini.server as { entry?: unknown } | undefined)?.entry
    const serverRel = serverDecl === undefined ? undefined : safeEntry(serverDecl, "plume.server.entry")
    // 产物文件解析抽到 artifactResolver.ts（npmPlugins 手动安装共用同一条兜底语义）
    const resolvedWeb = await resolveArtifact(extracted, webRel, "server.js")
    /**
     * 前后端指向**同一个文件** → 这不是后台半（用户 2026-11-25 实测）。
     *
     * 线上曾有两个纯前端插件（底部状态栏 / 快捷键）把前端 UMD 产物写进了
     * `plume.server.entry`；启动安装照配置复制，后台再当 Node 脚本加载，
     * 第一行就报 `Cannot read properties of undefined (reading 'defineComponent')`。
     * 同一个文件不可能既是页面脚本又是服务端脚本，命中就当纯前端包处理。
     */
    const resolvedServer = typeof serverRel === "string" && serverRel !== webRel
      ? await resolveArtifact(extracted, serverRel, "web.js")
      : undefined
    // 兜底解析也可能把 server 指到同一个文件：同一个产物不能当两半用。
    const serverArtifact = resolvedServer && resolvedServer !== resolvedWeb ? resolvedServer : undefined

    const destDir = path.join(pluginsDir, dirNameOf(pkgName))
    await fs.mkdir(destDir, { recursive: true })
    const copyEntry = async (rel: string): Promise<void> => {
      const target = path.join(destDir, rel)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(path.join(extracted, rel), target)
    }
    await copyEntry(resolvedWeb)
    if (typeof serverArtifact === "string") await copyEntry(serverArtifact)
    // plume.assets 声明的附加资产目录一并复制（如 plugin-agent 的 vendor-plugins/ ——
    // goal hook 的 .mjs 在里面；漏了它启动日志就是「goal hook 未安装：插件库里没有 goal」，
    // 用户 2026-11-21 npx 首启实测。与 routes/npmPlugins.ts 的安装路径同一语义。
    const assets = (mini.assets as unknown)
    if (Array.isArray(assets)) {
      for (const raw of assets) {
        if (typeof raw !== "string" || !raw.trim()) continue
        const rel = raw.trim().replace(/\\/g, "/")
        // 条目是目录名（"dist/vendor-plugins"），不是 .js 产物 —— 只防绝对路径与 .. 穿越
        if (path.isAbsolute(rel) || rel.split("/").includes("..")) continue
        const srcDir = path.join(extracted, rel)
        let stat
        try { stat = await fs.stat(srcDir) } catch { continue } // 目录缺失跳过，不阻塞安装
        if (!stat.isDirectory()) continue
        const destBase = path.join(destDir, rel)
        await fs.mkdir(path.dirname(destBase), { recursive: true })
        await fs.cp(srcDir, destBase, { recursive: true })
      }
    }
    const pkgObj = JSON.parse(await fs.readFile(pkgJsonPath, "utf8")) as { plume?: Record<string, unknown> }
    pkgObj.plume = {
      ...(pkgObj.plume ?? {}),
      installable: true,
      npmInstalled: true,
      web: { ...((pkgObj.plume?.web as object) ?? {}), entry: resolvedWeb },
      ...(typeof serverArtifact === "string" ? { server: { ...((pkgObj.plume?.server as object) ?? {}), entry: serverArtifact } } : {}),
    }
    await fs.writeFile(path.join(destDir, "package.json"), JSON.stringify(pkgObj, null, 2), "utf8")

    const recordFile = path.join(pluginsDir, ".npm-installed.json")
    let recs: Record<string, unknown> = {}
    try { recs = JSON.parse(await fs.readFile(recordFile, "utf8")) as Record<string, unknown> } catch { /* 新文件 */ }
    recs[pkgName] = { pkg: pkgName, version, installedAt: new Date().toISOString() }
    await fs.writeFile(recordFile, JSON.stringify(recs, null, 2), "utf8")
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * UI：读 version.json → 缺/旧 → 下载解包到 ui/<版本>/ → 写 version.json。
 * 返回本次安装的版本；已是最新返回 undefined。
 */
async function ensureUi(
  client: ReturnType<typeof createNpmClient>,
  dataDir: string,
  uiPkgName: string,
): Promise<string | undefined> {
  const uiRoot = path.join(dataDir, "ui")
  let localVersion = ""
  try {
    const v = JSON.parse(await fs.readFile(path.join(uiRoot, "version.json"), "utf8")) as { version?: string }
    localVersion = v.version ?? ""
  } catch { /* 没有 → 走安装 */ }

  const pk = await client.packument(uiPkgName)
  const latest = pk["dist-tags"].latest
  if (!latest) throw new Error("UI 包没有 latest 标签：" + uiPkgName)
  if (localVersion === latest) return undefined

  const vInfo = pk.versions[latest] as unknown as { dist?: { tarball: string } } | undefined
  const tarballUrl = vInfo?.dist?.tarball
  if (!tarballUrl) throw new Error("UI tarball 地址缺失：" + uiPkgName)

  const tmpDir = path.join(uiRoot, ".tmp-" + Date.now())
  try {
    await fs.mkdir(tmpDir, { recursive: true })
    const tgz = path.join(tmpDir, "ui.tgz")
    await client.downloadTarball(tarballUrl, tgz)
    const destDir = path.join(uiRoot, latest)
    await extractTarball(tgz, destDir)
    await fs.writeFile(
      path.join(uiRoot, "version.json"),
      JSON.stringify({ version: latest, installedAt: new Date().toISOString() }, null, 2),
      "utf8",
    )
    return latest
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

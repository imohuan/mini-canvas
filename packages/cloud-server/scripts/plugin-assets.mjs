/**
 * plugin-assets —— 把 packages/plugins 下的插件收成运行时可用的目录形态。
 *
 * 两个构建入口共用这一份（发布打包 scripts/bundle-assets.mjs、一键启动 scripts/build-assets-parallel.mjs），
 * 保证产物同形：
 *
 *   assets/plugins/<插件目录名>/
 *   ├── package.json     ← plume 元信息（entry 回填成**实际产物名**）
 *   └── dist/
 *       ├── web.js       ← 前端半
 *       └── server.js    ← 后台半（有才发）
 *
 * 文件名**保持构建产物原名**（如 plugin-node-text.js），只有确实没有名字时（或作者没声明的）
 * 才落回 web.js / server.js。安装、清单、加载三处都读 package.json 的 entry，
 * 名字是作者的自由，配置才是事实源（用户口径 2026-11-12）。
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..")
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..")
export const ASSETS = path.join(PACKAGE_ROOT, "assets")
const PLUGINS_ROOT = path.join(REPO_ROOT, "packages/plugins")

/** 只做开发工具、不随发布包发出的插件目录名 */
const DEV_ONLY = new Set(["plugin-hot-reload"])

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * 收集要随包发布的插件：packages/plugins 下所有声明了 plume.pluginName 的包。
 * 首启是否自动安装由 src/plugins/builtinPlugins.ts 决定，这里不区分内置 / 可装卸。
 */
export async function collectPlugins() {
  const out = []
  for (const name of (await readdir(PLUGINS_ROOT)).sort()) {
    if (name.startsWith("_") || name.startsWith(".")) continue
    if (DEV_ONLY.has(name)) continue
    const dir = path.join(PLUGINS_ROOT, name)
    if (!(await exists(dir))) continue
    let pkg
    try {
      pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
    } catch {
      continue
    }
    if (!pkg?.plume?.pluginName) continue
    out.push({ name, dir, pkg })
  }
  return out
}

/**
 * 前端产物：优先 package.json 的 web.entry；没声明就取 dist 里第一个非后台的 .js。
 * 返回 undefined 表示这个插件没构建过（调用方应当报错，而不是静默漏掉）。
 */
export async function pickWebEntry(dir, pkg) {
  const declared = pkg.plume?.web?.entry
  if (declared) {
    const p = path.join(dir, declared)
    if (await exists(p)) return p
  }
  const dist = path.join(dir, "dist")
  let files
  try {
    files = (await readdir(dist)).filter((f) => f.endsWith(".js") && !f.endsWith(".map"))
  } catch {
    return undefined
  }
  const web = files.filter((f) => !/^(server|plugin-server|agent-server)\.js$/.test(f))
  return web.length ? path.join(dist, web[0]) : undefined
}

/**
 * 后台产物：优先 package.json 里声明的 `plume.server.entry`；没声明才回退 dist/server.js。
 * 与加载器（serverFramework/pluginLoader.ts）同一套规则 —— 名字由作者定，配置是事实源。
 */
export async function pickServerEntryOf(dir, pkg) {
  const declared = pkg?.plume?.server?.entry
  if (typeof declared === "string" && declared) {
    const p = path.join(dir, declared)
    return (await exists(p)) ? p : undefined
  }
  const p = path.join(dir, "dist", "server.js")
  return (await exists(p)) ? p : undefined
}

/**
 * 把一个插件收进 targetDir（结构见文件头）。
 * @returns {{ name: string, web: string, server?: string }}
 */
export async function copyPluginDir({ name, dir, pkg }, targetDir) {
  const webEntry = await pickWebEntry(dir, pkg)
  if (!webEntry) {
    throw new Error(name + " 没有前端产物（先跑 pnpm -C packages/plugins/" + name + " build）")
  }
  const serverEntry = await pickServerEntryOf(dir, pkg)
  await mkdir(targetDir, { recursive: true })
  // 发布包统一成 dist/web.js 与 dist/server.js（我们自己插件的规范，2026-11-12 确认保留）。
  // 注意：**读取方仍只认 package.json 的 entry**，不按文件名猜 —— 规范是给自家插件用的，
  // 第三方写 `dist/my-plugin.js` 也照样能装、能加载。
  await copyKeepingDirs(webEntry, path.join(targetDir, "dist", "web.js"))
  if (serverEntry) await copyKeepingDirs(serverEntry, path.join(targetDir, "dist", "server.js"))

  const outPkg = {
    ...pkg,
    plume: {
      ...(pkg.plume ?? {}),
      web: { ...(pkg.plume?.web ?? {}), entry: "dist/web.js" },
      ...(serverEntry ? { server: { ...(pkg.plume?.server ?? {}), entry: "dist/server.js" } } : {}),
    },
  }
  await writeFile(path.join(targetDir, "package.json"), JSON.stringify(outPkg, null, 2) + "\n", "utf8")
  return { name, web: webEntry, ...(serverEntry ? { server: serverEntry } : {}) }
}

/** 复制文件并自动建好目标目录 */
async function copyKeepingDirs(from, to) {
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to)
}

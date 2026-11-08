/**
 * build-assets-parallel —— 一键启动用的资源构建编排：并发 + 未改动跳过。
 *
 * 两层优化：
 * 1. 并发：ui、cloud-client 与全部 installable 插件的 vite build 同时发出去
 *    （并发度 = --jobs，缺省 CPU 核数的一半），一个结束立刻补下一个。
 * 2. 跳过：按源码**内容指纹**比对上次构建；这包（含它的依赖闭包）一个字节没变就跳过，
 *    只重跑真正改动过的包。指纹存在 .build-stamp.json。--force 可强制全部重建。
 *
 * 依赖闭包怎么算（关键，算错会「改了代码却跳过」）：
 * - ui 的 vite build **不设 external** → 它把 canvas-render / theme-default / agent 等一批
 *   工作区源码一起捆进同一个 bundle。所以 ui 的指纹要覆盖它整个工作区依赖闭包。
 * - 各插件走 pluginLibBuild（见 ../vite-plugin-lib.ts），把 HOST_EXTERNALS 里的包设为 external，
 *   运行期由宿主全局提供 → 这些包变化**不该**触发插件重建，故从闭包里剔除。
 * - 闭包靠**递归解析 import 语句**得到（跳过 `import type` —— 类型引用不进产物），自动跟随代码演进，
 *   不靠一份手写清单（手写清单会随开发过期）。
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { readdirSync, readFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..")
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..")
const ASSETS = path.join(PACKAGE_ROOT, "assets")
const STAMP_FILE = path.join(PACKAGE_ROOT, ".build-stamp.json")
/**
 * 一键启动用的数据根（与 scripts/launch-server.mjs 的 `pnpm serve` 默认一致）。
 * 只在这里拼路径、不建目录：构建脚本不该顺手改用户的运行数据。
 */
const DATA_ROOT = path.resolve(process.env.MINI_CANVAS_DATA_DIR ?? path.join(REPO_ROOT, ".mini-canvas"))
/** 指纹规则版本：改了本脚本的指纹算法就 +1，旧 stamp 自动作废（下次全量重建） */
const STAMP_VERSION = 3

const argv = process.argv.slice(2)
const force = argv.includes("--force")
function intArg(name, fallback) {
  const i = argv.indexOf(name)
  if (i === -1) return fallback
  const n = Number(argv[i + 1])
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}
const jobs = intArg("--jobs", Math.max(2, Math.floor(availableParallelism() / 2)))

/**
 * 自带插件的**后台半**：前端随应用冷启动，后台半要单独放进数据根的 server-plugins。
 *
 * 为什么必须在这里做：用户实测 2026-11-05（分支 codex/app-shell-layering）右键「导出节点包」
 * 报「打包失败（HTTP 403）」，后台其实是 404「接口不存在: /api/node-packages/build」——
 * `/api/node-packages/*` 来自 plugin-node-ui 的后台半，而一键启动只构建前端与可装卸插件，
 * 从来没人跑过 `deploy:server`。这类插件的前端看起来完全正常（导出菜单还在），
 * 坏掉的是菜单背后的接口，最容易被当成"导出功能本身坏了"。
 */
const BUILTIN_SERVER_PLUGINS = ["plugin-node-ui"]

/**
 * 打包时一律 external（运行期由宿主 window 全局提供）的工作区包。
 * 与 ../vite-plugin-lib.ts 的 HOST_GLOBALS 保持一致：这些变化不触发插件重建。
 * vue / @vue-flow/core 来自 node_modules，本就不在源码指纹范围，列在这里只为语义完整。
 */
const HOST_EXTERNALS = [
  "@mini-canvas/kernel",
  "@mini-canvas/canvas-base",
  "@mini-canvas/canvas-data",
  "@mini-canvas/canvas-render",
  "prosemirror-editor-bundle",
  "vue",
  "@vue-flow/core",
]

/** 工作区目录（扫这些目录下的 package.json 建 name→dir 索引） */
const WORKSPACE_ROOTS = ["packages", "packages/plugins"]
/** 递归收集源文件时跳过的目录名 */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vite", ".turbo", ".cache"])
/** 参与指纹的文件后缀 */
const SRC_EXT = /\.(ts|tsx|vue|js|mjs|json|css|html)$/

async function pathExists(p) {
  try { await stat(p); return true } catch { return false }
}

/** 所有工作区包 name → 绝对目录（用于把 import 的包名映射回源码目录） */
async function buildPackageIndex() {
  const map = new Map()
  for (const root of WORKSPACE_ROOTS) {
    const abs = path.join(REPO_ROOT, root)
    let names
    try { names = await readdir(abs) } catch { continue }
    for (const name of names) {
      const dir = path.join(abs, name)
      try {
        const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
        if (pkg && pkg.name) map.set(pkg.name, dir)
      } catch { /* 没 package.json 的目录跳过 */ }
    }
  }
  return map
}

/** 递归收集 src/ 下参与指纹的源文件 */
async function collectFiles(dir, out = []) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await collectFiles(abs, out)
    } else if (SRC_EXT.test(e.name)) {
      out.push(abs)
    }
  }
  return out
}

/**
 * 一个包参与指纹的文件全集。
 *
 * **只扫 src/ + 包根的几个配置文件**，不递归包根下的其它子目录。
 * 为什么：包根下还住着 dist/ 以及各种临时/测试产物目录，全扫进来会让指纹随
 * 「与源码无关的目录增删」抖动（实测踩过：删一个包根临时目录 → 该包被误判成"源码已改"）。
 * 本仓所有包的源码都在 src/，vite 的 index.html 与 vite.config.* 在包根 → 这个范围既不漏、
 * 也不受无关目录影响。
 */
async function sourceFiles(dir) {
  const files = await collectFiles(path.join(dir, "src"))
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return files }
  for (const e of entries) {
    if (e.isDirectory() || e.name.startsWith(".")) continue
    if (SRC_EXT.test(e.name)) files.push(path.join(dir, e.name))
  }
  return files
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'\"]*?\sfrom\s+)?['\"]([^'\"]+)['\"]/g

/** 从一个包目录的源码里抽出它引用的**外部包名**（含工作区包与 node_modules 包） */
async function importedPackageNames(dir) {
  const names = new Set()
  for (const f of await sourceFiles(dir)) {
    if (!/\.(ts|tsx|vue|js|mjs)$/.test(f)) continue
    const text = await readFile(f, "utf8")
    // 丢掉 "import type"/"export type" 整行：类型引用编译后消失，不该触发重打包
    const code = text.split("\n").filter((l) => !/^\s*(import|export)\s+type\b/.test(l)).join("\n")
    let m
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(code))) {
      const spec = m[1]
      if (spec.startsWith(".") || spec.startsWith("/")) continue
      const parts = spec.split("/")
      names.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0])
    }
  }
  return names
}

/** 一个任务要参与指纹的目录全集：自身 + 依赖闭包（插件任务剔除 external） */
async function closureDirs(task, index) {
  const seen = new Set()
  const dirs = []
  const queue = [task.dir]
  while (queue.length) {
    const dir = queue.shift()
    if (seen.has(dir)) continue
    seen.add(dir)
    dirs.push(dir)
    for (const name of await importedPackageNames(dir)) {
      if (task.externalize && HOST_EXTERNALS.includes(name)) continue
      const dep = index.get(name)
      if (dep && !seen.has(dep)) queue.push(dep)
    }
  }
  return dirs
}

/** 目录集的内容指纹：文件相对路径 + 内容全部进 sha1（顺序固定） */
async function hashDirs(dirs) {
  const hash = createHash("sha1")
  hash.update("v" + STAMP_VERSION + "|")
  const files = []
  for (const dir of dirs) for (const f of await sourceFiles(dir)) files.push(f)
  files.sort()
  for (const f of files) {
    hash.update(path.relative(REPO_ROOT, f).replace(/\\/g, "/"))
    hash.update("\0")
    hash.update(await readFile(f))
    hash.update("\0")
  }
  return hash.digest("hex")
}

async function readStamp() {
  try {
    const raw = JSON.parse(await readFile(STAMP_FILE, "utf8"))
    if (raw && raw.version === STAMP_VERSION && raw.tasks) return raw
  } catch { /* 没 stamp / 版本不符 → 当作首次 */ }
  return { version: STAMP_VERSION, tasks: {} }
}

/** 可装卸插件目录名（对应 @mini-canvas/<name>）。手写部分用于固定构建顺序。 */
const INSTALLABLE_PLUGIN_DIRS = [
  // 手写清单最容易漏：新加的可装卸插件忘了加这里，就会出现「插件管理里少了这一项」
  // （用户 2026-11-05 实测：main 分支有的插件，这份清单里没有）。
  // 下面由 buildPackageIndex() 扫 package.json 自动补齐，手写保留只为固定构建顺序。
  "plugin-align-arrange",
  "plugin-align-guide",
  "plugin-auto-layout",
  "plugin-canvas-export",
  "plugin-clipboard",
  "plugin-context-menu",
  "plugin-edge-cutting",
  "plugin-file-drop",
  "plugin-mini-map",
  "plugin-multi-select",
  "plugin-node-find",
  "plugin-node-image-compare",
  "plugin-showcase",
  "plugin-demo-kit",
]

/**
 * 扫 packages/plugins/* 的 package.json，把“声明了 installable 但漏在这份手写清单里”的插件补上。
 *
 * 为什么必须自动补：插件管理页的清单来自 dist 产物；漏构建的插件在面板里直接不出现，
 * 用户看到的就是“main 分支有这个插件，你这个分支没有”（2026-11-05 实测）。
 */
function discoverInstallablePlugins() {
  const root = path.join(REPO_ROOT, "packages/plugins")
  const names = []
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, dir.name, "package.json"), "utf8"))
      if (pkg.miniCanvas?.installable === true) names.push(dir.name)
    } catch { /* 没有 package.json / JSON 坏了：跳过 */ }
  }
  return names
}

const TASKS = [
  // ui 不 external → externalize:false，指纹覆盖整个工作区依赖闭包
  { name: "@mini-canvas/ui", label: "画布界面", dir: path.join(REPO_ROOT, "packages/ui"), externalize: false },
  { name: "@mini-canvas/plugin-cloud-client", label: "云端客户端", dir: path.join(REPO_ROOT, "packages/plugins/plugin-cloud-client"), externalize: true },
  // 自带插件的后台半：前端产物在 ui 的闭包里，这里只补 dist/server.js
  ...BUILTIN_SERVER_PLUGINS.map((d) => ({
    name: "@mini-canvas/" + d,
    label: d + "（后台半）",
    dir: path.join(REPO_ROOT, "packages/plugins", d),
    externalize: false,
    script: "build:server",
  })),
  ...[...new Set([...INSTALLABLE_PLUGIN_DIRS, ...discoverInstallablePlugins()])].map((d) => ({
    name: "@mini-canvas/" + d,
    label: d,
    dir: path.join(REPO_ROOT, "packages/plugins", d),
    externalize: true,
  })),
]

/** 跑一个 pnpm --filter <pkg> build；输出收进缓冲，失败时打印尾部 */
function buildOne(task) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["--filter", task.name, task.script ?? "build"], {
      cwd: REPO_ROOT,
      shell: process.platform === "win32", // Windows 上 pnpm 是 .cmd，需要 shell 才能起
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { out += d })
    child.on("close", (code) => resolve({ ...task, ok: code === 0, code, out }))
    child.on("error", (err) => resolve({ ...task, ok: false, code: -1, out: String(err) }))
  })
}

/** 固定并发度任务池：同时最多 jobs 个在跑，一个结束立刻补下一个 */
async function runPool(tasks) {
  const results = []
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++]
      const t0 = Date.now()
      process.stdout.write("[build] " + task.label + " ...\n")
      const r = await buildOne(task)
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      process.stdout.write((r.ok ? "[ ok ] " : "[FAIL] ") + task.label + " (" + secs + "s)\n")
      results.push(r)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker))
  return results
}

// ---------- 1. 算指纹，挑出要重建的 ----------
console.log("检查改动（并发 " + jobs + "）...\n")
const tCheck = Date.now()
const index = await buildPackageIndex()
const stamp = await readStamp()
for (const task of TASKS) {
  const dirs = await closureDirs(task, index)
  const hash = await hashDirs(dirs)
  task.prevHash = stamp.tasks[task.name]
  task.hash = hash
  // 除了"指纹变了"，"产物不在了"也必须重建：dist 被手动删/清过、或换了机器时，
  // 指纹可能没变但产物缺失，光看指纹会跳过一个根本不存在的产物。
  const hasOutput = await pathExists(path.join(task.dir, "dist"))
  task.changed = force || !hasOutput || stamp.tasks[task.name] !== hash
  task.reason = force ? "强制" : !hasOutput ? "产物缺失" : stamp.tasks[task.name] !== hash ? "源码已改" : ""
}
const toBuild = TASKS.filter((t) => t.changed)
const skipped = TASKS.filter((t) => !t.changed)
console.log("未改动跳过 " + skipped.length + " 个，需重建 " + toBuild.length + " 个（指纹比对 " + ((Date.now() - tCheck) / 1000).toFixed(1) + "s）\n")
for (const t of skipped) process.stdout.write("[skip] " + t.label + "（未改动）\n")
if (skipped.length) process.stdout.write("\n")
for (const t of toBuild) process.stdout.write("[todo] " + t.label + "（" + t.reason + "）\n")
if (toBuild.length) process.stdout.write("\n")

// ---------- 2. 并发构建要重建的 ----------
const t0 = Date.now()
const results = toBuild.length ? await runPool(toBuild) : []
const buildSecs = ((Date.now() - t0) / 1000).toFixed(1)

const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  for (const f of failed) {
    console.error("\n[FAIL] " + f.label + " 构建失败（exit " + f.code + "），输出尾部：")
    console.error(f.out.split("\n").slice(-15).join("\n"))
  }
  console.error("\n" + failed.length + "/" + results.length + " 个包构建失败，中止（assets 与 stamp 都不更新）。")
  process.exit(1)
}
if (toBuild.length === 0) {
  console.log("全部 " + TASKS.length + " 个包都未改动，跳过构建。\n")
} else {
  console.log("\n重建 " + results.length + " 个包成功（耗时 " + buildSecs + "s）\n")
}

// ---------- 3. 自带插件的后台半 → <数据根>/server-plugins ----------
// 只复制、不装：server-plugins 是**启动时**扫的，复制完在下一次启动生效。
// 为什么不在运行期打安装接口：构建阶段后台可能还没起来，而且那需要管理令牌。
const serverPluginsDir = path.join(DATA_ROOT, "server-plugins")
await mkdir(serverPluginsDir, { recursive: true })
let missingServer = 0
for (const d of BUILTIN_SERVER_PLUGINS) {
  const artifact = path.join(REPO_ROOT, "packages/plugins", d, "dist/server.js")
  if (!(await pathExists(artifact))) {
    console.error("[FAIL] 没有 " + d + " 的后台半产物：" + artifact)
    console.error("       它负责 /api/node-packages/*（导出节点包）等接口；缺了会表现为「导出失败」")
    missingServer += 1
    continue
  }
  const target = path.join(serverPluginsDir, d + ".js")
  await copyFile(artifact, target)
  console.log("[ ok ] " + d + " 后台半 -> " + path.relative(PACKAGE_ROOT, target))
}
if (missingServer > 0) {
  console.error("\n" + missingServer + " 个自带后台半缺失，中止（否则启动后导出 / 导入节点包会 404）。")
  process.exit(1)
}

// ---------- 4. 收产物进 assets/ ----------
await rm(ASSETS, { recursive: true, force: true })
await mkdir(ASSETS, { recursive: true })

const SOURCES = [
  { from: path.join(REPO_ROOT, "packages/ui/dist"), to: path.join(ASSETS, "ui"), label: "画布界面" },
  {
    from: path.join(REPO_ROOT, "packages/plugins/plugin-cloud-client/dist"),
    to: path.join(ASSETS, "plugins/plugin-cloud-client/dist"),
    label: "云端客户端插件",
  },
]

let missing = 0
for (const s of SOURCES) {
  if (!(await pathExists(s.from))) {
    console.error("[FAIL] 没有 " + s.label + " 的构建产物：" + s.from)
    missing += 1
    continue
  }
  await cp(s.from, s.to, { recursive: true })
  console.log("[ ok ] " + s.label + " -> " + path.relative(PACKAGE_ROOT, s.to))
}
if (missing > 0) process.exit(1)

for (const must of [
  path.join(ASSETS, "ui/index.html"),
  path.join(ASSETS, "plugins/plugin-cloud-client/dist/plugin-cloud-client.js"),
]) {
  if (!(await pathExists(must))) {
    console.error("[FAIL] 收进来的产物不完整，缺少：" + must)
    process.exit(1)
  }
}

// ---------- 5. 写回 stamp（全部任务，含这次跳过的）----------
const nextTasks = {}
for (const t of TASKS) nextTasks[t.name] = t.hash
await writeFile(STAMP_FILE, JSON.stringify({ version: STAMP_VERSION, tasks: nextTasks }, null, 2) + "\n", "utf8")

console.log("\nassets 已就绪（服务可直接挂画布与插件清单）")

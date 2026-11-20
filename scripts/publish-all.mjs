/**
 * publish-all —— 按依赖顺序发布全部自带插件 → ui → server。
 *
 * 发布体系 Task 7。顺序不能乱：server 的 builtin-manifest 引用插件，
 * 插件必须先在 npm 上存在，server 才能声明依赖它们。
 *
 * ui 包特殊：monorepo 内部走源码 exports，发布时临时把 main/exports 切到 dist，
 * 发完恢复（避免破坏仓库内开发）。
 *
 * 用法：
 *   NPM_TOKEN=xxx node scripts/publish-all.mjs           # 正式发布
 *   node scripts/publish-all.mjs --dry-run               # 试跑（不真发）
 */
import { readFile, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dryRun = process.argv.includes('--dry-run')

if (!process.env.NPM_TOKEN && !dryRun) {
  console.error("缺 NPM_TOKEN 环境变量（发布需要 npm 登录凭证）。--dry-run 可无 token 试跑。")
  process.exit(1)
}

/** 读 builtinPlugins.ts 清单（与 gen-builtin-manifest.mjs 同源） */
const src = await readFile(path.join(REPO_ROOT, "apps/server/src/plugins/builtinPlugins.ts"), "utf8")
const pluginDirs = [...src.matchAll(/\{\s*dir:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])

const jobs = [
  ...pluginDirs.map((d) => ({ dir: path.join(REPO_ROOT, "packages/plugins", d), name: d })),
  { dir: path.join(REPO_ROOT, "apps/web"), name: "ui", swapExports: true },
  { dir: path.join(REPO_ROOT, "apps/server"), name: "server" },
]

let failed = null
for (const job of jobs) {
  const pkgPath = path.join(job.dir, "package.json")
  let backup = null
  if (job.swapExports) {
    // ui：临时切 exports/main 到 dist（monorepo 内部用 src，发布用 dist），发完恢复
    backup = await readFile(pkgPath, "utf8")
    const pkg = JSON.parse(backup)
    pkg.main = "./dist/index.html"
    pkg.exports = { ".": "./dist/" }
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")
  }
  try {
    console.log(`[${dryRun ? "dry-run" : "publish"}] ${job.name} ...`)
    const args = ["publish", "--access", "public"]
    if (dryRun) args.push("--dry-run")
    const { stdout } = await run("npm", args, { cwd: job.dir, shell: true })
    console.log(stdout.trim().split("\n").slice(-3).join("\n"))
  } catch (err) {
    console.error(`✗ ${job.name} 发布失败：`)
    console.error(err.stderr || err.message)
    failed = job.name
    break  // 失败即停（后续包依赖前面的）
  } finally {
    if (backup) {
      await writeFile(pkgPath, backup, "utf8")
      backup = null
    }
  }
}

if (failed) {
  console.error(`\n发布中止于 ${failed}；后续包未发。`)
  process.exit(1)
}
console.log(dryRun ? "\n全部 dry-run 通过。" : "\n全部发布完成。")

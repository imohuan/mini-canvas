/**
 * prep-publish —— 发布准备：批量改自带插件的 package.json。
 *
 * 只处理 BUILTIN_PLUGINS 清单里的 24 个插件（非自带/演示包不动）：
 *   private: true → 删除
 *   version → 0.1.0
 *   publishConfig.access = "public"（scope 包必须显式公开）
 *   files = ["dist", "package.json", "README.md"]（README 不存在也无妨，npm 自动忽略）
 *   exports 指向 dist 产物（发布后消费者读 dist，不是 src）
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// 与 apps/server/src/plugins/builtinPlugins.ts 的清单保持同步（正则提取，同 gen-builtin-manifest.mjs）
const src = await readFile(path.join(REPO_ROOT, "apps/server/src/plugins/builtinPlugins.ts"), "utf8")
const dirs = [...src.matchAll(/\{\s*dir:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
console.log(`处理 ${dirs.length} 个自带插件`)

let changed = 0
for (const dir of dirs) {
  const pkgPath = path.join(REPO_ROOT, "packages/plugins", dir, "package.json")
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"))
  const before = JSON.stringify(pkg)
  delete pkg.private
  pkg.version = "0.1.0"
  pkg.publishConfig = { access: "public" }
  pkg.files = ["dist", "README.md"]
  // main/exports 不动：monorepo 开发走源码形态（exports "./*": "./src/*"）。
  // 发布时的 dist 形态由 publish-all.mjs 临时 swap（发完恢复，与 ui 包同一机制）。
  if (JSON.stringify(pkg) !== before) {
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")
    changed++
    console.log("  ✓ " + dir)
  }
}
console.log(`完成：${changed} 个包已更新`)

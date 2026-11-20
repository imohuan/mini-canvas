/**
 * gen-builtin-manifest —— 从 BUILTIN_PLUGINS 生成 dist/builtin-manifest.json。
 *
 * 发布体系 Task 1：server 包发布时不含插件代码，
 * 内置清单必须随包分发（启动初始化据此自动装插件）。
 * 版本统一写 "latest"（用户口径 2026-11-20：自带插件永远跟最新）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// 从 TS 源提取 BUILTIN_PLUGINS 的 dir 字段（避免引入 TS 运行时依赖）。
// 正则锚定单行对象字面量 { dir: "...", ... }，与 builtinPlugins.ts 的现有格式对齐。
const src = await readFile(path.join(SERVER_ROOT, "src/plugins/builtinPlugins.ts"), "utf8")
const dirs = [...src.matchAll(/\{\s*dir:\s*['\"]([^'\"]+)['\"]/g)].map((m) => m[1])
if (dirs.length === 0) {
  console.error("gen-builtin-manifest: 没有从 builtinPlugins.ts 提取到任何插件目录，中止")
  process.exit(1)
}


// 键用 npm 包名（bootstrap 拿它直接 packument）；目录名 = 去 scope 前缀（与 pluginRoots 一致）。
const manifest = {
  plugins: Object.fromEntries(dirs.map((d) => ["@plume-canvas/" + d, "latest"])),
}

// 写到包根（package.json files 里列的就是这个位置；发布包自带，dev 下 gen 一次即可）
const out = path.join(SERVER_ROOT, "builtin-manifest.json")
await writeFile(out, JSON.stringify(manifest, null, 2) + "\n")
console.log(`[ ok ] builtin-manifest.json（${dirs.length} 个内置插件）→ 包根`)

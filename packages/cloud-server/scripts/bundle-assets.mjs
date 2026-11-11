/**
 * bundle-assets —— 把「画布界面」和**全部插件**的已构建产物收进本包 assets/。
 *
 * 为什么需要：`npx plume-canvas serve` 的目标是「起个服务就能用」。界面与插件是独立包，
 * 装 cloud-server 的人不会同时装它们，产物也不在仓库相对路径上。所以发布前把产物复制进
 * 本包，让 tarball 自给自足（resolveUiDist / resolvePluginsDir 会优先在包内找）。
 *
 * 插件结构与运行时完全一致（见 scripts/plugin-assets.mjs 的文件头）：
 *   assets/plugins/<插件目录名>/{package.json, dist/web.js, dist/server.js}
 *
 * 本脚本只做「复制已构建好的东西」，不负责构建 —— 构建顺序见 package.json 的 prepack，
 * 一键启动走 scripts/build-assets-parallel.mjs（它复用同一套复制规则）。
 */
import { access, cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { ASSETS, REPO_ROOT, collectPlugins, copyPluginDir } from "./plugin-assets.mjs"

// 先清空：避免上次构建留下的陈旧文件被打进包（尤其 ui 的哈希文件名）
await rm(ASSETS, { recursive: true, force: true })
await mkdir(ASSETS, { recursive: true })

// ── 画布界面 ──
const uiDist = path.join(REPO_ROOT, "packages/ui/dist")
await cp(uiDist, path.join(ASSETS, "ui"), { recursive: true }).catch(() => {
  console.error(`✗ 没有画布界面的构建产物：${uiDist}`)
  console.error("  请先执行：cd packages/ui && pnpm build")
  process.exit(1)
})
console.log("✓ 画布界面 → assets/ui")

// ── 全部插件：一个插件一个目录 ──
const plugins = await collectPlugins()
let missing = 0
for (const p of plugins) {
  try {
    await copyPluginDir(p, path.join(ASSETS, "plugins", p.name))
    console.log(`✓ ${p.name} → assets/plugins/${p.name}`)
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`)
    missing += 1
  }
}

if (missing > 0) {
  console.error(`\n${missing} 个插件缺少构建产物，中止`)
  process.exit(1)
}

try {
  await access(path.join(ASSETS, "ui/index.html"))
} catch {
  console.error("✗ 收进来的界面产物不完整，缺少 index.html")
  process.exit(1)
}

console.log(`\nassets 已就绪：界面 + ${plugins.length} 个插件`)

/**
 * 把「画布界面」与「云端客户端插件」的**已构建产物**收进本包 assets/。
 *
 * 为什么需要：`npx mini-canvas-cloud serve` 的目标是"起个服务就能看到画布"。
 * 但 ui 与插件是两个独立包，装 cloud-server 的人不会同时装它们，产物也不在
 * `packages/ui/dist` 这种仓库相对路径上。所以发布前把这两份 dist 复制进本包，
 * 让 tarball 自给自足（`resolveUiDist` / `resolvePluginsDir` 会优先在包内找）。
 *
 * 本脚本只做"复制已构建好的东西"，不负责构建（构建顺序交给 package.json 的
 * build:assets 用 pnpm --filter 串起来），免得这里再引一层编排。
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const ASSETS = path.join(PACKAGE_ROOT, 'assets')

/** 要收进来的产物：源目录 → 目标目录 */
const SOURCES = [
  { from: path.join(REPO_ROOT, 'packages/ui/dist'), to: path.join(ASSETS, 'ui'), label: '画布界面' },
  {
    from: path.join(REPO_ROOT, 'packages/plugins/plugin-cloud-client/dist'),
    to: path.join(ASSETS, 'plugins/plugin-cloud-client/dist'),
    label: '云端客户端插件',
  },
]

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

// 先清空：避免上次构建留下的陈旧文件被打进包（尤其 ui 的哈希文件名）
await rm(ASSETS, { recursive: true, force: true })
await mkdir(ASSETS, { recursive: true })

let missing = 0
for (const s of SOURCES) {
  if (!(await exists(s.from))) {
    console.error(`✗ 没有 ${s.label} 的构建产物：${s.from}`)
    console.error(`  请先执行：cd ${path.relative(REPO_ROOT, path.dirname(s.from))} && pnpm build`)
    missing += 1
    continue
  }
  await cp(s.from, s.to, { recursive: true })
  console.log(`✓ ${s.label} → ${path.relative(PACKAGE_ROOT, s.to)}`)
}

if (missing > 0) process.exit(1)

// 校验：至少确认 ui 有入口、插件有产物，不然打出来的包是残的
for (const must of [
  path.join(ASSETS, 'ui/index.html'),
  path.join(ASSETS, 'plugins/plugin-cloud-client/dist/plugin-cloud-client.js'),
]) {
  if (!(await exists(must))) {
    console.error(`✗ 收进来的产物不完整，缺少：${must}`)
    process.exit(1)
  }
}

console.log('\nassets 已就绪（npx 装完即可直接看画布）')

// ── 默认 provider：随包发一份，启动时自动铺到数据根 ──
//
// 为什么要有：web2api 的 provider 已从源码内置改成外挂文件（见 src/providers/load.ts）。
// 装包的人不会自己去写这三个文件，但"装完就能生成"是承诺 —— 所以包里带一份，
// 服务启动时若数据根还没有同名文件就复制过去（已有的绝不覆盖，用户改过的优先）。
const PROVIDER_SOURCE = path.join(PACKAGE_ROOT, 'providers')
if (await exists(PROVIDER_SOURCE)) {
  console.log('✓ 默认 provider 随包发布（启动时自动铺到 <数据根>/providers/）')
}

/**
 * build-server —— 把 `src/server/index.ts` 打成**单文件** `dist/server.js`（esbuild）。
 *
 * 为什么必须单文件、零 external：宿主的 server-plugins 加载器按「目录里一个 .js = 一个插件」
 * 扫描，用 `import(data:text/javascript)` 加载 —— data: URL 里**解析不了裸模块名**。
 * 所以除了 node: 内置模块，其它依赖（penguin-core / hono / yaml …）全部内联。
 *
 * 同时把 `vendor-plugins/`（goal hook 的仓库内来源）复制进 dist：单文件产物没有"包根"，
 * 那批 .mjs 只能作为**旁边的资产目录**跟着走，由启动器调 setVendorPluginsDir 告知位置。
 *
 * 产物是**宿主可 import 的库**，不是一个能直接丢进 server-plugins 的自注册插件：
 * Agent 装配要找数据根、宿主 KV、插件的提示词小节与中间件链 —— 这些只有宿主知道。
 * 所以装载方式仍是「宿主 import 本包并注入端口」（见 src/server/ports.ts）。
 */
import { build } from 'esbuild'
import { cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(PKG, 'dist')

// esbuild 不会删旧产物；先清干净，避免上次的文件混进来被当成插件加载。
await rm(DIST, { recursive: true, force: true })

await build({
  entryPoints: [path.join(PKG, 'src/server/index.ts')],
  outfile: path.join(DIST, 'server.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
})

// goal hook 脚本是**独立资源**（SDK 会拿它们当子进程跑），不能内联进 JS，只能跟着复制。
await cp(path.join(PKG, 'vendor-plugins'), path.join(DIST, 'vendor-plugins'), { recursive: true })

console.log('[plugin-agent] dist/server.js + dist/vendor-plugins 完成')

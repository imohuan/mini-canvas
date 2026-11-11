/**
 * build-server —— 把 `src/server/index.ts` 打成**单文件** `dist/agent-server.js`（esbuild）。
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
 *
 * 文件名就叫 `server.js`：它现在**真的是后台插件**（导出 name / inject / apply），
 * 由 `package.json` 的 `plume.server.entry` 声明，宿主启动时按配置加载。
 */
import { build } from 'esbuild'
import { cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(PKG, 'dist')

// esbuild 不会删旧产物；先清干净，避免上次的文件混进来被当成插件加载。
// 只清后台产物：dist 里可能还有 vite 打出的前端半（plugin-agent.js），
// 整个目录删掉会把前端产物一起抹掉（build = vite build && build-server 会踩到）。
await rm(path.join(DIST, 'server.js'), { force: true })
await rm(path.join(DIST, 'vendor-plugins'), { recursive: true, force: true })

await build({
  entryPoints: [path.join(PKG, 'src/server/pluginAgentServer.ts')],
  outfile: path.join(DIST, 'server.js'),
  bundle: true,
  // ESM（加载器用 `import(data:text/javascript,…)`，CJS 会报 `module is not defined`）。
  // 依赖树里的 `require('process')` 要靠 banner 补一个 createRequire 才能跑（见下）。
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
  // 目标 Node 20：产物会由宿主用 data: URL import，必须是纯 ESM + 只依赖 node: 内置模块。
  // data: URL 里没有模块上下文，`require` 不存在 —— 用 createRequire 造一个，
  // 指向 node: 内置模块即可（依赖树里那些 `require('process')` / `require('fs')` 都是内置）。
  banner: {
    js: [
      "import { createRequire as __plumeCreateRequire } from 'node:module';",
      // 依赖树里的 CJS 分支会 `require('process')` / `require('fs')` 等内置模块。
      // 宿主用**真实文件路径**加载本产物，所以 import.meta.url 是 file 方案，
      // createRequire 能正常工作（data: URL 下会报 scheme 错）。
      "const require = __plumeCreateRequire(import.meta.url);",
    ].join('\n'),
  },
})

// goal hook 脚本是**独立资源**（SDK 会拿它们当子进程跑），不能内联进 JS，只能跟着复制。
await cp(path.join(PKG, 'vendor-plugins'), path.join(DIST, 'vendor-plugins'), { recursive: true })

console.log('[plugin-agent] dist/server.js（后台插件）+ dist/vendor-plugins 完成')

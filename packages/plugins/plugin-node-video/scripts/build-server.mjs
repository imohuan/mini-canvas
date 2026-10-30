/**
 * build-server —— 把 server/plugin-video-crop.js 打成**单文件** dist/server.js。
 *
 * 为什么要这一步（而不是继续手工 cp 源码副本）：
 * 后台插件走 /api/server-plugins/install 安装，而那条路由只认
 * /plugin-catalog.json 里给的**可信 sha256**，清单里的 hash 来自 <包>/dist/server.js。
 * 没有 dist/server.js，清单里就没有 server 段 → 装不上（会报「未列入清单」）。
 *
 * 为什么单文件、且零 external：cloud-server 的外挂加载器用
 * import(data:text/javascript) 加载，data: URL 里解析不了裸模块名。
 * 本插件只用 node: 内置模块，esbuild 会自动按平台处理。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(PKG, 'server/plugin-video-crop.js')],
  outfile: path.join(PKG, 'dist/server.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
})

console.log('[plugin-node-video] dist/server.js 完成')

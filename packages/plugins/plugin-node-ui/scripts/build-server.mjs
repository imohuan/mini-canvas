/**
 * build-server —— 把 src/server.ts 打成**单文件** dist/server.js（esbuild）。
 *
 * 为什么必须单文件而且零 external：cloud-server 的外挂后台加载器按
 * 「目录里一个 .js = 一个插件」扫描，并用 import(data:text/javascript) 加载 ——
 * **data: URL 里解析不了裸模块名**（实测：import 'vue' 直接抛 Failed to resolve module specifier）。
 * 所以除了 node: 内置模块，任何依赖都要打进产物。
 *
 * 本插件正好零第三方依赖（只用 ctx 能力段 + 全局 fetch），产物很小。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(PKG, 'src/server.ts')],
  outfile: path.join(PKG, 'dist/server.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // 什么都不 external：node: 内置模块 esbuild 自动按平台处理，其余全内联。
  sourcemap: false,
  logLevel: 'info',
})

console.log('[node-ui] dist/server.js 完成')


/**
 * build-server —— 把 src/server.ts 打成**单文件** dist/server.js（esbuild，零运行时依赖）。
 *
 * 为什么单文件：宿主加载外挂后台插件时按 `package.json` 的 `plume.server.entry` 读**一个文件**，
 * 用 data: URL import；data: URL 没有基准目录，解析不了相对 import。
 * Node 内置模块与 `hono` 不用打进来（前者是运行时自带、后者由宿主提供）。
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
  external: ['hono'],
  sourcemap: false,
  logLevel: 'info',
})

console.log('[hot-reload] dist/server.js 完成')

/**
 * build-server —— 把 src/server.ts 打成**单文件** dist/server.js（esbuild，零运行时依赖）。
 *
 * 为什么单文件：cloud-server 的外挂加载器按「目录里一个 .js = 一个插件」扫描
 * （serverFramework/pluginLoader.ts），产物必须自包含（data: URL import 没有相对解析）。
 * @mini-canvas/kernel 打进产物（它 private，npm 装不到）；hono 保持 external
 * （宿主一定有；塞进来会双实例、类型不兼容）。
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

console.log('[showcase] dist/server.js 完成')

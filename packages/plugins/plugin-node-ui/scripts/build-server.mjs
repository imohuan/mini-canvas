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
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 让 `import X from './x.md?raw'` 也能在 esbuild 里工作（vite 原生支持 `?raw`）。
 *
 * 为什么要它：本插件的手册正文（GUIDE）抽成了独立的 src/guide.md —— 用户口径：
 * 「这个文档单独作为一个 MD 文件，我当前使用的是 vite，它可以直接加载这个文件到一个变量中 ?raw」。
 * 前端那半走 vite 原生支持；**后台这半是 esbuild 单文件打包**（见文件头说明），
 * esbuild 不认识 `?raw` 后缀 —— 没有这个插件，后台产物会直接构建失败。
 */
const rawPlugin = {
  name: 'raw-text',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
      namespace: 'raw-text',
    }))
    b.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => ({
      contents: 'export default ' + JSON.stringify(await readFile(args.path, 'utf8')),
      loader: 'js',
    }))
  },
}

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
  plugins: [rawPlugin],
})

console.log('[node-ui] dist/server.js 完成')


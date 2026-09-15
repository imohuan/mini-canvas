/**
 * static —— 托管 `packages/ui` 的构建产物 + 外部插件清单。
 *
 * 两个目标：
 * 1. 浏览器打开 `http://localhost:<port>/` 就是**真画布**（ui/dist 的静态产物，无 SSR）；
 * 2. `/plugin-manifest.json` 告诉画布"该装哪些外部插件"，由本服务**扫描插件目录生成**
 *    （不手写：没有 dist 的插件不出现在清单里，删掉 dist 就自动消失）。
 *
 * 为什么不用 SSR：画布要大量 DOM 量测与 VueFlow 交互，服务端渲不出来也没意义。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

/**
 * 本包自己的根目录（用于找随包发布的 assets/）。
 * static.js 编译进 dist/，故上一级就是包根；源码直跑（tsx）时也在 src/ 的上一级。
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 扩展名 → MIME（静态托管只涉及这几类） */
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

function mimeFor(file: string): string {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * 找 ui 构建产物目录：显式给了就用它（不存在则报错），否则按候选顺序探测。
 *
 * 候选顺序：**仓库内的路径优先**，随包 assets 兜底。
 * 理由是两种场景各取所需：
 * - 在仓库里跑（改 ui / 跑 e2e）：走 packages/ui/dist，看到的是刚构建的新产物；
 * - `npx mini-canvas-cloud serve`（空目录）：仓库路径都不存在，落到随包 assets/ui，开箱即用。
 * 反过来（assets 优先）会让仓库里改了 ui 却一直看到 assets 里那份旧副本，很难查。
 */
export async function resolveUiDist(explicit?: string): Promise<string | undefined> {
  if (explicit) {
    if (!(await isDir(explicit))) throw new Error(`--ui 指定的目录不存在: ${explicit}`)
    return path.resolve(explicit)
  }
  const candidates = [
    path.resolve('packages/ui/dist'),
    path.resolve('../ui/dist'),
    path.resolve('ui-dist'),
    path.join(PACKAGE_ROOT, 'assets/ui'),
  ]
  for (const c of candidates) {
    if (await isDir(c)) return c
  }
  return undefined
}

/** 找插件目录（含 dist 的插件包所在目录）：显式给了就用它，否则按候选顺序探测（仓库优先，随包兜底） */
export async function resolvePluginsDir(explicit?: string): Promise<string | undefined> {
  if (explicit) {
    if (!(await isDir(explicit))) throw new Error(`--plugins 指定的目录不存在: ${explicit}`)
    return path.resolve(explicit)
  }
  const candidates = [
    path.resolve('packages/plugins'),
    path.resolve('../plugins'),
    path.resolve('plugins'),
    path.join(PACKAGE_ROOT, 'assets/plugins'),
  ]
  for (const c of candidates) {
    if (await isDir(c)) return c
  }
  return undefined
}

/** 清单里的一项（与计划 §四 的 /plugin-manifest.json 形状一致） */
export interface ManifestPluginEntry {
  /** 稳定身份（取自 package.json 的 name，退回落目录名） */
  id: string
  /** 浏览器要 fetch 的插件地址（同源） */
  url: string
  disabled?: boolean
}

/**
 * 扫描插件目录，生成清单条目。
 *
 * 收录条件（三条都要满足，宁可少列也不要列出装不上的）：
 * 1. `dist/` 下存在 .js（源码包不算：浏览器装不了 .ts）；
 * 2. 该产物是**可以按 URL 直接 import 的 ES 模块**（见 looksLikeEsm）；
 * 3. 目录名不以 `_`/`.` 开头。
 *
 * 为什么第 2 条必须卡住：画布那边的加载路径是 fetch 文本 → `import(data:text/javascript,...)`。
 * 仓库里多数插件打的是 UMD（给 `<script>` 用，靠全局 Vue/VueFlow 注入），这种产物走 data: URL
 * 会**在加载时直接抛错**。把它们列进清单只会让画布每次开都在 console 里刷一串告警，
 * 却什么也没装上——不如不列。想被外部装载，就把该插件改成 `formats: ['es']`（参考 plugin-cloud-save）。
 */
export async function buildManifest(pluginsDir: string | undefined): Promise<ManifestPluginEntry[]> {
  if (!pluginsDir) return []
  let names: string[]
  try {
    names = await fs.readdir(pluginsDir)
  } catch {
    return []
  }
  const out: ManifestPluginEntry[] = []
  for (const name of names.sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue

    // —— 形态一：目录下直接放的单个 .js 文件 ——
    // 这是给"手写个小插件试一下"准备的：扔一个 js 进来就行，不用搭 <包名>/dist/ 那套目录。
    // 前提同样是它得是 ESM（有顶层 export），否则浏览器那边加载会炸。
    if (name.endsWith('.js') && !name.endsWith('.min.js')) {
      if (!(await looksLikeEsm(path.join(pluginsDir, name)))) continue
      out.push({ id: name.slice(0, -'.js'.length), url: `/plugins/${name}` })
      continue
    }

    // —— 形态二：<包名>/dist/<产物>.js （vite 打包出来的插件包） ——
    const dist = path.join(pluginsDir, name, 'dist')
    if (!(await isDir(dist))) continue
    const files = (await fs.readdir(dist)).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'))
    const file = files[0]
    if (!file) continue
    if (!(await looksLikeEsm(path.join(dist, file)))) continue
    out.push({ id: await readPluginId(path.join(pluginsDir, name), name), url: `/plugins/${name}/${file}` })
  }
  return out
}

/**
 * 判断一个打包产物能不能当 URL 模块加载（即是不是 ES 模块）。
 *
 * 判据是"有顶层 export 语句"。UMD 产物整个包在 `(function(){...})()` 里、没有任何顶层
 * export，于是被排除；ESM 一定有 export。
 *
 * 要把 ESM 的各种写法都认出来 —— 最初只认 `export {` 和 `export default`，害得**手写的
 * 单文件插件**（最常见就是 `export const name = ...` 开头）被当成 UMD 拒之门外，用户把
 * 文件丢进插件目录却怎么刷都不出现。这些形式都得认：
 *   export const/let/var/function/class/async      命名声明导出
 *   export { a, b as c }                           导出列表
 *   export default ...                             默认导出
 *   export * from '...'                            再导出
 *
 * 实现上先剥掉注释与字符串再扫，避免"注释里写了 export"造成误判；
 * 不做完整 JS 解析（没必要，也省一个依赖）。
 */
async function looksLikeEsm(file: string): Promise<boolean> {
  try {
    const text = await fs.readFile(file, 'utf8')
    return hasTopLevelExport(text)
  } catch {
    return false
  }
}

/** 是否存在顶层 `export` 语句（词法扫描，跳过注释与字符串） */
export function hasTopLevelExport(source: string): boolean {
  const code = stripCommentsAndStrings(source)
  return /(^|[\n;{}(])\s*export\b/.test(code)
}

/**
 * 把注释与字符串字面量替换成等长空白（保留换行，行号/位置关系不被打乱）。
 * 目的是不让注释或字符串里出现的 `export` 造成误判。
 */
function stripCommentsAndStrings(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    // 行注释
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    // 块注释
    if (c === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }
    // 字符串字面量（' " ` 三种引号；模板串里的 ${} 也一并当字符串处理，足够用）
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '
      i++
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += ' '
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/** 插件 id：优先 package.json 的 name（去掉 @mini-canvas/ 作用域，稳定且人可读），否则用目录名 */
async function readPluginId(pkgDir: string, fallback: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8')
    const name = (JSON.parse(raw) as { name?: string }).name
    if (typeof name === 'string' && name) return name.replace(/^@[^/]+\//, '')
  } catch {
    /* 没有/坏掉的 package.json 不致命：用目录名当 id */
  }
  return fallback
}

/**
 * 读取托管根下的一个文件（挡住路径穿越）。
 * 返回 undefined 表示"这个路径上没有文件"。
 */
async function readWithin(root: string, rel: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const target = path.resolve(root, '.' + path.posix.normalize('/' + rel))
  // 解析后必须仍在 root 内（`..`、绝对路径注入都在这里被挡下）
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (target !== root && !target.startsWith(rootWithSep)) return undefined
  try {
    const buf = await fs.readFile(target)
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  } catch {
    return undefined
  }
}

/** 没构建 ui 时给一句人话，而不是白屏 404 */
const NO_UI_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>mini-canvas</title>
<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:640px;margin:80px auto;line-height:1.7;color:#111}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px}</style></head><body>
<h1>还没构建画布界面</h1>
<p>服务已经在跑了，但没找到 <code>packages/ui/dist</code>。先构建一次：</p>
<pre><code>cd packages/ui
pnpm build</code></pre>
<p>然后刷新这个页面。数据接口（<code>/api/kv/*</code>、<code>/api/files</code>）现在就是可用的。</p>
</body></html>`

/** 画布界面路由：托管 ui 产物（SPA：找不到的路径回落 index.html） */
export function uiRoutes(uiDist: string | undefined): Hono {
  const app = new Hono()
  app.get('*', async (c) => {
    if (!uiDist) {
      return c.html(NO_UI_PAGE, 200)
    }
    const rel = c.req.path
    if (rel !== '/' && rel !== '') {
      const bytes = await readWithin(uiDist, rel)
      if (bytes) return c.body(bytes, 200, { 'content-type': mimeFor(rel) })
    }
    const index = await readWithin(uiDist, '/index.html')
    if (index) return c.body(index, 200, { 'content-type': MIME_BY_EXT['.html'] })
    return c.html(NO_UI_PAGE, 200)
  })
  return app
}

/** 插件路由：清单 + 插件产物（两者都要扫描磁盘，改完刷新即生效） */
export function pluginRoutes(pluginsDir: string | undefined): Hono {
  const app = new Hono()

  app.get('/plugin-manifest.json', async (c) => {
    const plugins = await buildManifest(pluginsDir)
    if (pluginsDir && !(await exists(pluginsDir))) {
      // 目录不存在不是错（可能只是还没建插件），但说清楚更好排查
      return c.json({ plugins: [], note: `插件目录不存在: ${pluginsDir}` })
    }
    return c.json({ plugins })
  })

  app.get('/plugins/:pkg/:file', async (c) => {
    const { pkg, file } = c.req.param()
    if (!pluginsDir) return c.json({ ok: false, error: '未配置插件目录' }, 404)
    // 只允许"一层名字"：字符白名单 + 显式拒绝 `..`（`.` 本身在白名单里，光靠正则挡不住穿越）
    if (!/^[\w.@-]+$/.test(pkg) || pkg.includes('..') || !/^[\w.-]+\.js$/.test(file) || file.includes('..')) {
      return c.json({ ok: false, error: '非法路径' }, 400)
    }
    const bytes = await readWithin(path.join(pluginsDir, pkg, 'dist'), file)
    if (!bytes) return c.json({ ok: false, error: '插件文件不存在' }, 404)
    return c.body(bytes, 200, {
      'content-type': MIME_BY_EXT['.js'],
      // 开发期别缓存插件：改完刷新就要生效
      'cache-control': 'no-cache',
    })
  })

  // 扁平形态：插件目录下直接放的单个 js（`/plugins/my-plugin.js`）。
  // 注册在上面那条带目录的路由之后，避免把 `/plugins/pkg/file.js` 抢走。
  app.get('/plugins/:file', async (c) => {
    const file = c.req.param('file')
    if (!pluginsDir) return c.json({ ok: false, error: '未配置插件目录' }, 404)
    if (!/^[\w.-]+\.js$/.test(file) || file.includes('..')) {
      return c.json({ ok: false, error: '非法路径' }, 400)
    }
    const bytes = await readWithin(pluginsDir, file)
    if (!bytes) return c.json({ ok: false, error: '插件文件不存在' }, 404)
    return c.body(bytes, 200, {
      'content-type': MIME_BY_EXT['.js'],
      'cache-control': 'no-cache',
    })
  })

  return app
}

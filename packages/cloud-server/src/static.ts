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
import { Hono } from 'hono'

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
 * 候选覆盖两种启动姿势：仓库根启动、包目录内启动、以及装在 node_modules 里的独立包。
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
  ]
  for (const c of candidates) {
    if (await isDir(c)) return c
  }
  return undefined
}

/** 找插件目录（含 dist 的插件包所在目录）：显式给了就用它，否则按候选顺序探测 */
export async function resolvePluginsDir(explicit?: string): Promise<string | undefined> {
  if (explicit) {
    if (!(await isDir(explicit))) throw new Error(`--plugins 指定的目录不存在: ${explicit}`)
    return path.resolve(explicit)
  }
  const candidates = [
    path.resolve('packages/plugins'),
    path.resolve('../plugins'),
    path.resolve('plugins'),
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
 * 判据用"有顶层 export 语句"：vite 的 es 产物结尾是 `export{a as b,...}`；
 * UMD 产物整个包在 `(function(){...})()` 里、没有顶层 export，于是被排除。
 * 只看前 4KB + 全文扫 export 两处，够用且不用完整解析 JS。
 */
async function looksLikeEsm(file: string): Promise<boolean> {
  try {
    const text = await fs.readFile(file, 'utf8')
    return /(^|[\n;])\s*export\s*[{*]/.test(text) || /\n\s*export\s+default\b/.test(text)
  } catch {
    return false
  }
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

  return app
}

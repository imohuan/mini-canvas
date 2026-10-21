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
import { getConnInfo } from '@hono/node-server/conninfo'
import { buildPluginCatalog } from './plugins/catalog.js'

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
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
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
 * 插件资源扩展名白名单（服务端发插件目录里的文件时用）。
 *
 * 为什么要放开到非 .js：插件的产物**不一定只有一个 js** —— 超过 vite 内联阈值的大图、
 * 显式 ?url 引用的资源、new URL('./x.png', import.meta.url) 这类写法都会另存成兄弟文件，
 * 插件运行时要去取。仍只放白名单内的静态资源，不给任意文件当下载器。
 */
const PLUGIN_ASSET_EXTS = new Set([
  'js', 'mjs', 'cjs', 'css', 'json', 'txt',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'webm', 'ogg', 'wav',
  'wasm',
])

/** 每段路径的名字白名单（不含分隔符） */
const PLUGIN_SEG_RE = /^[\w.@-]+$/

/**
 * 解析一个「插件资源」请求：/plugins/<pkg>/<相对路径…>
 * 逐段校验 + 扩展名白名单；不合法给明确原因（服务端据此回 400）。
 */
export function resolvePluginAsset(urlPath: string): { rel: string } | { error: string } {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '')
  const m = clean.match(/^\/plugins\/(.+)$/)
  if (!m) return { error: '未知路径' }
  const segs = m[1]!.split('/')
  for (const seg of segs) {
    if (!seg || seg === '.' || seg === '..' || !PLUGIN_SEG_RE.test(seg)) return { error: '非法路径段' }
  }
  const ext = (segs[segs.length - 1]!.split('.').pop() ?? '').toLowerCase()
  if (!PLUGIN_ASSET_EXTS.has(ext)) return { error: '不允许的资源类型：.' + ext }
  // 扁平形态（单段）：文件直接放在插件目录下，不套 <pkg>/dist。
  if (segs.length === 1) return { rel: segs[0]! }
  const [pkg, ...rest] = segs
  return { rel: [pkg!, 'dist', ...rest].join('/') }
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

    // 冷启动自带插件（miniCanvas.builtin: true）不进外部清单。
    // 为什么必须卡：它们由应用 APP_PLUGINS 装配，产物多为「external @mini-canvas/* 的 ESM」，
    // 被 install({ url }) 走 import(data:…) 加载时裸模块名解析不了，每次开页必炸一条
    // "Failed to resolve module specifier"（实测：plugin-bottom-bar）。
    if (await isBuiltinPlugin(path.join(pluginsDir, name))) continue

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
 * 该插件目录是否为**冷启动自带件**（package.json 声明 miniCanvas.builtin: true）。
 * 与 /plugin-catalog.json 的 builtin 判据同源（见 plugins/catalog.ts 的 isBuiltin）。
 */
async function isBuiltinPlugin(pkgDir: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { miniCanvas?: { builtin?: boolean } }
    return pkg.miniCanvas?.builtin === true
  } catch {
    return false
  }
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
export function uiRoutes(
  uiDist: string | undefined,
  /**
   * 托管页要不要**顺手把管理令牌写进页面**（缺省不写）。
   *
   * 为什么需要：后台默认给写入口加了令牌，而令牌要用户自己去「设置 → 插件」粘贴一次。
   * 同机打开画布的人，本来就从启动日志里能看到那串 —— 让他再抄一遍纯属多余；
   * 忘了抄的表现是「所有写操作 403、节点上写着执行失败」，且看不出原因（真实踩到）。
   *
   * 只在**本机回环地址**访问时才允许：远程访问（局域网 / 反代）不注入，
   * 否则等于把令牌发给任何能打开这个页面的人。
   */
  adminTokenForLocal?: () => string | undefined,
  /**
   * **彻底关闭注入**的开关。
   *
   * 为什么需要：「有转发头就不注入」的分界只能挡住**标准**反代。反代若被配成
   * `--reset-headers`（透传 Host、删掉所有转发头），三个条件会同时成立，令牌照样泄露。
   * 部署者知道自己要挂反代时，设 `MINI_CANVAS_NO_TOKEN_INJECTION=1` 一刀切 ——
   * 所有用户都去「设置 → 插件」手填，代价只是多一次粘贴。
   */
  noTokenInjection?: boolean,
): Hono {
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
    if (index) {
      // 本机访问：把令牌一起注进去（见参数说明）；非本机返回空串 → 不注
      const token =
        !noTokenInjection && isLoopbackRequest(c) ? adminTokenForLocal?.() : undefined
      // 往 index.html 里插一行**宿主标记**：告诉这份界面"你是被 cloud-server 托管的"。
      //
      // 为什么要它：前端据此把「云端连接（cloud-client）」当**自带件开机直接启动**
      // （用户口径：cloud-server 起的服务，cloud-client 应该在自带里直接启动）——
      // 后台就在同源，这类部署本来就是要连后台的，不该让用户先去面板点一次安装。
      // 而 ui 单独 dev / 别人自己托管时没有这行标记 → 不自动装，仍由用户在面板里选装。
      //
      // 为什么让服务端插而不是前端猜：看 URL/端口都不准（dev 走代理、端口会顺延，同源时分不出来），
      // 只有"发页面的人"自己声明最可靠。html 里已有 </head> 用来插；没有（异常产物）就原样发。
      // no-cache（用户口径 2026-10-16）：前端更新后用户浏览器还在用**缓存的旧
      // index.html** —— 旧 hash 引用的资产早已不在，新功能"永远加载不出来"，
      // 必须手动清缓存。index.html 本体不带 hash，本就该每次校验；资产文件名里
      // 有 content hash，可以放心长缓存（浏览器默认策略即可）。
      return c.body(injectHostFlag(injectAdminToken(index, token)), 200, {
        'content-type': MIME_BY_EXT['.html'],
        'cache-control': 'no-cache',
      })
    }
    return c.html(NO_UI_PAGE, 200)
  })
  return app
}

/** 宿主标记的 meta（前端 assembly.ts 的 CLOUD_HOST_FLAG 与之同名，两处必须一致） */
const HOST_FLAG_META = '<meta name="mini-canvas-host" content="cloud-server">'

/**
 * 把宿主标记插进 index.html 的 </head> 之前（幂等：已经有就不再插一次）。
 * 用 TextDecoder/Encoder 过一遍 UTF-8，避免中文页面被截断。
 */
function injectHostFlag(html: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const text = new TextDecoder().decode(html)
  if (text.includes('name="mini-canvas-host"')) return html
  // 落点优先级：</head> 前 → <body 前 → 最前面。
  // 为什么要兜底：正常产物一定带 </head>，但极简/手写的 index.html（测试夹具就是这种）可能没有，
  // 那种情况下也得让标记出现在响应里 —— 前端靠它判"是不是托管版"，缺了就等于托管版不自动连后台。
  const at = pickInsertAt(text)
  const next = text.slice(0, at) + HOST_FLAG_META + '\n' + text.slice(at)
  return new TextEncoder().encode(next) as Uint8Array<ArrayBuffer>
}

/**
 * 把管理令牌写进页面（`window.__MC_ADMIN_TOKEN__`）。
 *
 * 前端启动时读它、存进 localStorage，与「设置 → 插件」里手填的那份同一个键 ——
 * 于是同机打开画布的人不用再抄一遍令牌。只在本机回环访问时调用（见 uiRoutes）。
 */
function injectAdminToken(html: Uint8Array<ArrayBuffer>, token: string | undefined): Uint8Array<ArrayBuffer> {
  if (!token) return html
  const text = new TextDecoder().decode(html)
  if (text.includes('__MC_ADMIN_TOKEN__')) return html
  /*
   * 把值安全地放进 `<script>`。
   *
   * 为什么要额外转义：`JSON.stringify` 不会转义 `<`，令牌万一含 `</script>`
   * （`MINI_CANVAS_ADMIN_TOKEN` 是**不校验格式**的，任何人都能设）就会提前闭合脚本标签，
   * 后面的内容变成真脚本 —— 等于给本机管理页注入任意同源脚本。
   * 把 `<` 写成 `\u003c` 之后，字符串在 JS 里的值不变，但 HTML 解析器看不到 `</script>`。
   */
  const literal = JSON.stringify(token).split('<').join('\\u003c')
  const script = '<script>window.__MC_ADMIN_TOKEN__=' + literal + '</script>\n'
  const at = pickInsertAt(text)
  return new TextEncoder().encode(text.slice(0, at) + script + text.slice(at)) as Uint8Array<ArrayBuffer>
}

/**
 * 这次请求是不是**真正的本机直连**（可以放心把令牌给它）。
 *
 * 两个条件**同时**满足才算：
 *
 *   1. TCP 对端是回环地址（`getConnInfo`）。
 *      —— 不能只看 `Host`：那是客户端自己写的。`--host 0.0.0.0` 时局域网里任何一台机器
 *      发个 `Host: 127.0.0.1` 就能骗过去（审查时真机复现过）。
 *   2. `Host` 也是回环写法。
 *      —— 防**同机反代**：nginx 与服务跑在同一台机器时，对端也是 127.0.0.1，
 *      但外面访问的人 Host 是域名。只看第 1 条会把令牌发给所有通过反代来的人。
 *
 * 两者都满足只可能是「本机浏览器直连本服务」。代价是：用户用自定义本机域名
 * （如 `mycanvas.local`）访问时不会自动注入，得自己填一次 —— 宁可多填一次，
 * 也不要把令牌发给身份不明的一方。
 *
 * 拿不到对端地址（非 Node 适配器 / 测试里的裸 request）→ 一律当作**不是**本机。
 */
function isLoopbackRequest(c: unknown): boolean {
  let remote: string | undefined
  try {
    remote = getConnInfo(c as never).remote.address
  } catch {
    return false
  }
  if (!remote) return false
  // Node 会把 IPv4 映射成 ::ffff:127.0.0.1，两种写法都要认
  const addr = remote.toLowerCase().replace(/^::ffff:/, '')
  if (addr !== '127.0.0.1' && addr !== '::1') return false

  const header = (n: string): string | undefined => {
    try {
      return (c as { req?: { header?(k: string): string | undefined } }).req?.header?.(n)
    } catch {
      return undefined
    }
  }

  /*
   * 第三道：**任何转发头都不能有**。
   *
   * 前两道挡不住同机反代：nginx 默认 `proxy_set_header Host $proxy_host` 会把 Host
   * 改写成本服务的回环地址，此时「对端是 127.0.0.1」+「Host 是 127.0.0.1」同时成立，
   * 但请求其实来自公网（审查用真实代理复现过，令牌直接泄露）。
   *
   * 反代一定会留下转发头（`X-Forwarded-For` / `X-Real-IP` / `Forwarded` 至少一个），
   * 而本机浏览器直连不会带这些头 —— 所以「有任意一个就不注入」是可靠的分界。
   * 反代用户要是没配转发头：那种部署本身就拿不到真实来源，宁可让他手填一次令牌。
   */
  for (const name of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto']) {
    const v = header(name)
    if (v !== undefined && v.trim() !== '') return false
  }

  // 第二道：Host 也必须是回环
  const host = (header('host') ?? '').toLowerCase()
  if (!host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '')
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

/** 选插入点：</head> 前 / <body 前 / 文首 */
function pickInsertAt(text: string): number {
  const head = text.indexOf('</head>')
  if (head >= 0) return head
  const body = text.search(/<body\b/i)
  if (body >= 0) return body
  return 0
}

/** 插件路由：清单 + 插件产物（两者都要扫描磁盘，改完刷新即生效） */
export function pluginRoutes(pluginsDir: string | undefined): Hono {
  const app = new Hono()

  app.get('/plugin-manifest.json', async (c) => {
    const plugins = await buildManifest(pluginsDir)
    if (pluginsDir && !(await exists(pluginsDir))) {
      // 目录不存在不是错（可能只是还没建插件），但说清楚更好排查
      return c.json({ plugins: [], note: '插件目录不存在: ' + pluginsDir })
    }
    return c.json({ plugins })
  })

  /**
   * 插件管理要的清单：只列**声明了 miniCanvas.installable 的 UMD 插件**。
   * 与上面的 /plugin-manifest.json（ESM，给应用冷启动用）各管一摊，详见 plugins/catalog.ts 文件头。
   */
  app.get('/plugin-catalog.json', async (c) => {
    return c.json(await buildPluginCatalog(pluginsDir))
  })

  // 插件资源：/plugins/<pkg>/<相对路径…>（嵌套）或 /plugins/<file>（扁平）。
  // 用**通配**（不是 :pkg/:file）—— 否则子目录资源（assets/logo.svg）匹配不上，
  // 会掉进静态层的 SPA 回落、拿到一份 index.html（实测踩过：svg 的 content-type 成了 text/html）。
  app.get('/plugins/*', async (c) => {
    if (!pluginsDir) return c.json({ ok: false, error: '未配置插件目录' }, 404)
    const resolved = resolvePluginAsset(c.req.path)
    if ('error' in resolved) return c.json({ ok: false, error: resolved.error }, 400)
    const bytes = await readWithin(pluginsDir, resolved.rel)
    if (!bytes) return c.json({ ok: false, error: '插件文件不存在' }, 404)
    return c.body(bytes, 200, {
      'content-type': mimeFor(resolved.rel),
      // 开发期别缓存插件：改完刷新就要生效
      'cache-control': 'no-cache',
    })
  })

  return app
}

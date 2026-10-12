/**
 * catalogPlugin —— 开发期（vite dev server）的插件路由托管。
 *
 * 为什么需要它：生产形态下，这三条路由由 cloud-server 提供，画布界面也由它托管 —— 同源、开箱即用：
 *   /plugin-catalog.json   「插件管理」页的清单（installable 的 UMD 插件）
 *   /plugin-manifest.json  应用冷启动的**外部插件清单**（可 import 的 ESM 产物，如云端客户端）
 *   /plugins/**            上面两条清单里插件的产物字节
 * 但平时开发是「ui 单独起 dev（:5288）+ 后台在别处或没起」：这时三条路由都没人应答 ——
 * 插件管理页会空着、ui 也没法默认装那些插件；更要命的是**后台客户端（plugin-cloud-client）
 * 装不上**，于是 dev 下画布永远连不到 cloud-server（改了后端接口只能整包重来）。
 *
 * 这个 vite 插件把这三条路由在 dev 里就地实现一次（判定口径与 cloud-server 的
 * src/plugins/catalog.ts 与 src/static.ts 一致）：扫 packages/plugins，按形态列清单、发产物字节。
 * 于是 dev（:5288）与生产（:8865）对宿主是同一副面孔：画布数据 / 动作 / 历史 / 实时通道
 * 走 vite 的 /api 代理打到后台，插件装载走这里 —— 「前端改代码 HMR 即生效、后台照旧连真服务」。
 *
 * 只在 dev 生效（apply: 'serve'）；vite build 的产物里没有它 —— 生产仍由 cloud-server 提供。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 产物运行时可能需要的 window 全局（与 vite-plugin-lib 的 HOST_GLOBALS 对应） */
const KNOWN_GLOBALS = [
  'Vue', 'VueFlow', 'MiniCanvasKernel', 'MiniCanvasBase', 'MiniCanvasCore', 'MiniCanvasRender',
  'ProseMirrorEditorBundle', 'THREE',
]

const ASSET_EXTS = new Set([
  'js', 'mjs', 'cjs', 'css', 'json', 'txt',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'webm', 'ogg', 'wav', 'wasm',
])
const SEG_RE = /^[\w.@-]+$/

const MIME = {
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', wav: 'audio/wav',
  wasm: 'application/wasm',
}
const mimeFor = (f) => MIME[(f.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream'

const parseGlobal = (text) => text.match(/\.(MiniCanvasPlugin[A-Za-z0-9_]+)\s*=\s*\{\}/)?.[1]
const parseRequires = (text) => {
  const a = text.match(/\.MiniCanvasPlugin[A-Za-z0-9_]+\s*=\s*\{\}/)
  if (!a || a.index === undefined) return []
  const head = text.slice(a.index, a.index + 800)
  return KNOWN_GLOBALS.filter((g) => new RegExp('[,(]\\s*[a-zA-Z_$][\\w$]*\\.' + g + '\\b').test(head))
}

/** 扫插件目录，生成清单（与 cloud-server 的 buildPluginCatalog 同口径） */
async function buildCatalog(pluginsDir) {
  const plugins = []
  const skipped = []
  let names = []
  try { names = await fs.readdir(pluginsDir) } catch { return { ok: true, version: 0, plugins, skipped } }
  for (const pkgName of names.sort()) {
    if (pkgName.startsWith('_') || pkgName.startsWith('.')) continue
    const pkgDir = path.join(pluginsDir, pkgName)
    let st
    try { st = await fs.stat(pkgDir) } catch { continue }
    if (!st.isDirectory()) continue
    let pkg = {}
    try { pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8')) } catch {}
    const mc = pkg.miniCanvas ?? {}
    const isInstallable = mc.installable === true
    const isBuiltin = mc.builtin === true
    if (!isInstallable && !isBuiltin) { skipped.push({ file: pkgName, reason: '未声明 miniCanvas.installable / builtin' }); continue }
    const base = {
      id: pkgName,
      name: mc.pluginName ?? String(pkg.name ?? pkgName).replace(/^@[^/]+\//, ''),
      title: mc.title ?? pkgName,
      ...(mc.description ? { description: mc.description } : {}),
      ...(pkg.version ? { version: pkg.version } : {}),
    }
    // 自带插件：只要 package.json 声明即可列出（不必构建 UMD，它由应用冷启动装配）
    if (isBuiltin) {
      plugins.push({ ...base, url: '', globalName: '', requiresGlobals: [], defaultInstalled: true, builtin: true })
      continue
    }
    // 可装卸插件：产物得能被面板装进内核 —— UMD（script + 全局）或自包含 ESM（import）都行。
    // 两条路必须明确区分（format 字段）：混着猜就会"列出来了却装不上"。
    const distDir = path.join(pkgDir, 'dist')
    let files = []
    try { files = (await fs.readdir(distDir)).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js')) } catch {
      skipped.push({ file: pkgName, reason: '没有 dist（先构建该插件）' }); continue
    }
    let file = ''
    let text = ''
    let format
    for (const candidate of files.sort()) {
      const candidateText = await readTextSafe(path.join(distDir, candidate))
      if (!candidateText) continue
      const declared = mc.web?.format
      const isEsm = declared === 'esm' || (declared === undefined && isSelfContainedEsm(candidateText))
      if (isEsm) { file = candidate; text = candidateText; format = 'esm'; break }
      if (parseGlobal(candidateText)) { file = candidate; text = candidateText; format = 'umd'; break }
    }
    if (!file) {
      skipped.push({ file: pkgName, reason: '产物既不是可脚本加载的 UMD、也不是自包含 ESM' }); continue
    }
    plugins.push({
      ...base,
      url: '/plugins/' + pkgName + '/' + file,
      format,
      globalName: format === 'umd' ? parseGlobal(text) : '',
      requiresGlobals: format === 'umd' ? parseRequires(text) : [],
      // 默认安装改为**显式 opt-in**（缺省 false）：用户要求面板首次一个都不自动装。
      defaultInstalled: mc.defaultInstalled === true,
    })
  }
  return { ok: true, version: plugins.length, plugins, skipped }
}

/** 解析 /plugins/<pkg>/<相对路径>（嵌套）或 /plugins/<file>（扁平）；挡穿越 + 扩展名白名单 */
function resolveAsset(pluginsDir, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '')
  const m = clean.match(/^\/plugins\/(.+)$/)
  if (!m) return null
  const segs = m[1].split('/')
  for (const seg of segs) if (!seg || seg === '.' || seg === '..' || !SEG_RE.test(seg)) return null
  const ext = (segs[segs.length - 1].split('.').pop() ?? '').toLowerCase()
  if (!ASSET_EXTS.has(ext)) return null
  const rel = segs.length === 1 ? segs[0] : [segs[0], 'dist', ...segs.slice(1)].join('/')
  const target = path.resolve(pluginsDir, rel)
  const root = pluginsDir.endsWith(path.sep) ? pluginsDir : pluginsDir + path.sep
  return target.startsWith(root) ? target : null
}

/**
 * 只剥掉**注释**（等长空白替换，保留换行），字符串原样留着。
 *
 * 为什么不能连字符串一起剥：判"有没有裸模块名 import"要看引号里的 specifier（from "vue"），
 * 抹掉字符串就等于把 import 全漏判（一份 import 'vue' 的产物会被误认成自包含 ESM）。
 * 剥注释是为了不让注释里的 export/import 造成误判 —— 这正是 hasTopLevelExport 需要的。
 */
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      if (i < n) { out += '  '; i += 2 }
      continue
    }
    out += c
    i++
  }
  return out
}

/** 是否存在顶层 export（判"能不能按 URL 直接 import"） */
function hasTopLevelExport(source) {
  return /(^|[\n;{}(])\s*export\b/.test(stripComments(source))
}

/**
 * 是不是**自包含 ESM**（能安全交给 manager.install({ url }) 加载）。
 * 与 cloud-server 的 catalog.ts 的 isSelfContainedEsm 同口径：
 * 有顶层 export，且**没有任何裸模块名 import**（加载路是 import(data:text/javascript)，
 * 裸模块名解析不了 → 直接炸）。
 *
 * 这里**只剥注释、保留字符串** —— 判裸模块名必须看得到引号里的 specifier（from "vue"）；
 * 若连字符串一起抹掉，所有 import 都会漏判，一份 import 'vue' 的产物会被误当成自包含件。
 */
function isSelfContainedEsm(source) {
  const code = stripComments(source)
  if (!/(^|[\n;{}(])\s*export\b/.test(code)) return false
  const BARE = /(?:^|[\n;{}(])\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g
  const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]/g
  for (const re of [BARE, DYNAMIC]) {
    let m
    while ((m = re.exec(code))) {
      if (!/^(\.\/|\.\.\/|\/|data:|https?:|blob:)/.test(m[1] ?? '')) return false
    }
  }
  return true
}

/** 读产物文本；读不到返回 ''（当作不是 ESM） */
async function readTextSafe(file) {
  try { return await fs.readFile(file, 'utf8') } catch { return '' }
}

/** 该插件目录是不是"冷启动自带件"（package.json 声明 miniCanvas.builtin: true） */
async function isBuiltinPlugin(pkgDir) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'))
    return pkg.miniCanvas?.builtin === true
  } catch { return false }
}

/** 插件 id：优先 package.json 的 name（去作用域），否则用目录名 */
async function readPluginId(pkgDir, fallback) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name) return pkg.name.replace(/^@[^/]+\//, '')
  } catch { /* 没有/坏掉的 package.json 不致命：用目录名当 id */ }
  return fallback
}

/**
 * 生成「外部插件清单」（/plugin-manifest.json），与 cloud-server 的 buildManifest 同口径。
 *
 * 这份清单是**应用冷启动**那条路：宿主拿它逐条 install({ url })，而那条路是
 * fetch 文本 → import(data:text/javascript,…)。所以这里只收**能当 URL 模块加载的 ESM 产物**：
 *   · 打包插件（形如 <包>/dist/*.js）在 package.json 声明了 miniCanvas.builtin: true 的跳过 ——
 *     它们由应用源码装配，且产物多 external 掉 @mini-canvas/*，走 data: URL 解析不了裸模块名；
 *   · UMD 产物（无顶层 export）跳过 —— 它们靠 <script> 全局注入，data: URL 里会直接抛错。
 * 现状下真正命中的就是 plugin-cloud-client（零 import 的自包含 ESM）。
 *
 * 与本包 dev 的关系：**这就是"dev 下也能连后台"的关键那一条**。生产由 cloud-server 提供，
 * dev 里没人应答 → 请求回落到 index.html → JSON 解析失败 → 空清单 → 云端客户端永远装不上。
 */
export async function buildManifest(pluginsDir) {
  let names = []
  try { names = await fs.readdir(pluginsDir) } catch { return [] }
  const out = []
  for (const name of names.sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    const full = path.join(pluginsDir, name)

    // 形态一：目录下直接放的单个 .js 文件（手写小插件试水）
    if (name.endsWith('.js') && !name.endsWith('.min.js')) {
      if (!hasTopLevelExport(await readTextSafe(full))) continue
      out.push({ id: name.slice(0, -'.js'.length), url: '/plugins/' + name })
      continue
    }

    let st
    try { st = await fs.stat(full) } catch { continue }
    if (!st.isDirectory()) continue
    // 冷启动自带件不进外部清单（见函数注释第 1 条）
    if (await isBuiltinPlugin(full)) continue

    // 形态二：<包名>/dist/<产物>.js
    const distDir = path.join(full, 'dist')
    let files = []
    try { files = (await fs.readdir(distDir)).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js')) } catch { continue }
    const file = files.sort()[0]
    if (!file) continue
    if (!hasTopLevelExport(await readTextSafe(path.join(distDir, file)))) continue
    out.push({ id: await readPluginId(full, name), url: '/plugins/' + name + '/' + file })
  }
  return out
}

export function catalogPlugin(options = {}) {
  const pluginsDir = path.resolve(options.pluginsDir ?? 'packages/plugins')
  return {
    name: 'mini-canvas-plugin-catalog',
    apply: 'serve', // 只在 dev server 生效
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/'
        const routePath = url.split('?')[0]
        // 应用冷启动的外部插件清单（ESM 产物）。少这条，dev 下云端客户端（plugin-cloud-client）
        // 永远装不上 —— 请求会回落到 index.html，宿主拿到 HTML 当 JSON 解析失败 → 空清单。
        if (routePath === '/plugin-manifest.json') {
          buildManifest(pluginsDir).then((plugins) => {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-cache')
            res.end(JSON.stringify({ plugins }))
          }).catch(next)
          return
        }
        if (routePath === '/plugin-catalog.json') {
          buildCatalog(pluginsDir).then((c) => {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-cache')
            res.end(JSON.stringify(c))
          }).catch(next)
          return
        }
        if (url.startsWith('/plugins/')) {
          const target = resolveAsset(pluginsDir, url)
          if (!target) { res.statusCode = 400; res.end('bad plugin path'); return }
          fs.readFile(target).then((bytes) => {
            res.setHeader('content-type', mimeFor(target))
            res.setHeader('cache-control', 'no-cache')
            res.end(bytes)
          }).catch(() => { res.statusCode = 404; res.end('plugin file not found') })
          return
        }
        next()
      })
    },
  }
}

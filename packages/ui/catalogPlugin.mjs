/**
 * catalogPlugin —— 开发期（vite dev server）的插件清单与产物托管。
 *
 * 为什么需要它：生产形态下，插件清单与产物由 cloud-server 提供
 * (/plugin-catalog.json + /plugins/**)，画布界面也由它托管 —— 同源、开箱即用。
 * 但平时开发是「ui 单独起 dev（:5288）+ 后台在别处或没起」：
 * 这时 /plugin-catalog.json 没人应答，插件管理页会空着，ui 自己也没法默认装那些插件。
 *
 * 这个 vite 插件把那条路由在 dev 里就地实现一次（判定口径与 cloud-server 的
 * src/plugins/catalog.ts 一致）：扫 packages/plugins，列 installable 的 UMD 插件，并发产物字节。
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
    // 可装卸插件：必须有可脚本加载的 UMD 产物
    const distDir = path.join(pkgDir, 'dist')
    let files = []
    try { files = (await fs.readdir(distDir)).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js')) } catch {
      skipped.push({ file: pkgName, reason: '没有 dist（先构建该插件）' }); continue
    }
    const file = files.sort()[0]
    if (!file) { skipped.push({ file: pkgName, reason: 'dist 里没有 .js' }); continue }
    let text = ''
    try { text = await fs.readFile(path.join(distDir, file), 'utf8') } catch (e) {
      skipped.push({ file: pkgName, reason: '读产物失败：' + e.message }); continue
    }
    const globalName = parseGlobal(text)
    if (!globalName) { skipped.push({ file: pkgName, reason: '不是可脚本加载的 UMD 产物' }); continue }
    plugins.push({
      ...base,
      url: '/plugins/' + pkgName + '/' + file,
      globalName,
      requiresGlobals: parseRequires(text),
      defaultInstalled: mc.defaultInstalled ?? true,
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

export function catalogPlugin(options = {}) {
  const pluginsDir = path.resolve(options.pluginsDir ?? 'packages/plugins')
  return {
    name: 'mini-canvas-plugin-catalog',
    apply: 'serve', // 只在 dev server 生效
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/'
        if (url.split('?')[0] === '/plugin-catalog.json') {
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

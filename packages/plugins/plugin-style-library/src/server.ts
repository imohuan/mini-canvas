/**
 * plugin-style-library · 后台半 —— 「本地素材库」的服务端（风格库 + 特效库）。
 *
 * ## 它是什么
 *
 * 一个**前后端成对**插件的后台那一半：把磁盘上的一个**资源目录**读成可分页查询的素材库，
 * 并把目录里的图片/视频原样发给前端。前端只拿 JSON（数据）与地址，**不接触文件系统**。
 *
 * 本插件同时提供**两套库**（用户口径：数据与 UI 通用，只是目录与点击效果不同）：
 *
 * | 库 | 路由前缀 | 默认目录 | 设置项 |
 * | --- | --- | --- | --- |
 * | 风格库 | \`/api/style-library\`  | \`I:/Assets/liblib-assets\` | 「常规/风格库」的资源目录 |
 * | 特效库 | \`/api/effect-library\` | \`I:/Assets/liblib-effects\` | 「常规/风格库」的特效目录 |
 *
 * 两者共用**同一套处理逻辑**（下面 \`makeLibrary(spec)\`），只是目录、前缀、分类策略不同。
 *
 * ## 数据从哪来
 *
 * 目录里的 \`index.json\` 是**扒取时生成的索引**（不需要手工维护）。两种索引形状都认：
 * - 风格库：\`images: ["<本地文件名>", …]\`（已经是文件名）
 * - 特效库：\`images: [{ imageUrl, webpUrl, … }]\`（URL —— 会按"URL 文件名 → 本地文件名"的
 *   候选规则去磁盘上找：原文件名 / \`tool_cinematic_<名>\` / 风格库那种 \`hash_hash.ext\`）
 *
 * 找不到索引就**退化成扫目录**（把目录里的图片/视频当无名条目）。
 * 服务端第一次用到时读一次并缓存，目录变更经 \`PUT /settings\` 或 \`POST /reload\` 重扫。
 *
 * ## 每条素材还带"预览视频"
 *
 * 特效目录里除封面图外还有 **mp4 效果预览**（\`tool_cinematic_<编号>.mp4\`）。扫盘时顺带找同名的
 * mp4，放进 \`videos\` —— 前端点全屏预览时优先放视频（没有才放封面图）。
 * 风格目录没有 mp4，这条自然为空。
 *
 * ## 路由（每个库同一套）
 *
 *   GET  <前缀>/meta        → 概览（条目数 / 文件数 / 分类 / 数据源 / 是否就绪）
 *   GET  <前缀>/items       → 分页查询 ?offset=&limit=&category=&q=&sort=
 *   GET  <前缀>/file?name=X → 目录里的一个文件（长缓存；白名单扩展名 + 防穿越）
 *   GET  <前缀>/settings    → 当前生效的资源目录
 *   PUT  <前缀>/settings    → 改资源目录（先自证可读，再落盘 + 重扫）
 *   POST <前缀>/reload      → 重扫目录
 *
 *   ⚠️ 文件用**查询参数**而不是路径参数 \`/file/:name\`：cloud-server 的路由代理在**运行期热装**时
 *   只按「method + 精确 pathname」现查注册场，带参数的路径匹配不上、会漏到 SPA 兜底拿回 index.html
 *   （实测）。查询参数形式两种装载路径都命中。
 *
 * ## 设置住在哪
 *
 * 资源目录路径住在**插件私有 store**（\`ctx.store\` 的 \`settings\` 命名空间，卸载即清），
 * 与 Config 里的默认值配合：Config 给默认，用户改了就写进 store。改完即重扫，无需重启。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const PLUGIN_NAME = 'style-library'
/** store 命名空间：本插件私有（卸载即清） */
const NS = 'settings'

/** 允许发送的媒体扩展名（不在这张表里的一律不给） */
const MEDIA_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'mp4', 'webm', 'mov'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov'])

/** 一个库的规格：目录 / 路由前缀 / 分类策略 */
interface LibrarySpec {
  /** 库标识（写进 store key 与日志） */
  kind: 'style' | 'effect'
  /** 路由前缀，如 \`/api/style-library\` */
  prefix: string
  /** 出厂默认目录 */
  defaultRoot: string
  /** 私有 store 里存目录的 key */
  storeKey: string
  /** 宿主可注入默认目录的服务名 */
  injectRootKey: string
  /** 是否按分类聚合（特效库不分，保持简单） */
  useCategories: boolean
}

/** 两个库的规格（唯一事实源） */
export const LIBRARIES: LibrarySpec[] = [
  {
    kind: 'style',
    prefix: '/api/style-library',
    defaultRoot: 'I:/Assets/liblib-assets',
    storeKey: 'root',
    injectRootKey: 'styleLibraryDefaultRoot',
    useCategories: true,
  },
  {
    kind: 'effect',
    prefix: '/api/effect-library',
    defaultRoot: 'I:/Assets/liblib-effects',
    storeKey: 'effectRoot',
    injectRootKey: 'effectLibraryDefaultRoot',
    useCategories: false,
  },
]

interface StyleItem {
  id: number | string
  name: string
  author: string
  category: string
  modelTypeName: string
  tags: string[]
  commercial: boolean
  exclusive: boolean
  runCount: number
  likeCount: number
  imageCount: number
  /** 封面/素材图（本地文件名） */
  images: string[]
  /** 效果预览视频（本地文件名；与 images 平行但可能为空 —— 没有就不放） */
  videos: string[]
}

interface Catalog {
  root: string
  items: StyleItem[]
  categories: Array<{ name: string; count: number }>
  ok: boolean
  source: 'index' | 'scan' | 'empty'
  error?: string
  scannedAt: string
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 把 URL 的 basename 变成"本地可能的名字"候选（磁盘上哪个存在用哪个） */
export function localCandidates(url: string): string[] {
  const clean = url.split('?')[0]!.split('#')[0]!
  const base = clean.split('/').pop() ?? ''
  if (!base) return []
  const out = [base, 'tool_cinematic_' + base]
  // 风格库那种 <hash>/<hash>.ext → 本地存成 hash_hash.ext
  const m = clean.match(/([a-f0-9]{32})\/([a-f0-9]{64}\.[a-z0-9]+)$/i)
  if (m) out.push(m[1] + '_' + m[2])
  return out
}

/** 从一条索引记录的 images 字段抽出"图片候选名"（两种形状都认） */
function imageCandidates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const im of raw) {
    if (typeof im === 'string' && im) out.push(im)
    else if (im && typeof im === 'object') {
      const o = im as Record<string, unknown>
      for (const k of ['imageUrl', 'webpUrl', 'originalImageUrl']) {
        const u = o[k]
        if (typeof u === 'string' && u) out.push(...localCandidates(u))
      }
    }
  }
  return out
}

const CATEGORY_ORDER = [
  '摄影写真', '电商营销', '动漫游戏', '风格插画', '平面设计', '建筑及室内设计',
  '创意玩法', '文创周边', '小说推文',
]

/** 条目 → 分类清单（固定表优先，其余按数量降序；「其他」压尾） */
function buildCategories(items: StyleItem[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>()
  for (const it of items) {
    const c = it.category || it.tags[0] || it.modelTypeName || '未分类'
    map.set(c, (map.get(c) ?? 0) + 1)
  }
  const rank = (name: string): number => {
    const i = CATEGORY_ORDER.indexOf(name)
    if (i >= 0) return i
    if (name === '其他' || name === '未分类') return CATEGORY_ORDER.length + 1
    return CATEGORY_ORDER.length
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count || a.name.localeCompare(b.name))
}

/** 把索引里的一条补成本插件标准的条目；坏条返回 undefined */
function normalizeItem(
  raw: Record<string, unknown>,
  files: Set<string>,
): StyleItem | undefined {
  // 图片：候选名里挑磁盘上真有的（保持顺序、去重）
  const seen = new Set<string>()
  const images: string[] = []
  for (const cand of imageCandidates(raw.images)) {
    if (!seen.has(cand) && files.has(cand)) {
      seen.add(cand)
      images.push(cand)
    }
  }
  // 兜底：索引里给了单个 imageUrl（老形状）也认
  if (!images.length && typeof raw.imageUrl === 'string') {
    for (const cand of localCandidates(raw.imageUrl)) {
      if (!seen.has(cand) && files.has(cand)) {
        seen.add(cand)
        images.push(cand)
        break
      }
    }
  }
  if (!images.length) return undefined

  // 预览视频：与图片同名的 .mp4（特效目录里有；风格目录没有）
  const videos: string[] = []
  const seenV = new Set<string>()
  for (const img of images) {
    const stem = img.replace(/\.[^.]+$/, '')
    for (const vext of VIDEO_EXTS) {
      const v = stem + '.' + vext
      if (files.has(v) && !seenV.has(v)) {
        seenV.add(v)
        videos.push(v)
      }
    }
  }

  const tags: string[] = []
  if (Array.isArray(raw.tags)) tags.push(...raw.tags.filter((t): t is string => typeof t === 'string'))
  else if (Array.isArray(raw.tagsV2)) {
    for (const g of raw.tagsV2 as Array<{ labels?: unknown }>) {
      if (!g || !Array.isArray(g.labels)) continue
      for (const l of g.labels) if (typeof l === 'string' && !tags.includes(l)) tags.push(l)
    }
  }

  const id = (raw.id as number | string | undefined) ?? images[0]!
  return {
    id: id === '' ? images[0]! : id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : '未命名',
    author:
      (typeof raw.author === 'string' && raw.author) ||
      (typeof raw.nickname === 'string' ? raw.nickname : ''),
    category: typeof raw.category === 'string' ? raw.category : '',
    modelTypeName: typeof raw.modelTypeName === 'string' ? raw.modelTypeName : '',
    tags,
    commercial: Array.isArray(raw.privilege) ? raw.privilege.includes('1') : raw.commercial === true,
    exclusive: raw.exclusive === true || tags.includes('独家'),
    runCount: typeof raw.runCount === 'number' ? raw.runCount : 0,
    likeCount: typeof raw.likeCount === 'number' ? raw.likeCount : 0,
    imageCount: typeof raw.imageCount === 'number' && raw.imageCount > 0 ? raw.imageCount : images.length,
    images,
    videos,
  }
}

/** 扫目录兜底：把目录里的图片文件当条目（没有索引时用）；同名 mp4 当它的预览视频 */
async function scanDir(root: string, files: Set<string>): Promise<StyleItem[]> {
  const items: StyleItem[] = []
  for (const n of files) {
    if (VIDEO_EXTS.has(extOf(n))) continue // 视频单独作为封面时意义不大，跳过
    if (!MEDIA_EXTS.has(extOf(n))) continue
    const stem = n.replace(/\.[^.]+$/, '')
    const videos = [...VIDEO_EXTS].map((e) => stem + '.' + e).filter((v) => files.has(v))
    items.push({
      id: n,
      name: stem,
      author: '',
      category: '',
      modelTypeName: '',
      tags: [],
      commercial: false,
      exclusive: false,
      runCount: 0,
      likeCount: 0,
      imageCount: 1,
      images: [n],
      videos,
    })
  }
  return items
}

/** 找根目录下的图库文件；仅一层、跳过 _/. 开头与元数据文件 */
async function listFiles(root: string): Promise<Set<string>> {
  try {
    const names = await fs.readdir(root)
    return new Set(names.filter((n) => !n.startsWith('_') && !n.startsWith('.')))
  } catch {
    return new Set()
  }
}

/** 真正扫盘建目录（唯一建 Catalog 的地方） */
async function buildCatalog(root: string, spec: LibrarySpec): Promise<Catalog> {
  const scannedAt = new Date().toISOString()
  const files = await listFiles(root)
  if (!files.size) {
    return {
      root, items: [], categories: [], ok: false, source: 'empty',
      error: '目录不存在或为空：' + root, scannedAt,
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'))
  } catch {
    raw = undefined
  }
  if (Array.isArray(raw)) {
    const items = raw
      .map((r) => normalizeItem((r ?? {}) as Record<string, unknown>, files))
      .filter((x): x is StyleItem => x !== undefined)
    if (items.length) {
      return {
        root, items,
        categories: spec.useCategories ? buildCategories(items) : [],
        ok: true, source: 'index', scannedAt,
      }
    }
  }
  const scanned = await scanDir(root, files)
  return {
    root, items: scanned,
    categories: spec.useCategories ? buildCategories(scanned) : [],
    ok: scanned.length > 0,
    source: scanned.length ? 'scan' : 'empty',
    ...(scanned.length ? {} : { error: '目录里没有索引文件，也没有媒体文件：' + root }),
    scannedAt,
  }
}

/** 关键词匹配：名字 / 作者 / 标签里任一命中（大小写不敏感） */
function matchQuery(it: StyleItem, q: string): boolean {
  return (it.name + ' ' + it.author + ' ' + it.tags.join(' ')).toLowerCase().includes(q)
}

/** 防穿越 + 只发媒体：返回安全文件名，或 undefined */
function safeMediaName(name: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(name)
  } catch {
    return undefined
  }
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return undefined
  const base = path.basename(decoded)
  if (base !== decoded) return undefined
  if (!MEDIA_EXTS.has(extOf(base))) return undefined
  return base
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

export const name = PLUGIN_NAME

/** 与 hono 的 Context 只需要这几个方法；不 import hono 类型以免产物拖进依赖 */
interface HonoLike {
  req: { query(k: string): string | undefined; param(k: string): string; json(): Promise<unknown> }
  json(body: unknown, status?: number): Response
  body(data: Uint8Array, status: number, headers: Record<string, string>): Response
}

/** 后台插件 ctx 的最小面（kernel 的 PluginScope 兼容；这里只列用到的） */
interface ServerCtx {
  tryGet<T = unknown>(name: string): T | undefined
  store: { namespace(name: string): {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
  } }
  routes: { get(path: string, handler: (c: HonoLike) => Promise<Response> | Response): void
            put(path: string, handler: (c: HonoLike) => Promise<Response> | Response): void
            post(path: string, handler: (c: HonoLike) => Promise<Response> | Response): void }
}

/** 一个库的运行时（缓存 + 现读设置） */
function makeLibrary(ctx: ServerCtx, settings: ReturnType<ServerCtx['store']['namespace']>, spec: LibrarySpec) {
  let cache: Catalog | null = null

  const rootOf = async (): Promise<string> => {
    const saved = await settings.get(spec.storeKey)
    if (typeof saved === 'string' && saved.trim()) return saved.trim()
    const injected = ctx.tryGet<string>(spec.injectRootKey)
    if (typeof injected === 'string' && injected) return injected
    return spec.defaultRoot
  }

  const ensure = async (force = false): Promise<Catalog> => {
    const root = await rootOf()
    if (!root) {
      return { root: '', items: [], categories: [], ok: false, source: 'empty', error: '还没设置资源目录', scannedAt: new Date().toISOString() }
    }
    if (!force && cache && cache.root === root) return cache
    cache = await buildCatalog(root, spec)
    return cache
  }

  const P = spec.prefix

  ctx.routes.get(P + '/meta', async (c: HonoLike) => {
    const cat = await ensure()
    const fileCount = cat.items.reduce((a, b) => a + b.images.length, 0)
    return c.json({
      ok: cat.ok,
      root: cat.root,
      source: cat.source,
      itemCount: cat.items.length,
      fileCount,
      categories: cat.categories,
      scannedAt: cat.scannedAt,
      ...(cat.error ? { error: cat.error } : {}),
    })
  })

  ctx.routes.get(P + '/items', async (c: HonoLike) => {
    const cat = await ensure()
    const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 40) || 40))
    const category = (c.req.query('category') ?? '').trim()
    const q = (c.req.query('q') ?? '').trim().toLowerCase()
    const sort = (c.req.query('sort') ?? 'default').trim()

    let list = cat.items
    if (category) list = list.filter((it) => (it.category || it.tags[0] || it.modelTypeName || '未分类') === category)
    if (q) list = list.filter((it) => matchQuery(it, q))
    if (sort === 'hot') list = [...list].sort((a, b) => b.runCount - a.runCount)
    else if (sort === 'like') list = [...list].sort((a, b) => b.likeCount - a.likeCount)

    const total = list.length
    const page = list.slice(offset, offset + limit)
    const fileUrl = (n: string): string => P + '/file?name=' + encodeURIComponent(n)
    return c.json({
      ok: true,
      offset,
      limit,
      total,
      hasMore: offset + page.length < total,
      items: page.map((it) => ({
        id: it.id,
        name: it.name,
        author: it.author,
        category: it.category || it.tags[0] || it.modelTypeName || '未分类',
        tags: it.tags,
        commercial: it.commercial,
        exclusive: it.exclusive,
        runCount: it.runCount,
        likeCount: it.likeCount,
        imageCount: it.imageCount,
        cover: fileUrl(it.images[0]!),
        images: it.images.map(fileUrl),
        videos: it.videos.map(fileUrl),
      })),
    })
  })

  ctx.routes.get(P + '/file', async (c: HonoLike) => {
    const cat = await ensure()
    if (!cat.root) return c.json({ ok: false, error: '还没设置资源目录' }, 400)
    const name = safeMediaName(c.req.query('name') ?? '')
    if (!name) return c.json({ ok: false, error: '非法文件名或不允许的类型' }, 400)
    const target = path.resolve(cat.root, name)
    if (path.dirname(target) !== path.resolve(cat.root)) {
      return c.json({ ok: false, error: '越权的路径' }, 400)
    }
    let buf: Buffer
    try {
      buf = await fs.readFile(target)
    } catch {
      return c.json({ ok: false, error: '文件不存在：' + name }, 404)
    }
    return c.body(new Uint8Array(buf), 200, {
      'content-type': MIME[extOf(name)] ?? 'application/octet-stream',
      // 这里发的是**用户目录里的文件**，`svg` 在白名单里（见 MEDIA_EXTS）。
      // 不带 CSP 的话，打开一个带 <script> 的 svg 就会在后台源上执行脚本
      // （2026-10-19 实测：匿名上传 svg → 打开 → 读到同源 localStorage）。
      // 与 cloud-server 的 `inlineAsset.ts` 保持同一套头。
      'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=31536000, immutable',
    })
  })

  ctx.routes.get(P + '/settings', async (c: HonoLike) => {
    const root = await rootOf()
    const saved = await settings.get(spec.storeKey)
    return c.json({ ok: true, root, overridden: typeof saved === 'string' && !!saved.trim() })
  })

  ctx.routes.put(P + '/settings', async (c: HonoLike) => {
    const body = (await c.req.json().catch(() => ({}))) as { root?: unknown }
    if (typeof body.root !== 'string') return c.json({ ok: false, error: '需要 root 字符串' }, 400)
    const root = body.root.trim()
    if (!root) {
      await settings.delete(spec.storeKey)
      cache = null
      return c.json({ ok: true, root: '', note: '已清空，回落到默认目录' })
    }
    let stat
    try {
      stat = await fs.stat(root)
    } catch {
      return c.json({ ok: false, error: '目录不存在：' + root }, 400)
    }
    if (!stat.isDirectory()) return c.json({ ok: false, error: '不是目录：' + root }, 400)
    await settings.set(spec.storeKey, root)
    cache = await buildCatalog(root, spec)
    return c.json({ ok: true, root, itemCount: cache.items.length, source: cache.source })
  })

  ctx.routes.post(P + '/reload', async (c: HonoLike) => {
    const cat = await ensure(true)
    return c.json({ ok: cat.ok, itemCount: cat.items.length, source: cat.source, ...(cat.error ? { error: cat.error } : {}) })
  })

  return { ensure }
}

export function apply(ctx: ServerCtx): void {
  const settings = ctx.store.namespace(NS)
  const libs = LIBRARIES.map((spec) => makeLibrary(ctx, settings, spec))
  // 预热（不阻塞装载：失败也只是第一次请求时再试）
  for (const lib of libs) void lib.ensure().catch(() => { /* 预热失败不致命 */ })
}


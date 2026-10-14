/**
 * packRoutes —— 节点包的 HTTP 面（打 / 下载 / 存库）。
 *
 * 三条：
 *   POST /api/node-packages/build  { canvasId, nodeId }         → 包字节（下载用）
 *   POST /api/node-packages/save   { canvasId, nodeId, name?, folderId? } → { ok, asset }
 *   GET  /api/node-packages/read?assetUrl=…                     → 包字节（导入时把库里的包取回来）
 *
 * ## 两条设计取舍
 *
 * 1. **打包只在后台做**：脚本内容在服务器上，前端根本拿不到 ——
 *    让前端去打"一个包含服务器文件的包"是做不到的。
 * 2. **导出 = build 拿字节自己另存；收藏 = save 直接落资产库**（用户 2026-10-13 口径：
 *    收藏要走那个上传弹窗，由用户选位置/填名字/挑标签，所以 save 是可选的便捷路，
 *    弹窗那条走 build + 现有的 /api/assets 上传）。
 *
 * ## 为什么"读"要给 URL 而不是 asset id
 *
 * 左侧抽屉拖过来的是**资产项**（带 url），前端手上就是 url；再让它去查一次 id
 * 反而多一跳。这里只认 /api/assets/files/<安全名> 这一种形状，别的地址一律拒。
 */
import { buildNodePack, readNodePack, PACK_EXT } from './pack.js'
import { saveToDownloads } from './downloadDir.js'
import { resolveScriptPath } from './scripts.js'
import { listScriptNames } from './scripts.js'

/** 与 routes.ts 同形的 Hono 最小 ctx（就地声明，见 server.ts 文件头） */
interface Ctx {
  json(body: unknown, status?: number): Response
  body?(data: Uint8Array, status?: number, headers?: Record<string, string>): Response
  req: {
    json(): Promise<unknown>
    arrayBuffer?(): Promise<ArrayBuffer>
    query?(name: string): string | undefined
    header(name: string): string | undefined
    url: string
  }
}

/** 宿主能提供的两件事（拿不到就是"这台宿主不支持打包"，明确报错而不是静默） */
export interface PackHost {
  /**
   * 取一个节点。
   *
   * 为什么是 async：宿主那份画布文档（cloud-server 的 CanvasDocument）**只有 read()**，
   * 没有 getNode —— 第一版按同步 getNode 写，真机上永远拿不到节点
   * （报"画布上没有节点 2"，而画布 API 明明列得出来）。
   *
   * 为什么要带 canvasId：宿主那份文档**只管默认画布**，别的画布要去画布存储里读 ——
   * 不带画布 id 就没法知道该去哪儿找（2026-10-13 用户实测：导出画布 4 的节点直接 400）。
   */
  getNode(canvasId: string, id: string): Promise<PackNode | undefined>
  saveAsset(bytes: Uint8Array, name: string, folderId?: string): Promise<{ id: string; name: string; url: string }>
}

/** 打包要用到的节点形状 */
export interface PackNode {
  id: string
  type: string
  position?: { x: number; y: number }
  size?: { w: number; h: number }
  data?: Record<string, unknown>
}

// 后缀的唯一来源在 pack.ts（见那边的说明：三处各写一份会漂，漂了只表现成"拖进去没反应"）
export { PACK_EXT }

/** 资产库里取包时只认这一种地址形状（别的地址一律拒 —— 别变成"任意 URL 读取器"） */
export function assetFileNameOf(url: string): string | undefined {
  const clean = (url || '').split('?')[0].split('#')[0]
  const at = clean.indexOf('/api/assets/files/')
  if (at < 0) return undefined
  const name = clean.slice(at + '/api/assets/files/'.length)
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) ? name : undefined
}

/** 包名 → 安全的资产文件名（去非法字符，补后缀） */
export function safePackName(raw: string): string {
  const base = (raw || '').trim().replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 60) || '节点包'
  return base.endsWith(PACK_EXT) ? base : base + PACK_EXT
}

export interface PackRoutesCtx {
  routes: {
    get(path: string, handler: (c: Ctx) => Response | Promise<Response>): void
    post(path: string, handler: (c: Ctx) => Response | Promise<Response>): void
  }
  tryGet<T = unknown>(name: string): T | undefined
}

async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json()
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * 组装一个包（build 与 save 共用）。
 *
 * 三条前置检查都要给出**说得清**的错：节点不存在 / 不是可视化节点 / 没有界面内容。
 */
async function packOf(
  host: PackHost,
  scriptsDir: string,
  canvasId: string,
  nodeId: string,
  now: number,
): Promise<{ ok: true; bytes: Uint8Array; name: string; manifest: unknown } | { ok: false; error: string }> {
  if (!nodeId) return { ok: false, error: '缺少 nodeId' }
  const node = await host.getNode(canvasId, nodeId)
  if (!node) return { ok: false, error: '画布 ' + canvasId + ' 上没有节点 ' + nodeId }
  if (node.type !== 'ui') {
    return { ok: false, error: '节点 ' + nodeId + ' 是「' + node.type + '」类型，不是可视化节点（只有它能打包）' }
  }
  const html = typeof node.data?.uiHtml === 'string' ? (node.data.uiHtml as string) : ''
  if (!html.trim()) {
    return { ok: false, error: '这个节点还没有界面内容（先让 AI 画上去再打包）' }
  }
  // 声明为空、但界面里确实调了脚本 → 明说"缺的是依赖声明"以及怎么补。
  // 为什么不直接放行：包里带哪些脚本**只能**看声明（见 node-package-plan 第六节）；
  // 不给提示的话，用户拿到的包看着正常、实际一个脚本都没带（2026-10-13 用户实测：
  // "导出失败，有可能是相关的规则没有提供，比如依赖关系"）。
  const declared = Object.keys(
    (node.data?.uiScripts && typeof node.data.uiScripts === 'object' ? node.data.uiScripts : {}) as Record<
      string,
      unknown
    >,
  )
  if (declared.length === 0) {
    const looksLikeCall = /name["\']?\s*[=:]\s*["\'][A-Za-z0-9_-]{1,64}["\']/.test(html)
    if (looksLikeCall) {
      return {
        ok: false,
        error:
          '这个节点**没有声明它依赖的后台脚本**（data.uiScripts 是空的），所以包里不知道该带哪些脚本。' +
          '补法：让 AI 用 canvas_ui_write 把这个节点的界面重写一遍（写的时候会自动补声明），' +
          '或者直接往节点 data.uiScripts 里写 { "脚本名": {} }（脚本名就是 task-scripts/ 里的文件名）。',
      }
    }
  }
  const { bytes, manifest } = await buildNodePack(node, scriptsDir, now)
  return { ok: true, bytes, name: manifest.name, manifest }
}

export function registerPackRoutes(ctx: PackRoutesCtx, scriptsDir: string, host: PackHost): void {
  // ---- 打一个包（下载 / 收藏弹窗都用它拿字节） ----
  ctx.routes.post('/api/node-packages/build', async (c) => {
    const body = await readBody(c)
    const canvasId = typeof body.canvasId === 'string' && body.canvasId ? body.canvasId : 'default'
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
    const r = await packOf(host, scriptsDir, canvasId, nodeId, Date.now())
    if (!r.ok) return c.json({ ok: false, error: r.error }, 400)
    // 直接回字节：导出是"存成一个文件"，让浏览器拿到原始字节最直接
    // 名字与"带了哪些脚本"走**响应头**带回（字节响应没有 JSON 体可以放它们）。
    // 为什么要带名字：前端收藏时要拿它当文件名/预填项 —— 少了它只能回落成"节点包.mcnode"，
    // 用户每次都得手改（审查发现的缺口）。
    const headers: Record<string, string> = {
      'content-type': 'application/x-mini-canvas-node',
      'content-disposition': 'attachment; filename="' + encodeURIComponent(r.name + PACK_EXT) + '"',
      // 非 ASCII 走 percent-encoding（HTTP 头只能是 ASCII）
      'x-pack-name': encodeURIComponent(r.name),
      'x-pack-scripts': Object.keys((r.manifest as { scripts?: Record<string, unknown> }).scripts ?? {}).join(','),
      'x-pack-missing': ((r.manifest as { missing?: string[] }).missing ?? []).join(','),
      'cache-control': 'no-store',
    }
    if (c.body) return c.body(r.bytes, 200, headers)
    // 没有 body 能力（极简宿主 / 测试）：用 base64 回，调用方自己解
    let bin = ''
    for (const b of r.bytes) bin += String.fromCharCode(b)
    return c.json({ ok: true, name: r.name, base64: btoa(bin), manifest: r.manifest })
  })

  // ---- 打包 + 直接存进资产库（MCP 工具与"快捷收藏"走这条） ----
  ctx.routes.post('/api/node-packages/save', async (c) => {
    const body = await readBody(c)
    const canvasId = typeof body.canvasId === 'string' && body.canvasId ? body.canvasId : 'default'
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
    const r = await packOf(host, scriptsDir, canvasId, nodeId, Date.now())
    if (!r.ok) return c.json({ ok: false, error: r.error }, 400)

    const name = safePackName(typeof body.name === 'string' && body.name ? body.name : r.name)
    const folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : undefined
    try {
      const asset = await host.saveAsset(r.bytes, name, folderId)
      return c.json({ ok: true, asset, name, manifest: r.manifest })
    } catch (err) {
      return c.json({ ok: false, error: '存进资产库失败：' + (err instanceof Error ? err.message : String(err)) }, 500)
    }
  })

  // ---- 打包 + **写到本机下载目录**（用户口径 2026-10-14） ----
  //
  // 与 /save 的区别：save 进的是**资产库**（能在画布间拖），这条落的是**本机文件**
  // （节点删了也能靠它恢复）。用户点名要后者：「不然的话，你的这个节点一删，
  // 后台就完全没有意义了，还要重新写 HTML 代码」。
  ctx.routes.post('/api/node-packages/export', async (c) => {
    const body = await readBody(c)
    const canvasId = typeof body.canvasId === 'string' && body.canvasId ? body.canvasId : 'default'
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
    const r = await packOf(host, scriptsDir, canvasId, nodeId, Date.now())
    if (!r.ok) return c.json({ ok: false, error: r.error }, 400)
    const wanted = typeof body.name === 'string' && body.name ? body.name : r.name
    try {
      const saved = await saveToDownloads(r.bytes, wanted + PACK_EXT)
      return c.json({ ok: true, ...saved, manifest: r.manifest })
    } catch (err) {
      return c.json({ ok: false, error: '写到下载目录失败：' + (err instanceof Error ? err.message : String(err)) }, 500)
    }
  })

  // ---- 读一个包（从资产库里拖回来时，前端手上有 url，直接取字节） ----
  ctx.routes.get('/api/node-packages/read', (c) => {
    const url = c.req.query?.('assetUrl') ?? ''
    const fileName = assetFileNameOf(url)
    if (!fileName) return c.json({ ok: false, error: '只认资产库里的包地址（/api/assets/files/…）' }, 400)
    const store = ctx.tryGet<{ readFile(name: string): Promise<Uint8Array | undefined> }>('assetStore')
    if (!store || typeof store.readFile !== 'function') {
      return c.json({ ok: false, error: '宿主没有资产服务，读不了包' }, 503)
    }
    return store.readFile(fileName).then((bytes) => {
      if (!bytes) return c.json({ ok: false, error: '资产库里没有这个文件' }, 404)
      // 顺手验一下它确实是包（不是包就明确说，别让前面拿到一堆乱码再去猜）
      try {
        const parsed = readNodePack(bytes)
        return c.json({ ok: true, node: parsed.node, manifest: parsed.manifest, html: parsed.html, scripts: parsed.scripts })
      } catch (err) {
        return c.json({ ok: false, error: (err instanceof Error ? err.message : String(err)) }, 400)
      }
    })
  })
}

/** 脚本目录里现在有哪些脚本（打包时用来判断"声明里的脚本这台机器上有没有"） */
export async function scriptNamesOf(dir: string): Promise<string[]> {
  return listScriptNames(dir)
}

/** 声明里列了、但机器上没有的脚本名（打包报告要用） */
export function missingOf(declared: readonly string[], present: readonly string[]): string[] {
  const has = new Set(present)
  return declared.filter((n) => !has.has(n))
}

/** 一个声明里写了、但名字非法/解析不出来的脚本 —— 单独留个口子，便于诊断 */
export function resolvableIn(dir: string, name: string): boolean {
  return resolveScriptPath(dir, name) !== undefined
}


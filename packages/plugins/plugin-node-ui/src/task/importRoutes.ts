/**
 * importRoutes —— 导入节点包（**落地**：写脚本 + 还原节点）。
 *
 *   POST /api/node-packages/inspect   包字节 → 先体检（会不会升版本、哪些要改名）
 *   POST /api/node-packages/import    包字节 → 真落地，回还原好的节点
 *
 * ## 为什么"体检"与"落地"要分成两条
 *
 * 落地会往脚本目录**写文件**（那是往服务器放可执行代码）。分成两条之后，
 * 前端可以先问"这个包装下去会怎样"给用户看一眼，再决定要不要落 ——
 * 而不用把"看一眼"也变成一次写盘。
 *
 * ## 不弹确认（用户 2026-10-13 拍板）
 *
 * 拖包进来这个动作本身就是意图，不再多弹一次。护栏改由两件事承担：
 *   · 同源检查（只有本机页面能调这个接口）；
 *   · **版本隔离**——有冲突就整包升版本，绝不动本机已有的脚本
 *     （最多写 _v2 这样的新文件，原来那份原封不动）。
 */
import { promises as fs } from 'node:fs'
import { readNodePack } from './pack.js'
import { planImport, type ImportPlan } from './importPack.js'
import { resolveScriptPath } from './scripts.js'
import { UI_SCRIPTS_KEY } from './declarePlan.js'

/** 与其它 task 路由同形的 Hono 最小 ctx */
interface Ctx {
  json(body: unknown, status?: number): Response
  req: {
    arrayBuffer?(): Promise<ArrayBuffer>
    json(): Promise<unknown>
    header(name: string): string | undefined
    url: string
  }
}

export interface ImportRoutesCtx {
  routes: {
    get(path: string, handler: (c: Ctx) => Response | Promise<Response>): void
    post(path: string, handler: (c: Ctx) => Response | Promise<Response>): void
  }
  tryGet<T = unknown>(name: string): T | undefined
}

/** 最大包体（防手滑拖一个大文件进来把内存吃光） */
const MAX_PACK_BYTES = 32 * 1024 * 1024

/** 本机回环的几个等价写法（端口由 URL 自己带着，这里只比主机名） */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 归一化 origin：小写 scheme/host、去掉尾斜杠；解析不了返回空串（交给白名单拒） */
function parseOrigin(raw: string): URL | null {
  try {
    return new URL(raw.trim())
  } catch {
    return null
  }
}

/**
 * 跨源拦截：**浏览器带着 Origin 来的时候，必须是本机自己**。
 *
 * 为什么不硬要求 Origin：MCP 工具、脚本、命令行调这个接口时**不带 Origin**（不是浏览器），
 * 硬要求会把它们一起挡掉。所以判据是"带了就必须对"。
 * 能挡住的是最现实的那种攻击：用户在浏览器里开着的**别的网页**偷偷 POST 一个包过来
 * （那类请求浏览器一定会带 Origin）。
 *
 * ★ 为什么不能只跟 `selfOrigin` 字符串比（用户 2026-11-15 实测的「跨源请求被拒」）：
 *   服务自报的是 `http://127.0.0.1:8865`，而用户从**同一个服务**用
 *   `http://localhost:8865` 打开页面 —— 浏览器发的 Origin 是后一个，字符串不等就被判成跨源。
 *   对浏览器来说这是**同一个本机服务**，只是回环主机名写法不同（localhost / 127.0.0.1 / [::1]），
 *   反代下还会换成反代域名。所以判据按优先级收敛成三条：
 *     ① 与**这次请求自己的 origin**（Host + x-forwarded-proto）一致 —— 这是最准的一条，
 *        反代 / 局域网 IP / 自定义域名都能正确认成同源；
 *     ② 与启动时注入的 `selfOrigin` 一致；
 *     ③ 两边都是本机回环、端口与 scheme 一致（localhost ↔ 127.0.0.1 ↔ [::1]）。
 *   Host 本身已被 cloud-server 的来源边界按白名单校验过，所以 ① 不是「谁都能过」。
 * 剩下两条护栏（不靠这条也成立）：服务默认只监听 127.0.0.1；升版本机制保证**绝不覆盖**
 * 本机已有的脚本（最坏也只是多写一个 _vN 新文件）。
 */
export function originAllowed(c: Ctx, selfOrigin: string): boolean {
  const from = c.req.header('origin')
  if (!from) return true
  const fromUrl = parseOrigin(from)
  if (!fromUrl) return false
  // ① 按这次请求自己的 Host 判（反代 / 局域网 / 自定义域名都靠它）
  const host = c.req.header('host')
  if (host) {
    const proto =
      c.req.header('x-forwarded-proto') ||
      (host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('[::1]') ? 'http' : 'https')
    const reqUrl = parseOrigin(proto + '://' + host)
    if (reqUrl && reqUrl.origin === fromUrl.origin) return true
  }
  // ② 与启动时注入的自报地址一致
  const selfUrl = selfOrigin ? parseOrigin(selfOrigin) : null
  if (selfUrl && fromUrl.origin === selfUrl.origin) return true
  if (!selfUrl) return true
  // ③ 两边都是回环，只差主机名写法
  return (
    LOOPBACK_HOSTS.has(fromUrl.hostname.toLowerCase()) &&
    LOOPBACK_HOSTS.has(selfUrl.hostname.toLowerCase()) &&
    fromUrl.port === selfUrl.port &&
    fromUrl.protocol === selfUrl.protocol
  )
}

/** 收原始字节 */
async function readPackBytes(c: Ctx): Promise<Uint8Array | { error: string }> {
  if (!c.req.arrayBuffer) return { error: '这个宿主读不了请求体字节' }
  const buf = await c.req.arrayBuffer()
  if (!buf || buf.byteLength === 0) return { error: '空请求（没带包字节）' }
  if (buf.byteLength > MAX_PACK_BYTES) {
    return { error: '包太大了（超过 ' + Math.round(MAX_PACK_BYTES / 1024 / 1024) + 'MB）' }
  }
  return new Uint8Array(buf)
}

/** 体检结果里给前端看的那部分（去掉内部用的 write 明细） */
function describePlan(plan: ImportPlan) {
  return {
    action: plan.action,
    ...(plan.version === undefined ? {} : { version: plan.version }),
    renames: plan.renames,
    scripts: plan.scripts,
    skip: plan.skip,
    title: plan.title,
  }
}

export function registerImportRoutes(ctx: ImportRoutesCtx, scriptsDir: string): void {
  ctx.routes.post('/api/node-packages/inspect', async (c) => {
    if (!originAllowed(c, ctx.tryGet<string>('selfOrigin') ?? '')) {
      return c.json({ ok: false, error: '跨源请求被拒（只允许本机页面调用）' }, 403)
    }
    const bytes = await readPackBytes(c)
    if (!(bytes instanceof Uint8Array)) return c.json({ ok: false, error: bytes.error }, 400)
    try {
      const pack = readNodePack(bytes)
      const plan = await planImport(pack, scriptsDir)
      return c.json({ ok: true, manifest: pack.manifest, node: pack.node, plan: describePlan(plan) })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  ctx.routes.post('/api/node-packages/import', async (c) => {
    // ★ 这条会**往服务器写可执行脚本**，所以跨源必须先挡（见 originAllowed 的说明）
    if (!originAllowed(c, ctx.tryGet<string>('selfOrigin') ?? '')) {
      return c.json({ ok: false, error: '跨源请求被拒（只允许本机页面调用）' }, 403)
    }
    const bytes = await readPackBytes(c)
    if (!(bytes instanceof Uint8Array)) return c.json({ ok: false, error: bytes.error }, 400)
    let pack
    try {
      pack = readNodePack(bytes)
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400)
    }

    let plan: ImportPlan
    try {
      plan = await planImport(pack, scriptsDir)
    } catch (err) {
      return c.json({ ok: false, error: '算导入计划失败：' + (err instanceof Error ? err.message : String(err)) }, 500)
    }

    // 写脚本（内容一样的那些 plan.write 里没有，天然幂等）
    const written: string[] = []
    try {
      await fs.mkdir(scriptsDir, { recursive: true })
      for (const w of plan.write) {
        const abs = resolveScriptPath(scriptsDir, w.name)
        if (!abs) throw new Error('脚本名不合法：' + w.name)
        await fs.writeFile(abs, w.text, 'utf8')
        written.push(w.name)
      }
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: '写脚本失败：' + (err instanceof Error ? err.message : String(err)),
          written,
        },
        500,
      )
    }

    // 回"要还原成什么样的节点"给前端（前端自己建节点：它更清楚往哪张画布、什么位置）
    return c.json({
      ok: true,
      action: plan.action,
      ...(plan.version === undefined ? {} : { version: plan.version }),
      renames: plan.renames,
      written,
      skipped: plan.skip,
      node: {
        type: String((pack.node as { type?: unknown }).type ?? 'ui'),
        // ⚠️ 界面代码在 plan.data.uiHtml 里已经是**改写后**的那一份（见 importPack 的说明）——
        //    这里再挂一个顶层 html 字段只会让人以为它是权威来源，所以不再重复给。
        data: plan.data,
      },
      title: plan.title,
      manifest: pack.manifest,
      uiScriptsKey: UI_SCRIPTS_KEY,
    })
  })
}


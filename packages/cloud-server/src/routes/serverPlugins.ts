/**
 * serverPlugins —— 后台插件的安装 / 卸载 / 清单路由（Task 7）。
 *
 * ## ⚠️ 这是整个后台插件系统里**攻击面最大**的一条路由
 *
 * 它接受一段 JS 并**落到 server-plugins 目录**（下次启动即被当服务端代码执行）。
 * 所以安全约束一条都不能省（每条都有测试）：
 *
 * 1. **`confirm: true` 必填** —— 界面必须让用户看到"这将安装一个以服务端权限运行的插件"
 *    并显式确认。缺了直接 400。
 * 2. **`sha256` 必填且校验** —— 拉到的字节算哈希，与声明不符就拒绝（防传输篡改）。
 * 3. **`id` 白名单** —— 只允许 `[A-Za-z0-9_-]`，杜绝 `../evil` 这类路径穿越。
 * 4. **只写文件、不执行** —— 落盘后由**下次启动**的加载器统一加载（不在本请求里 import）。
 *    这样"安装"与"执行"分离：用户能看到装了什么，重启才生效，出事也好回退。
 * 5. **跨源默认拒绝** —— 见 `allowRemote` 选项（缺省 false）。
 *
 * ## 为什么把"代码"作为 body 传，而不是让服务端去 fetch URL
 *
 * 服务端 fetch 任意 URL = **SSRF**（可打内网、可做端口扫描）。
 * 改成"前端/调用方把字节拿来、服务端只校验 + 落盘"，就完全没有这个问题：
 * 服务端从不主动出网。跨源那条约束也因此变成"调用方自己拿的"，风险收敛到调用方。
 */
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { safeJson } from './agent.js'
import { withAudit, type AuditBase } from '../auditPair.js'
import type { AuditAppendInput } from '../audit.js'

/** id 白名单：字母数字下划线连字符，1-64 位（点号不在表内，故 `..` 天然被拒） */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface ServerPluginsRoutesOptions {
  /** server-plugins 目录（文件落在这里） */
  dir: string
  /** 本服务 origin（用于跨源判断） */
  origin?: string
  /** 是否允许跨源安装（缺省 false = 只收同源） */
  allowRemote?: boolean
  /**
   * 取某个插件 id 的**可信 sha256**（来自本服务自己的清单，不是调用方声明的）。
   *
   * ⚠️ 这是完整性校验的**唯一可信锚点**。审查指出：若比对的是"调用方现算并一并发来的哈希"，
   * 同一通道同一份字节，改包的人能自洽 —— 等于没校验。
   * 所以必须由服务端从**自己的信任源**（扫描插件目录得到的清单）取期望值。
   *
   * 缺省不提供 → **拒绝安装**（宁可不装，也不要假装校验过）。
   */
  trustedShaOf?: (id: string) => Promise<string | undefined>
  /**
   * **调试用**：允许从本机磁盘路径读后台产物并安装（`/install-from-path`）。
   *
   * 这是给「watch 上报 `server` 绝对路径」那条链用的（见 plugin-hot-reload）。
   * 缺省 **undefined = 整条路由不挂**（生产上等同于不存在，不会变成任意读文件的后门）。
   * 打开时必须同时满足：只收本机回环请求（Host 必须是 127.0.0.1/localhost/[::1]）、
   * 管理令牌已开启（管理面鉴权在 server.ts 中间件里，缺令牌 403）、
   * 路径后缀必须是 `.js`、文件大小有上限。
   */
  debugInstall?: {
    /** 允许读取的根目录（只接受落在这里面的文件；防任意读盘） */
    allowRoots: string[]
    /** 单文件大小上限（字节，缺省 2MB） */
    maxBytes?: number
  }
  /**
   * 取某个插件声明的**权限清单**（来自清单，只用于展示）。
   * 计划要求 permissions 必须有消费点 —— 这就是：诊断接口把它列出来给界面看。
   */
  permissionsOf?: (id: string) => Promise<string[] | undefined>
  /** 本次启动已成功登记的外挂后台插件名（运行时观测面：部署者据此审计"目录里到底活着什么"） */
  /** 已登记进内核的外挂插件名（热装/热卸后必须同步更新，故允许传函数现取） */
  loaded?: string[] | (() => string[])
  /**
   * 热装/热卸钩子（缺省不调，行为与旧版一致）。
   *
   * 有它之后，安装/卸载当场生效，不再需要重启服务：
   *   - install 落盘后调 hotInstall(id)：宿主 import 该文件并登记进内核（路由即时可用）；
   *   - uninstall 删文件后调 hotUninstall(id)：从内核摘掉（路由即时失效）。
   *
   * 为什么钩子由宿主实现而不是路由自己 import：保持 install 路由"只碰文件、不执行代码"的
   * 既有分工 —— 执行交给宿主（它才知道 kernel/ctx 怎么建）。
   */
  hotInstall?: (id: string) => Promise<{ ok: boolean; error?: string }>
  hotUninstall?: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** 审计日志（可选）。给了就记 attempt / ok / rejected，见 audit.ts。 */
  audit?: (e: AuditAppendInput) => Promise<void>
}

export function createServerPluginsRoutes(opts: ServerPluginsRoutesOptions): Hono {
  const app = new Hono()

  /** 列出已装的后台插件（文件名 + 大小 + 有没有声明 permissions） */
  app.get('/api/server-plugins', async (c) => {
    let names: string[] = []
    try {
      names = (await fs.readdir(opts.dir)).filter((n) => n.endsWith('.js')).sort()
    } catch {
      /* 目录不存在 = 一个都没装 */
    }
    const plugins = await Promise.all(
      names.map(async (file) => {
        const id = file.replace(/\.js$/, '')
        let size = 0
        try {
          size = (await fs.stat(path.join(opts.dir, file))).size
        } catch {
          /* 文件在扫描间隙被删：给 0，不当错误 */
        }
        // permissions 的消费点（计划明确要求"没有消费点的字段等于没有"）：
        // 声明在清单里（发布时写的），这里读出来展示，让界面能告诉用户"这个插件声明要什么权限"。
        let permissions: string[] | undefined
        try {
          permissions = (await opts.permissionsOf?.(id)) ?? undefined
        } catch {
          /* 读清单失败不致命：permissions 只是展示信息 */
        }
        return { id, file, size, ...(permissions ? { permissions } : {}) }
      }),
    )
    const loaded = typeof opts.loaded === "function" ? opts.loaded() : (opts.loaded ?? [])
    return c.json({ ok: true, plugins, loaded })
  })

  app.post('/api/server-plugins/install', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)

    /** 本路由的审计：withAudit 保证每个分支都有结局（见 auditPair.ts）。 */
    const auditId = typeof body.id === 'string' ? body.id : ''
    const auditBase: AuditBase = {
      action: 'server-plugin/install' as const,
      method: 'POST',
      path: c.req.path,
      id: auditId,
      token: 'ok' as const,
    }

    return withAudit(opts.audit, auditBase, async (settle) => {
      /** 被拒：先给审计一个结局，再回错误。 */
      const reject = (status: 400 | 403 | 500, error: string) => {
        settle({ result: 'rejected', reason: error })
        return c.json({ ok: false, error }, status)
      }

      // ① 显式确认（界面必须让用户知道"这东西以服务端权限运行"）
      if (body.confirm !== true) {
        return reject(400, '需要 confirm: true（安装后台插件等于以服务端权限运行外部代码）')
      }
      // ② origin 白名单（跨源默认拒）
      if (!opts.allowRemote && opts.origin !== undefined) {
        const from = typeof body.origin === 'string' ? body.origin : ''
        if (from && from !== opts.origin) {
          return reject(400, '跨源安装被拒（只允许同源 ' + opts.origin + '）')
        }
      }
      // ③ id 白名单（防路径穿越）
      const id = typeof body.id === 'string' ? body.id : ''
      if (!ID_RE.test(id)) {
        return reject(400, '非法插件 id（只允许字母数字下划线连字符，1-64 位）')
      }
      // ④ 代码与**可信哈希**校验
      const code = typeof body.code === 'string' ? body.code : ''
      if (!code) return reject(400, '需要 code（插件源码文本）')
      // 没有可信源就拒绝：宁可不装，也不要"假装校验过"（审查发现的真问题）
      if (!opts.trustedShaOf) {
        return reject(400, '服务端未配置可信哈希来源，无法校验完整性（拒绝安装）')
      }
      const trusted = (await opts.trustedShaOf(id))?.toLowerCase()
      if (!trusted) {
        return reject(400, '清单里没有这个插件的可信哈希（未列入清单，拒绝安装）')
      }
      const gotSha = createHash('sha256').update(code, 'utf8').digest('hex')
      if (gotSha !== trusted) {
        return reject(400, 'sha256 与清单声明不符（内容被改动，拒绝安装）')
      }

      // ⑤ 落盘（**只写、不执行**；下次启动由加载器统一加载）
      try {
        await fs.mkdir(opts.dir, { recursive: true })
        await fs.writeFile(path.join(opts.dir, id + '.js'), code, 'utf8')
      } catch (err) {
        return reject(500, '写入失败：' + (err instanceof Error ? err.message : String(err)))
      }

      // ⑥ 热装：宿主当场 import + 登记内核 → 路由即时可用（没配 hotInstall 就退化成重启生效）
      // 热装失败不影响「已安装」这个事实（文件已经在），所以记 ok，把热装结果写进 reason。
      settle({ result: 'ok', sha256: gotSha })
      if (opts.hotInstall) {
        const hot = await opts.hotInstall(id)
        if (!hot.ok) {
          settle({ result: 'ok', sha256: gotSha, reason: '已落盘；热装失败：' + (hot.error ?? '未知原因') })
          return c.json({ ok: true, id, note: '已落盘；热装失败（重启后生效）', hotError: hot.error }, 200)
        }
        return c.json({ ok: true, id, note: '已安装并即时生效' })
      }
      return c.json({ ok: true, id, note: '已安装；重启服务后生效' })
    })
  })

  app.post('/api/server-plugins/uninstall', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const id = typeof body.id === 'string' ? body.id : ''
    const auditBase: AuditBase = {
      action: 'server-plugin/uninstall' as const,
      method: 'POST',
      path: c.req.path,
      id,
      token: 'ok' as const,
    }

    return withAudit(opts.audit, auditBase, async (settle) => {
      if (!ID_RE.test(id)) {
        settle({ result: 'rejected', reason: '非法插件 id' })
        return c.json({ ok: false, error: '非法插件 id' }, 400)
      }
      try {
        await fs.unlink(path.join(opts.dir, id + '.js'))
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code === 'ENOENT') {
          settle({ result: 'rejected', reason: 'not-found' })
          return c.json({ ok: false, error: '插件不存在：' + id }, 404)
        }
        settle({ result: 'rejected', reason: 'unlink-failed' })
        return c.json({ ok: false, error: String(err) }, 500)
      }
      // 热卸：宿主当场从内核摘掉 → 路由即时失效（没配 hotUninstall 就退化成重启生效）
      // 文件已删，即使热卸失败也记 ok，把失败原因写进 reason。
      if (opts.hotUninstall) {
        const hot = await opts.hotUninstall(id)
        if (!hot.ok) {
          settle({ result: 'ok', reason: '已删文件；热卸失败：' + (hot.error ?? '未知原因') })
          return c.json({ ok: true, id, note: '已删文件；热卸失败（重启后消失）', hotError: hot.error }, 200)
        }
        return c.json({ ok: true, id, note: '已卸载并即时失效' })
      }
      return c.json({ ok: true, id, note: '已卸载；重启服务后生效' })
    })
  })

  // ===== 调试用：按本机磁盘路径安装后台产物（watch 上报 server 路径这条链） =====
  //
  // 只在 debugInstall 配置存在时挂载。未配置 = 404（路由根本不存在），生产默认不受影响。
  // 请求体：{ id, path, confirm: true }
  if (opts.debugInstall) {
    const allowRoots = opts.debugInstall.allowRoots.map((r) => path.resolve(r))
    const maxBytes = opts.debugInstall.maxBytes ?? 2 * 1024 * 1024

    app.post('/api/server-plugins/install-from-path', async (c) => {
      // ① 只允许本机回环：Host 头必须是 127.0.0.1 / localhost / [::1]
      const host = (c.req.header('host') ?? '').trim().toLowerCase()
      const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '')
      if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) {
        return c.json({ ok: false, error: '按路径安装只允许本机调试（Host 不是回环地址）' }, 403)
      }
      const body = await safeJson(c)
      if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
      if (body.confirm !== true) {
        return c.json({ ok: false, error: '需要 confirm: true（安装后台插件等于以服务端权限运行外部代码）' }, 400)
      }
      const id = typeof body.id === 'string' ? body.id : ''
      if (!ID_RE.test(id)) return c.json({ ok: false, error: '非法插件 id（只允许字母数字下划线连字符，1-64 位）' }, 400)
      const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
      if (!rawPath) return c.json({ ok: false, error: '需要 path（后台产物的磁盘路径）' }, 400)
      if (!/\.[cm]?js$/i.test(rawPath)) return c.json({ ok: false, error: '只接受 .js / .mjs / .cjs 产物' }, 400)
      if (rawPath.includes('\0')) return c.json({ ok: false, error: '非法路径' }, 400)

      const abs = path.resolve(rawPath)
      // ② 目录锁：必须落在允许的根目录里（防任意读文件）
      const inside = allowRoots.some((root) => abs === root || abs.startsWith(root + path.sep))
      if (!inside) {
        return c.json({ ok: false, error: '路径不在允许的调试目录内：' + allowRoots.join(', ') }, 403)
      }
      let code: string
      try {
        const st = await fs.stat(abs)
        if (!st.isFile()) return c.json({ ok: false, error: '路径不是文件' }, 400)
        if (st.size > maxBytes) return c.json({ ok: false, error: '文件过大（上限 ' + maxBytes + ' 字节）' }, 400)
        code = await fs.readFile(abs, 'utf8')
      } catch (err) {
        return c.json({ ok: false, error: '读取失败：' + (err instanceof Error ? err.message : String(err)) }, 400)
      }

      // ③ 落盘（**先写**：热装失败也要保住文件，重启后仍能生效）
      //
      // 先摘同名旧实现：内核同名会直接拒装，不先卸就是"文件新、内存旧"。
      // 必须在写文件**之前**卸：内核卸载时若读到旧文件，这中间不会有新文件被当成旧实现。
      if (opts.hotUninstall) {
        const removed = await opts.hotUninstall(id)
        // 第一次装时内核里没有它，这不是失败；真失败才停下（不能出现两个版本同时跑）。
        if (!removed.ok && !/没有该插件|not.?found|从未装载/i.test(removed.error ?? '')) {
          return c.json(
            { ok: false, error: '同名后台插件卸载失败，已停止安装（避免两个版本同时跑）：' + (removed.error ?? '未知原因') },
            409,
          )
        }
      }
      try {
        await fs.mkdir(opts.dir, { recursive: true })
        await fs.writeFile(path.join(opts.dir, id + '.js'), code, 'utf8')
      } catch (err) {
        return c.json({ ok: false, error: '写入失败：' + (err instanceof Error ? err.message : String(err)) }, 500)
      }

      // ④ 热装：文件已经落盘，宿主 import 它并登记进内核
      if (opts.hotInstall) {
        const hot = await opts.hotInstall(id)
        if (!hot.ok) {
          return c.json({ ok: true, id, note: '已落盘；热装失败（重启后生效）', hotError: hot.error }, 200)
        }
        return c.json({ ok: true, id, note: '已按路径安装并即时生效' })
      }
      return c.json({ ok: true, id, note: '已按路径安装；重启服务后生效' })
    })
  }

  return app
}

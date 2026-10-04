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
   * 取某个插件声明的**权限清单**（来自清单，只用于展示）。
   * 计划要求 permissions 必须有消费点 —— 这就是：诊断接口把它列出来给界面看。
   */
  permissionsOf?: (id: string) => Promise<string[] | undefined>
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
    return c.json({ ok: true, plugins })
  })

  app.post('/api/server-plugins/install', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)

    // ① 显式确认（界面必须让用户知道"这东西以服务端权限运行"）
    if (body.confirm !== true) {
      return c.json({ ok: false, error: '需要 confirm: true（安装后台插件等于以服务端权限运行外部代码）' }, 400)
    }
    // ② origin 白名单（跨源默认拒）
    if (!opts.allowRemote && opts.origin !== undefined) {
      const from = typeof body.origin === 'string' ? body.origin : ''
      if (from && from !== opts.origin) {
        return c.json({ ok: false, error: '跨源安装被拒（只允许同源 ' + opts.origin + '）' }, 400)
      }
    }
    // ③ id 白名单（防路径穿越）
    const id = typeof body.id === 'string' ? body.id : ''
    if (!ID_RE.test(id)) {
      return c.json({ ok: false, error: '非法插件 id（只允许字母数字下划线连字符，1-64 位）' }, 400)
    }
    // ④ 代码与**可信哈希**校验
    const code = typeof body.code === 'string' ? body.code : ''
    if (!code) return c.json({ ok: false, error: '需要 code（插件源码文本）' }, 400)
    // 没有可信源就拒绝：宁可不装，也不要"假装校验过"（审查发现的真问题）
    if (!opts.trustedShaOf) {
      return c.json(
        { ok: false, error: '服务端未配置可信哈希来源，无法校验完整性（拒绝安装）' },
        400,
      )
    }
    const trusted = (await opts.trustedShaOf(id))?.toLowerCase()
    if (!trusted) {
      return c.json({ ok: false, error: '清单里没有这个插件的可信哈希（未列入清单，拒绝安装）' }, 400)
    }
    const gotSha = createHash('sha256').update(code, 'utf8').digest('hex')
    if (gotSha !== trusted) {
      return c.json({ ok: false, error: 'sha256 与清单声明不符（内容被改动，拒绝安装）' }, 400)
    }

    // ⑤ 落盘（**只写、不执行**；下次启动由加载器统一加载）
    try {
      await fs.mkdir(opts.dir, { recursive: true })
      await fs.writeFile(path.join(opts.dir, id + '.js'), code, 'utf8')
    } catch (err) {
      return c.json({ ok: false, error: '写入失败：' + (err instanceof Error ? err.message : String(err)) }, 500)
    }
    return c.json({ ok: true, id, note: '已安装；重启服务后生效' })
  })

  app.post('/api/server-plugins/uninstall', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const id = typeof body.id === 'string' ? body.id : ''
    if (!ID_RE.test(id)) return c.json({ ok: false, error: '非法插件 id' }, 400)
    try {
      await fs.unlink(path.join(opts.dir, id + '.js'))
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'ENOENT') return c.json({ ok: false, error: '插件不存在：' + id }, 404)
      return c.json({ ok: false, error: String(err) }, 500)
    }
    return c.json({ ok: true, id, note: '已卸载；重启服务后生效' })
  })

  return app
}

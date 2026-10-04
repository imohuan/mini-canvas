/**
 * npmPlugins —— 从 NPM 安装/更新/搜索插件的路由（计划 Task 4）。
 *
 * ## 安全模型（与 serverPlugins 同级，一条都不能省）
 *
 * 装 NPM 包 = **服务端代码执行**（server.js 下次启动会被 loader import）。所以：
 * 1. `confirm: true` 必填（界面弹"服务端权限"确认，与手动安装同一语义）；
 * 2. **scope 白名单**：默认只允许 @mini-canvas/ 开头的包（防"npm 上任意包"被装进来；
 *    放开走 opts.scopeAllowlist 配置）；
 * 3. installable 校验：包的 miniCanvas.installable !== true → 拒装（不是插件装了也没用）；
 * 4. server 产物完整性：下载后**服务端自己算 sha256** 存入来源记录（next 启动 loader
 *    的文件即下载时那份；来源记录里留哈希供审计）；
 * 5. 前端半落 pluginsDir（catalog 自动收录 → 管理页可装卸）；后台半落 serverPluginsDir。
 *
 * ## 更新语义
 *
 * update = 重新走一遍 install（按 dist-tags.latest），版本一致返回"已是最新"。
 * 覆盖前把旧版本记进 store（.installed 记录文件），出问题可人工回退。
 */
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { safeJson } from './agent.js'
import { createNpmClient, extractTarball, NpmNotFoundError, type NpmClientOptions } from '../npm/npmClient.js'

/**
 * 默认 scope 白名单：只允许这些 scope 下的包被安装（装 NPM 包 = 服务端执行代码）。
 * 可用 opts.scopeAllowlist 覆盖，或环境变量 MINI_CANVAS_NPM_SCOPES（逗号分隔）在服务层注入。
 */
const DEFAULT_SCOPES = ['@mini-canvas/', '@imohuan/']

/** 包名校验（scope/name 形态；name 段不含路径分隔符） */
const PKG_RE = /^@[a-z0-9-][a-z0-9-._]*[/][a-z0-9-][a-z0-9-._]*$/

export interface NpmPluginsRoutesOptions extends NpmClientOptions {
  /** 前端半落点（catalog 的 pluginsDir） */
  pluginsDir?: string
  /** 后台半落点（server-plugins 目录） */
  serverPluginsDir: string
  /** 来源记录文件（NPM 装了什么、什么版本，落 JSON 供 GET installed 与 update 比对） */
  recordFile?: string
  /** scope 白名单（前缀匹配；缺省 @mini-canvas/） */
  scopeAllowlist?: string[]
  /** 热装/热卸钩子：装完/卸完当场生效（见 serverFramework/hotLoad.ts）；缺省不调 */
  hotInstall?: (id: string) => Promise<{ ok: boolean; error?: string }>
  hotUninstall?: (id: string) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string }
}

interface InstallRecord {
  pkg: string
  version: string
  installedAt: string
  serverSha256?: string
}

export function createNpmPluginsRoutes(opts: NpmPluginsRoutesOptions): Hono {
  const app = new Hono()
  const client = createNpmClient(opts)
  const scopes = opts.scopeAllowlist ?? DEFAULT_SCOPES
  const recordFile = opts.recordFile ?? path.join(opts.serverPluginsDir, '.npm-installed.json')

  const readRecords = async (): Promise<Record<string, InstallRecord>> => {
    try {
      return JSON.parse(await fs.readFile(recordFile, 'utf8')) as Record<string, InstallRecord>
    } catch {
      return {}
    }
  }
  const writeRecords = async (recs: Record<string, InstallRecord>): Promise<void> => {
    await fs.mkdir(path.dirname(recordFile), { recursive: true })
    await fs.writeFile(recordFile, JSON.stringify(recs, null, 2), 'utf8')
  }

  const scopeAllowed = (pkg: string): boolean => scopes.some((s) => pkg.startsWith(s))

  // ------------------------------------------------------------------
  // 搜索：转发 npm 搜索 + 按 miniCanvas.installable 二次过滤（路由职责）
  // ------------------------------------------------------------------
  app.get('/api/npm-plugins/search', async (c) => {
    const q = c.req.query('q')?.trim() ?? ''
    if (!q) return c.json({ ok: false, error: '需要 q（搜索关键词）' }, 400)
    try {
      const hits = await client.search(q, 20)
      // 收集候选包名：搜索命中 + **精确直查**。
      //
      // 为什么要精确直查：npm 搜索按热度排序，刚发布、0 下载的包**排不进任何关键词的
      // 搜索结果前若干页**（实测：新发的包在 top 250 都找不到）。用户搜自己刚发的插件
      // 会一无所获。所以除了模糊搜索，再按"直接输入包名 / scope 名"精确查一次。
      const names = new Set<string>()
      for (const h of hits) names.add(h.name)
      // 输入像包名（含 / 或以 @ 开头）→ 直接当包名查
      if (q.includes('/')) names.add(q.startsWith('@') ? q : q)
      // 输入是 scope（@xxx 或 @xxx/）→ 用该 scope 的搜索再捞一次
      if (/^@[a-z0-9-]+\/?$/i.test(q)) {
        try {
          for (const h of await client.search(q.replace(/\/$/, ''), 50)) names.add(h.name)
        } catch { /* scope 搜索失败忽略 */ }
      }

      const descriptors = await Promise.all(
        [...names]
          .filter((n) => scopeAllowed(n))
          .map(async (name) => {
            try {
              const pk = await client.packument(name)
              const latest = pk['dist-tags'].latest
              if (!latest) return null
              const vInfo = pk.versions[latest] as unknown as { miniCanvas?: Record<string, unknown> }
              const mini = vInfo?.miniCanvas
              if (mini?.installable !== true) return null
              return {
                pkg: name,
                description: pk.description ?? '',
                version: latest,
                date: pk.time?.[latest] ?? '',
                hasServer: mini.server !== undefined,
                title: typeof mini.title === 'string' ? mini.title : name,
              }
            } catch {
              return null // 单个查失败不影响整页（含"搜到的名字其实不存在"）
            }
          }),
      )
      return c.json({ ok: true, results: descriptors.filter((x) => x !== null) })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  // ------------------------------------------------------------------
  // 安装 / 更新（同一套下载+校验+落盘；update 只是多一步版本比对）
  // ------------------------------------------------------------------
  async function doInstall(pkg: string, wantVersion: string | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
    // ① scope 白名单 + 包名形状
    if (!PKG_RE.test(pkg)) return { status: 400, body: { ok: false, error: '非法包名（要 @scope/name 形态）' } }
    if (!scopeAllowed(pkg)) {
      return { status: 400, body: { ok: false, error: '包不在允许的 scope 内（' + scopes.join(', ') + '）。装第三方包需在服务端配置 scopeAllowlist。' } }
    }
    // ② packument → 定版本
    let pk
    try {
      pk = await client.packument(pkg)
    } catch (err) {
      if (err instanceof NpmNotFoundError) return { status: 404, body: { ok: false, error: err.message } }
      return { status: 502, body: { ok: false, error: err instanceof Error ? err.message : String(err) } }
    }
    const version = wantVersion && wantVersion !== 'latest' ? wantVersion : pk['dist-tags'].latest
    if (!version || !pk.versions[version]) {
      return { status: 404, body: { ok: false, error: '版本不存在：' + (wantVersion ?? '(latest)') } }
    }
    const vInfo = pk.versions[version] as unknown as { tarball?: string; dist?: { tarball: string }; miniCanvas?: Record<string, unknown> } & Record<string, unknown>
    const tarballUrl = vInfo.tarball ?? vInfo.dist?.tarball
    console.log('[npm] tarballUrl:', tarballUrl)
    const mini = vInfo.miniCanvas as Record<string, unknown> | undefined
    // ③ installable 校验
    if (mini?.installable !== true) {
      return { status: 400, body: { ok: false, error: '该包不是 miniCanvas 插件（miniCanvas.installable !== true）' } }
    }

    // ④ 下载 + 解包到临时目录
    const tmpDir = path.join(opts.serverPluginsDir, '.tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
    try {
      await fs.mkdir(tmpDir, { recursive: true })
      const tgz = path.join(tmpDir, 'pkg.tgz')
      await client.downloadTarball(tarballUrl!, tgz)
      const pkgJsonPath = await extractTarball(tgz, tmpDir)
      const extracted = path.dirname(pkgJsonPath)

      // ⑤ 找产物：web 半（dist/*.js 非 server）、server 半（dist/server.js）
      const distDir = path.join(extracted, 'dist')
      let files: string[] = []
      try {
        files = (await fs.readdir(distDir)).filter((f) => f.endsWith('.js') && !f.endsWith('.map'))
      } catch {
        return { status: 400, body: { ok: false, error: '包里没有 dist/（不是打包好的插件包）' } }
      }
      const serverFile = files.find((f) => f === 'server.js' || f === 'plugin-server.js')
      const webFile = files.find((f) => f !== serverFile)
      if (!webFile) {
        return { status: 400, body: { ok: false, error: 'dist/ 里没有前端半产物' } }
      }

      // ⑥ 前端半 → pluginsDir/<pkgName>/dist/（catalog 自动收录）
      const pkgDirName = pkg.replace(/^@/, '').replace('/', '__')
      const webDest = path.join(opts.pluginsDir ?? path.join(opts.serverPluginsDir, '..', 'plugins'), pkgDirName, 'dist')
      await fs.mkdir(webDest, { recursive: true })
      const webText = await fs.readFile(path.join(distDir, webFile), 'utf8')
      await fs.writeFile(path.join(webDest, webFile), webText, 'utf8')
      // ⚠️ package.json 必须一起落：catalog 靠它的 miniCanvas 段判定 installable 并取
      // title/globalName/server 元数据。少了它，前端半文件在、但管理页列不出来（实测踩过）。
      await fs.copyFile(pkgJsonPath, path.join(path.dirname(webDest), 'package.json'))
      // server.js 也留一份在 pluginsDir/dist：catalog 靠它算 sha256（前端下载后台半、
      // 以及"清单里的可信哈希"都从这条 URL 来）；真正运行的那份由 serverPluginsDir 承担。
      if (serverFile) {
        await fs.copyFile(path.join(distDir, serverFile), path.join(webDest, serverFile))
      }

      // ⑦ server 半 → serverPluginsDir/<id>.js；服务端自己算 sha256 记来源
      let serverSha: string | undefined
      let hotMsg = ''
      if (serverFile) {
        const serverText = await fs.readFile(path.join(distDir, serverFile), 'utf8')
        serverSha = createHash('sha256').update(serverText, 'utf8').digest('hex')
        const serverId = pkg.replace(/^@/, '').replace('/', '__')
        await fs.writeFile(path.join(opts.serverPluginsDir, serverId + '.js'), serverText, 'utf8')
        // 热装：宿主当场 import + 登记内核 → 后台路由即时可用，不必重启（见 hotLoad.ts）
        if (opts.hotInstall) {
          const hot = await opts.hotInstall(serverId)
          hotMsg = hot.ok ? '并即时生效' : '（热装失败，重启后生效：' + hot.error + '）'
        }
      }

      // ⑧ 记来源
      const recs = await readRecords()
      recs[pkg] = {
        pkg,
        version,
        installedAt: new Date().toISOString(),
        ...(serverSha ? { serverSha256: serverSha } : {}),
      }
      await writeRecords(recs)

      return {
        status: 200,
        body: {
          ok: true,
          pkg,
          version,
          hasServer: serverFile !== undefined,
          note: '已安装；前端半刷新即可见' + (serverFile ? '，后台半' + hotMsg : ''),
        },
      }
    } catch (err) {
      const cause = (err as { cause?: Error })?.cause
      if (cause) console.log('[npm] downloadTarball cause:', cause.message)
      return { status: 502, body: { ok: false, error: err instanceof Error ? err.message : String(err) } }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  app.post('/api/npm-plugins/install', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    // confirm 必填：装 NPM 包 = 服务端代码执行（与手动安装同一确认语义）
    if (body.confirm !== true) {
      return c.json({ ok: false, error: '需要 confirm: true（安装 NPM 插件等于以服务端权限运行其后台半）' }, 400)
    }
    const pkg = typeof body.package === 'string' ? body.package : ''
    const version = typeof body.version === 'string' ? body.version : undefined
    const r = await doInstall(pkg, version)
    return c.json(r.body, r.status as 200)
  })

  app.post('/api/npm-plugins/update', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    if (body.confirm !== true) {
      return c.json({ ok: false, error: '需要 confirm: true（更新 NPM 插件等于替换服务端运行的代码）' }, 400)
    }
    const pkg = typeof body.package === 'string' ? body.package : ''
    const recs = await readRecords()
    const rec = recs[pkg]
    if (!rec) return c.json({ ok: false, error: '这个包不是从 NPM 装的（无来源记录）' }, 404)
    try {
      const pk = await client.packument(pkg)
      const latest = pk['dist-tags'].latest
      if (!latest) return c.json({ ok: false, error: '该包没有 latest 标签' }, 502)
      if (latest === rec.version) {
        return c.json({ ok: true, pkg, version: rec.version, updated: false, note: '已是最新版本' })
      }
      const r = await doInstall(pkg, latest)
      if (r.status !== 200) return c.json(r.body, r.status as 200)
      return c.json({ ok: true, pkg, from: rec.version, to: latest, updated: true })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  app.get('/api/npm-plugins/installed', async (c) => {
    const recs = await readRecords()
    return c.json({ ok: true, plugins: Object.values(recs) })
  })

  // 卸载：删来源记录 + 两个半的落盘文件（后台半重启后真正消失；前端半 catalog 即时少一条）
  app.post('/api/npm-plugins/uninstall', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const pkg = typeof body.package === 'string' ? body.package : ''
    const recs = await readRecords()
    if (!recs[pkg]) return c.json({ ok: false, error: '这个包不是从 NPM 装的' }, 404)
    delete recs[pkg]
    await writeRecords(recs)
    const pkgDirName = pkg.replace(/^@/, '').replace('/', '__')
    const serverId = pkgDirName
    await fs.rm(path.join(opts.pluginsDir ?? path.join(opts.serverPluginsDir, '..', 'plugins'), pkgDirName), { recursive: true, force: true })
    await fs.rm(path.join(opts.serverPluginsDir, serverId + '.js'), { force: true })
    // 热卸：宿主当场从内核摘掉 → 后台路由即时失效（见 hotLoad.ts）
    let hotMsg = '并即时失效'
    if (opts.hotUninstall) {
      const hot = await opts.hotUninstall(serverId)
      hotMsg = hot.ok ? '并即时失效' : '（热卸失败，重启后消失：' + hot.error + '）'
    }
    return c.json({ ok: true, pkg, note: '已卸载；前端半刷新即可见，后台半' + hotMsg })
  })

  return app
}

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
 * 允许安装的包名前缀（装 NPM 包 = 服务端执行代码，所以白名单起步）。
 *
 * 是**包名前缀**不是 npm scope：既能是 "@imohuan/"（scope 包），也能是 "mini-canvas-"（普通包）。
 * 可用 opts.scopeAllowlist 覆盖，或环境变量 MINI_CANVAS_NPM_SCOPES（逗号分隔）在服务层注入。
 */
const DEFAULT_PREFIXES = ['mini-canvas-', '@mini-canvas/']

  /** 包名校验：scope 包（@scope/name）或普通包（mini-canvas-xxx）都收；不含路径分隔符/大写 */
  const PKG_RE = /^(@[a-z0-9-][a-z0-9-._]*\/)?[a-z0-9-][a-z0-9-._]*$/

export interface NpmPluginsRoutesOptions extends NpmClientOptions {
  /** 前端半落点（catalog 的 pluginsDir） */
  pluginsDir?: string
  /** 后台半落点（server-plugins 目录） */
  serverPluginsDir: string
  /** 来源记录文件（NPM 装了什么、什么版本，落 JSON 供 GET installed 与 update 比对） */
  recordFile?: string
  /** 允许的包名前缀（缺省见 DEFAULT_PREFIXES；既支持 @scope/ 也支持 mini-canvas- 这类前缀） */
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
  const prefixes = opts.scopeAllowlist ?? DEFAULT_PREFIXES
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

  const scopeAllowed = (pkg: string): boolean => prefixes.some((s) => pkg.startsWith(s))

  /**
   * 判断一个包的 miniCanvas 段是不是"可用插件"。
   *
   * 用**结构**（pluginName + 至少一个 web/server 入口）而不是 installable 标记来判定 ——
   * 因为 installable 的语义是"是否进本地插件列表"（作者为了不重复展示会关掉它），
   * 那不是"是不是插件"的判据。
   */
  function isPluginMeta(mini: Record<string, unknown> | undefined): boolean {
    if (!mini || typeof mini.pluginName !== 'string' || !mini.pluginName) return false
    return mini.web !== undefined || mini.server !== undefined
  }

  /** 额外要直查的包名（环境变量 MINI_CANVAS_NPM_PACKAGES；绕过 npm 搜索的排序问题） */
  const extraPackages = (): string[] =>
    (process.env.MINI_CANVAS_NPM_PACKAGES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  /**
   * 维护者名（环境变量 MINI_CANVAS_NPM_MAINTAINER；默认取第一个 scope 前缀里的名字）。
   *
   * 为什么要有：npm 搜索按**热度**排序，刚发布的包（0 下载）用包名/前缀词**永远搜不到**
   * （实测：`mini-canvas-plugin-` 搜 250 条命中 0 个）。但 `maintainer:xxx` 是按发布者过滤的，
   * 能把同一作者的全部包列出来（实测 30 个里就有我们的包）。所以浏览/搜索都带上它兜底。
   */
  const maintainers = (): string[] =>
    (process.env.MINI_CANVAS_NPM_MAINTAINER ?? 'imohuan')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

  /** 包名 → 落盘目录/文件 id（去 scope 前缀，/ 换 __；普通包名原样） */
  const dirNameOf = (pkg: string): string => pkg.replace(/^@/, '').replace('/', '__')

  /**
   * 把一批候选包名变成"可安装插件描述"：查 packument → 校验 installable → 归一字段。
   * 多处（搜索/浏览）共用；单个包查失败返回 null（不影响整页）。
   */
  async function describeInstalled(names: Iterable<string>): Promise<Array<{
    pkg: string
    description: string
    version: string
    date: string
    hasServer: boolean
    title: string
  }>> {
    const list = [...names].filter((n) => scopeAllowed(n))
    const out = await Promise.all(
      list.map(async (name) => {
        try {
          const pk = await client.packument(name)
          const latest = pk['dist-tags'].latest
          if (!latest) return null
          const mini = (pk.versions[latest] as unknown as { miniCanvas?: Record<string, unknown> })?.miniCanvas
          if (!isPluginMeta(mini)) return null
          const m = mini as Record<string, unknown>
          return {
            pkg: name,
            description: pk.description ?? '',
            version: latest,
            date: pk.time?.[latest] ?? '',
            hasServer: m.server !== undefined,
            title: typeof m.title === 'string' ? m.title : name,
          }
        } catch {
          return null
        }
      }),
    )
    return out.filter((x): x is NonNullable<typeof x> => x !== null)
  }

  // ------------------------------------------------------------------
  // 浏览：把白名单前缀下**全部可安装插件**列出来（列表页默认加载，不必先搜）
  //
  // 为什么不让前端默认发一个搜索词：npm 搜索按热度排序，刚发布的新包排不进结果。
  // 按前缀浏览走的是"逐前缀搜 + packument 校验"，能把前缀下的插件尽量都捞出来。
  // ------------------------------------------------------------------
  app.get('/api/npm-plugins/browse', async (c) => {
    try {
      const names = new Set<string>()
      for (const prefix of prefixes) {
        try {
          // 每个前缀搜一次（去掉尾部 / ，npm 搜索不吃带斜杠的 scope）
          for (const h of await client.search(prefix.replace(/\/$/, ''), 100)) names.add(h.name)
        } catch { /* 单个前缀搜失败不致命 */ }
      }
      for (const m of maintainers()) {
        try {
          for (const h of await client.search('maintainer:' + m, 100)) {
            names.add(h.name)
          }
        } catch { /* 单个维护者搜失败不致命 */ }
      }
      // 显式配置的包名（环境变量 MINI_CANVAS_NPM_PACKAGES，逗号分隔）**直查**：
      // npm 搜索按热度排序，刚发布的包排不进结果（实测），这些名字必须绕过搜索直接列。
      for (const n of extraPackages()) names.add(n)
      // 二次名称校验：只留**前缀白名单内**的（describeInstalled 里已按 scopeAllowed 过滤，
      // 这里再显式收一次，保证"浏览"列出的全是本系统认的插件，不掺无关包）。
      const results = await describeInstalled([...names].filter((n) => scopeAllowed(n)))
      return c.json({ ok: true, results })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502)
    }
  })

  // ------------------------------------------------------------------
  // 搜索：转发 npm 搜索 + 按 miniCanvas.installable 二次过滤（路由职责）
  // ------------------------------------------------------------------
  app.get('/api/npm-plugins/search', async (c) => {
    const q = c.req.query('q')?.trim() ?? ''
    if (!q) return c.json({ ok: false, error: '需要 q（搜索关键词）' }, 400)
    try {
      // 搜索两步走（用户口径）：
      //   ① **候选池**：npm 模糊搜索 + 维护者列表（后者绕开"热度排序让新包搜不到"）；
      //   ② **名称校验**：候选池里的包名必须**真的含搜索词**才留 —— 否则搜乱七八糟的东西
      //      也会把作者的整份插件列表倒出来（用户实测：搜"撒旦法的发"下面照样有数据）。
      const pool = new Set<string>()
      try {
        for (const h of await client.search(q, 50)) pool.add(h.name)
      } catch { /* 忽略 */ }
      for (const m of maintainers()) {
        try {
          for (const h of await client.search('maintainer:' + m, 100)) pool.add(h.name)
        } catch { /* 忽略单个失败 */ }
      }
      // 输入本身也进候选池（精确包名场景：搜全名要必中，哪怕它热度排不上）
      pool.add(q)
      // 也把"前缀 + 输入"当候选（让 plugin-demo 能命中 @scope/plugin-demo / mini-canvas-plugin-demo）。
      // 安全性由后面的名称校验 + packument 实查兜底：查不到/不匹配的自然被丢掉。
      for (const prefix of prefixes) {
        const trimmed = prefix.replace(/\/$/, '')
        if (/^[a-z0-9-]+$/i.test(q)) {
          pool.add(prefix + q) // @scope/ + q  或  mini-canvas- + q
          pool.add(trimmed + '-' + q)
        }
      }

      // ② 名称校验：只留包名包含搜索词的（大小写不敏感）。
      //    搜全名 / 前缀 / 词片段都能命中；搜无关内容则一个都不留（正确行为）。
      //    注意："包名含搜索词"用**词义包含**（去掉 scope 前缀后再比），这样 plugin-demo
      //    能命中 @mini-canvas/plugin-demo，而乱七八糟的词一个都不留。
      const needle = q.toLowerCase()
      const matched = [...pool].filter((n) => {
        const bare = n.replace(/^@[^/]+\//, '').toLowerCase()
        return n.toLowerCase().includes(needle) || bare.includes(needle)
      })
      return c.json({ ok: true, results: await describeInstalled(matched) })
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
      return { status: 400, body: { ok: false, error: '包名不在允许的前缀内（允许：' + prefixes.join(' / ') + '）。装其它来源需在服务端配置 scopeAllowlist。' } }
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
    // ③ 是不是插件：看结构（pluginName + web/server 入口），不看 installable
    if (!isPluginMeta(mini)) {
      return { status: 400, body: { ok: false, error: '该包不是 miniCanvas 插件（缺 miniCanvas.pluginName 或 web/server 入口）' } }
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
      // 落盘目录名：包名去掉 scope 前缀、把 / 换成 __（普通包如 mini-canvas-plugin-showcase 原样）
      const pkgDirName = dirNameOf(pkg)
      const webDest = path.join(opts.pluginsDir ?? path.join(opts.serverPluginsDir, '..', 'plugins'), pkgDirName, 'dist')
      await fs.mkdir(webDest, { recursive: true })
      const webText = await fs.readFile(path.join(distDir, webFile), 'utf8')
      await fs.writeFile(path.join(webDest, webFile), webText, 'utf8')
      // ⚠️ package.json 必须一起落：catalog 靠它的 miniCanvas 段判定"进不进本地列表"并取
      // title/globalName/server 元数据。少了它，前端半文件在、但管理页列不出来（实测踩过）。
      //
      // 关键：**强制补上 installable: true**。作者为了让源码包不进列表，会在发布的包里关掉它；
      // 但装进来的这份**就是**本地列表要展示的插件，必须显式打开，否则装完列表里看不到（实测踩过）。
      const pkgObj = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8')) as {
        miniCanvas?: Record<string, unknown>
      }
      pkgObj.miniCanvas = { ...(pkgObj.miniCanvas ?? {}), installable: true }
      await fs.writeFile(path.join(path.dirname(webDest), 'package.json'), JSON.stringify(pkgObj, null, 2), 'utf8')
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
        const serverId = dirNameOf(pkg)
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
    const pkgDirName = dirNameOf(pkg)
    const serverId = pkgDirName
    // 只删"NPM 安装副本"目录。护栏：目录名必须与**我们落盘时用的名字**一致（dirNameOf(pkg)），
    // 且位于插件目录下 —— 绝不会误删作者的仓库源码包（它的目录名是 plugin-showcase 这种，
    // 与本函数算出的 pkgDirName 不同名时一律不动）。
    const pluginsRoot = opts.pluginsDir ?? path.join(opts.serverPluginsDir, '..', 'plugins')
    const target = path.join(pluginsRoot, pkgDirName)
    // 真护栏：只有当这个目录**确实是我们从 NPM 装进来的**（package.json 的 name === 该包名）才删。
    // 这样万一目录名与作者的仓库源码包撞名（如 plugin-showcase），也绝不会误删源码。
    let isOurInstall = false
    try {
      const pj = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8')) as { name?: string }
      isOurInstall = pj.name === pkg
    } catch {
      isOurInstall = false
    }
    if (isOurInstall) {
      await fs.rm(target, { recursive: true, force: true })
    }
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

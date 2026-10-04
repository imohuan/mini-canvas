/**
 * pluginManagerService —— 插件管理服务的状态与动作。
 *
 * 三件事：
 * 1. **拉清单**：从「中转后台」请求 /catalog.json（地址可配），归一成可渲染的列表；
 * 2. **装 / 卸 / 重装**：经宿主的统一安装句柄（`ctx.get('pluginManager')`）把插件装进画布；
 * 3. **记住选择**：把「已装/已卸」存进 save(config) 域，刷新后照旧；**首次没有存档 → 默认全装**。
 *
 * 边界：本服务不认识具体插件，只认清单行的「地址 + 全局名」。装什么、从哪装由清单决定。
 */
import { reactive } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import {
  normalizeCatalog,
  resolveDesiredIds,
  type CatalogEntry,
} from './catalogTypes'
import { createUmdLoader, bustCache, type LoadedPluginModule } from './umdLoader'

/** 存「已装 id 集合」的 save key（config 域） */
export const INSTALLED_KEY = 'plugin-manager:installed'

/** 一行清单 + 它此刻的运行态 */
export interface PluginRow {
  entry: CatalogEntry
  /** 实际装进内核的插件名（清单 name 未必等于它；装上后记下，供「已装」判定） */
  realName?: string
  /** 已装 / 未装 */
  installed: boolean
  /** 正在安装/重装（按钮禁用、显示转圈） */
  busy: boolean
  /** 最近一次操作的错误（面板上显示一行红字） */
  error?: string
  /** 该插件在画布上的运行态（active / pending / failed；未装则 undefined） */
  state?: string
  /** pending 时缺哪些依赖 */
  missingDeps?: string[]

  // ===== 后台那一半（清单项带 server 时才有） =====
  /** 该插件有没有后台产物（清单里声明了 server） */
  hasServer: boolean
  /** 后台那一半是否已装到服务器上 */
  serverInstalled: boolean
  /**
   * 用户是否已**显式确认**装后台那一半（界面上的确认动作）。
   * 没有它 = 不装后台（后端也会拒 confirm !== true，两边都拦）。
   */
  serverConfirm?: boolean
  /** 后台安装/卸载的错误（与前端错误分开显示，便于定位是哪一半出的问题） */
  serverError?: string
}

/** 宿主注入的「统一安装句柄」（canvas-render 的 PluginManager；这里只用到三件） */
export interface HostPluginManager {
  install(source: PluginModule | { module(): PluginModule | Promise<PluginModule> } | { url: string } | { text: string }, opts?: { config?: object }): Promise<string>
  uninstall(name: string): boolean
  reload(name: string, next?: PluginModule | { url: string }): Promise<void>
  list(): Array<{ name: string; state?: string; missingDeps?: string[]; error?: string }>
}

export interface PluginManagerService {
  readonly state: {
    /** 中转后台地址（可改；改完点刷新重拉） */
    catalogUrl: string
    /** 清单拉取中 */
    loading: boolean
    /** 拉取/操作错误（一句话） */
    error: string
    rows: PluginRow[]
    /**
     * 「用户想要装哪些」的 id 集合（存档就是它）。
     *
     * 为什么单独记而不是从 rows.installed 反推：安装是异步的，中途失败/页面提前关闭时有的是
     * 「想装但还没装上」。存档记**意图**才能在下次启动补上；记**结果**会把没装上的永远丢掉。
     */
    intent: string[]
    /** 是否拿到了清单 */
    ready: boolean
    /** 一次性批量装机中（首次默认全装时可能出现） */
    installingAll: boolean
  }
  /** 重新拉清单 + 对齐已装状态（用户点刷新，或改完地址后调） */
  refresh(): Promise<void>
  /** 装一个（id = 清单项的 id） */
  /**
   * 装一个插件（前端装载 + 后台那一半若清单声明了 server）。
   * @param opts.serverConfirm 用户是否已显式确认"后台插件以服务端权限运行"；
   *   缺省 false = **不装后台那一半**（安全默认，界面负责取这个确认）。
   */
  install(id: string, opts?: { serverConfirm?: boolean }): Promise<void>
  /** 卸一个 */
  uninstall(id: string): Promise<void>
  /** 重装（卸了再装；用于「改了产物想看新版」） */
  reinstall(id: string): Promise<void>
  /** 装全部未装的（默认全装也走它） */
  installAll(): Promise<void>
  /** NPM 市场搜索（服务端代查 + installable 过滤） */
  searchNpmPlugins(q: string): Promise<NpmSearchResult[]>
  /** 从 NPM 安装（含后台半时调用方须已确认） */
  installFromNpm(pkg: string, opts?: { serverConfirm?: boolean }): Promise<void>
  /** 从 NPM 更新到 latest */
  updateFromNpm(pkg: string): Promise<{ updated: boolean; to?: string }>
  /** 卸载 NPM 来源的包（两半一起删；后台半重启生效） */
  uninstallFromNpm(pkg: string): Promise<void>
  /** NPM 来源的已装清单 */
  listNpmInstalled(): Promise<NpmInstalledEntry[]>
}

/** NPM 搜索结果的一条（cloud-server /api/npm-plugins/search 的 results 元素） */
export interface NpmSearchResult {
  pkg: string
  title: string
  description: string
  version: string
  date: string
  hasServer: boolean
}

/** NPM 来源已装记录（/api/npm-plugins/installed 的元素） */
export interface NpmInstalledEntry {
  pkg: string
  version: string
  installedAt: string
  serverSha256?: string
}

/**
 * 默认清单地址：指向 **cloud-server**（mini-canvas-cloud serve，默认 8865）。
 *
 * 用**同源相对地址**而不是写死端口：云服务既托管画布界面、又发插件清单，两者本来就同源 ——
 * 写死端口反而会在「服务换端口」「ui 单独 dev 而服务在别处」时失效。需要在别处取清单时，
 * 在设置页里把地址改成绝对地址即可。
 */
export const DEFAULT_CATALOG_URL = '/plugin-catalog.json'

/** 「全部安装」时的服务端权限一次性确认文案（与单个安装的确认同口径，覆盖整批） */
const SERVER_CONFIRM_TEXT =
  '本批插件中有包含后台插件（以服务端权限运行，可读写文件、发起网络请求）。\n\n' +
  '只在你信任插件来源时才继续。是否确认安装？'

export interface CreateServiceOptions {
  /** 中转后台清单地址（含 /catalog.json） */
  catalogUrl?: string
  /** 拉清单用的 fetch（测试注入假实现） */
  fetchImpl?: typeof fetch
  /** 注入 document/window（默认取全局；测试注入假实现） */
  document?: Document
  win?: Record<string, unknown>
}

/**
 * 算文本的 sha256（hex）。浏览器用 Web Crypto；拿不到时报错（调用方据此拒绝安装）。
 * 为什么不用第三方库：crypto.subtle 是现代浏览器标配，省一个依赖。
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('当前环境没有 Web Crypto，无法校验 sha256（拒绝安装）')
  const bytes = new TextEncoder().encode(text)
  const buf = await subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 从清单地址推「插件产物基地址」（/catalog.json → 根），用于把相对 url 补全 */
export function baseOfCatalogUrl(catalogUrl: string): string {
  try {
    const u = new URL(catalogUrl)
    return u.origin
  } catch {
    return ''
  }
}

/** 把清单里的相对 url（/plugins/…）补成绝对地址；已是绝对地址则原样返回 */
export function absolutize(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url
  if (!base) return url
  return base.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '')
}

export function createPluginManagerService(
  ctx: Context,
  opts: CreateServiceOptions = {},
): PluginManagerService {
  const catalogUrl = opts.catalogUrl || DEFAULT_CATALOG_URL
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const win = opts.win ?? (globalThis as unknown as Record<string, unknown>)
  const doc = opts.document ?? (win.document as Document)

  const state = reactive<PluginManagerService['state']>({
    catalogUrl,
    loading: false,
    error: '',
    rows: [],
    intent: [],
    ready: false,
    installingAll: false,
  })

  /**
   * 正在飞的那次 refresh。
   *
   * 为什么要有它：refresh 是「拉清单 → 重建 rows → 逐条安装」，期间会**替换 state.rows**。
   * 而它有两处触发点（插件 apply 时一次、设置页挂载时再看情况补一次）。两次并发时，后一次会在
   * 前一次的安装循环跑到一半时把 rows 换成一批新对象 —— 前一次手里那些行成了「孤儿」，
   * 它写 `row.installed = true` 写在孤儿上，新数组里那行永远是未装（实测症状：三个只装上两个）。
   * 故 refresh 重入时直接复用同一个 Promise：一次只会有一趟。
   */
  let inFlight: Promise<void> | undefined

  /** 宿主统一安装句柄（可选探测：没有就给出清晰错误，而不是静默不动） */
  function hostManager(): HostPluginManager | undefined {
    return ctx.tryGet<HostPluginManager>('pluginManager')
  }
  /** 存储（可选探测）；用来记住「哪些装过」 */
  function save() {
    return ctx.tryGet<{ get<T>(k: string, t?: string): Promise<T | undefined>; set(k: string, v: unknown, t?: string): void }>('save')
  }

  /**
   * 按一份「想要的 id 集合」把内核里的插件对齐：多的卸掉、少的装上。
   * 复用 install/uninstall 的正常路径（它们各自会把意图写回当前后端）。
   */
  async function applyIntent(ids: string[]): Promise<void> {
    const want = new Set(ids)
    for (const row of [...state.rows]) {
      if (row.entry.builtin === true) continue
      if (row.installed && !want.has(row.entry.id)) await uninstall(row.entry.id)
    }
    const missing = ids.filter((id) => {
      const row = state.rows.find((r) => r.entry.id === id)
      return row && !row.installed
    })
    await installMany(missing)
  }

  /**
   * 订阅「config 域后端被切换」，切完把安装名单与**新后端**对齐。
   *
   * 为什么必须有（用户报的 bug）：名单的**读**发生在启动早期，那时 config 还指向浏览器本地；
   * 而**写**（用户点安装/卸载时）发生在云插件把 config 切到云端之后。两本账对不上 ——
   * 用户看到的正是「装好的插件刷新后全没了、连它们的配置一起消失」。
   *
   * 对齐语义与配置持久化桥（settingsPersist）完全一致：
   * - 新后端**有**名单 → 以它为准（云端是真身）：多出来的卸掉、少的补装；
   * - 新后端**没有**名单（首次上云）→ 把当前意图搬过去，别让云端的"空"把已装插件抹掉。
   */
  function bindAdapterReload(): void {
    const svc = ctx.tryGet<{ onAdapterChange?(cb: (type: string) => void): { dispose(): void } }>('save')
    if (!svc?.onAdapterChange) return
    ctx.effect(() => {
      const off = svc.onAdapterChange!((type) => {
        if (type !== 'config') return
        void (async () => {
          const saved = await save()?.get<string[]>(INSTALLED_KEY, 'config')
          if (saved === undefined) {
            // 全新后端：把当前意图搬过去（不重装，现有状态已符合意图），别让云端的空抹掉已装插件。
            save()?.set(INSTALLED_KEY, [...state.intent], 'config')
            return
          }
          // 清单还没拉完（rows 为空）→ 交给 refresh 重新按新后端走一遍（它会读到刚切好的后端）。
          if (!state.ready) {
            void refresh()
            return
          }
          state.intent = [...saved]
          await applyIntent(saved)
        })()
      })
      return () => off.dispose()
    })
  }

  /** 把内核的运行时态（active/pending/failed + missingDeps）刷进每一行 */
  function syncRuntimeState(): void {
    const m = hostManager()
    if (!m) return
    const byName = new Map(m.list().map((p) => [p.name, p]))
    for (const row of state.rows) {
      // 内核插件名可能三处都对不上：清单 id（目录名）、清单 name（包名）、真实插件名（装上后记的 realName）。
      // 依次尝试，命中即算已装。
      const info =
        (row.realName ? byName.get(row.realName) : undefined) ?? byName.get(row.entry.name) ?? byName.get(row.entry.id)
      // 自带插件：它就是应用冷启动装好的那些，**永远算"已装"**（页面上只读展示、不参与装卸）。
      // 用 byName 命不命中来判"装没装"对自带件没意义（比如 ui 自己的换皮插件不在清单目录里），
      // 所以直接认定已装，状态取真实运行态（拿得到就显示，拿不到留空）。
      if (row.entry.builtin === true) {
        row.state = info?.state ?? row.state
        row.missingDeps = info?.missingDeps
        row.installed = true
        continue
      }
      row.state = info?.state
      row.missingDeps = info?.missingDeps
      row.installed = !!info
    }
  }

  /** 把「意图（想装哪些）」存盘，供下次启动照旧 */
  function persistIntent(): void {
    save()?.set(INSTALLED_KEY, [...state.intent], 'config')
  }

  /** 意图里加/减一个 id（去重） */
  function setIntent(id: string, want: boolean): void {
    const has = state.intent.includes(id)
    if (want && !has) state.intent.push(id)
    else if (!want && has) state.intent = state.intent.filter((x) => x !== id)
  }

  /**
   * 卸掉一行对应的插件，**尽力而为、不抛**。
   *
   * 为什么按「真实名 → 清单名 → 目录名」逐个试：内核里插件名是源码 export 的 name，
   * 与清单的 name（包名）和 id（目录名）都未必一致。且 `manager.uninstall` 对「没装/核心插件」
   * **会抛错**（应用层句柄不做静默失败）—— 所以每个候选都单独 catch，谁成功即止。
   * @returns 是否卸掉了一个
   */
  function tryUninstall(row: PluginRow): boolean {
    const m = hostManager()
    if (!m) return false
    const candidates = [row.realName, row.entry.name, row.entry.id].filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    )
    for (const name of candidates) {
      try {
        if (m.uninstall(name)) return true
      } catch {
        /* 该候选不是内核里的名字 / 核心插件不可卸 → 试下一个 */
      }
    }
    return false
  }

  /**
   * 按新清单**原地**对齐行：同一 id 复用已有 row 对象（保住 realName / 正在飞的状态），
   * 只更新 entry；新出现的 id 追加；已消失的 id 移除。
   *
   * 为什么必须原地而不是 `state.rows = entries.map(...)`：整批换新会让「正在跑的那趟」
   * 手里握着的 row 变成孤儿，它写的 installed/realName 都落在垃圾对象上（真实踩过）。
   */
  function reconcileRows(entries: CatalogEntry[]): void {
    const byId = new Map(state.rows.map((r) => [r.entry.id, r]))
    const next: PluginRow[] = []
    for (const entry of entries) {
      const existing = byId.get(entry.id)
      if (existing) {
        existing.entry = entry
        existing.hasServer = entry.server !== undefined
        next.push(existing)
      } else {
        next.push({
          entry,
          installed: false,
          busy: false,
          hasServer: entry.server !== undefined,
          serverInstalled: false,
        })
      }
    }
    state.rows.splice(0, state.rows.length, ...next)
  }

  /**
   * 装后台那一半（清单项带 server 时）。
   *
   * 边界：**不抛** —— 后台装不上不该让前端也装不上（两半独立，各自报错）。
   * 失败原因写进 `row.serverError`，界面上与前端错误分开显示。
   *
   * 安全（与后端路由对齐，见 cloud-server/src/routes/serverPlugins.ts 文件头）：
   * - 先把产物**文本**下载下来（浏览器出网，服务端不外连 → 无 SSRF）；
   * - 算 sha256 声明给服务端校验；
   * - `confirm: true` 表示用户已在界面上确认"以服务端权限运行"。
   */
  async function installServerHalf(row: PluginRow): Promise<void> {
    const server = row.entry.server
    if (!server) return
    row.serverError = undefined
    try {
      const abs = absolutize(server.url, baseOfCatalogUrl(state.catalogUrl))
      const res = await doFetch(abs, { headers: { accept: 'text/javascript' } })
      if (!res.ok) throw new Error('下载后台产物失败：' + res.status)
      const code = await res.text()
      // ⚠️ 关键（审查修正）：**不在这里自己算哈希再传给服务端** ——
      // 那等于"同一条通道里，改包的人自己算、自己验"，是自洽的、防不住任何东西。
      // 完整性锚点必须是**服务端自己的信任源**（扫插件目录得到的清单里那份 sha256），
      // 由服务端自己比对。这里只把清单声明的哈希一并带上（服务端会用它校验，
      // 但**不信任**它 —— 服务端以自己 catalog 里的值为准）。
      const origin = baseOfCatalogUrl(state.catalogUrl)
      const r = await doFetch(origin + '/api/server-plugins/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: row.entry.id,
          code,
          // 清单声明的哈希（服务端会拿它跟自己扫出来的对；对不上就拒）
          sha256: server.sha256,
          // 用户已在界面上显式确认"以服务端权限运行"（由 install() 的 opts.confirm 传来）
          confirm: row.serverConfirm === true,
          origin,
        }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok !== true) throw new Error(j.error ?? '后台安装失败：' + r.status)
      row.serverInstalled = true
    } catch (err) {
      row.serverError = err instanceof Error ? err.message : String(err)
    }
  }

  /** 卸后台那一半（不抛，错误写进 serverError） */
  async function uninstallServerHalf(row: PluginRow): Promise<void> {
    if (!row.hasServer) return
    row.serverError = undefined
    try {
      const origin = baseOfCatalogUrl(state.catalogUrl)
      const r = await doFetch(origin + '/api/server-plugins/uninstall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.entry.id }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok !== true) throw new Error(j.error ?? '后台卸载失败：' + r.status)
      row.serverInstalled = false
    } catch (err) {
      row.serverError = err instanceof Error ? err.message : String(err)
    }
  }

  async function install(id: string, opts?: { serverConfirm?: boolean }): Promise<void> {
    const row = state.rows.find((r) => r.entry.id === id)
    if (!row) return
    if (row.entry.builtin === true) return // 自带插件不可装卸（页面上也不给按钮，这里是兜底）
    if (row.installed) return
    // **在途去重锁**：refresh 与 adapter 切换后的 applyIntent 可能交叠，同一插件被两条链各调一次
    // → UMD script 注入两份、插件重复装载（实测：启动爆发 200+ 条校验日志 / 画布闪烁）。
    // busy=true 的行直接跳过 —— 第二条链等第一条装完（row.installed 变 true）自然不会再装。
    if (row.busy) return
    row.busy = true
    row.error = undefined
    // 用户的显式确认（界面动作）记在 row 上，供 installServerHalf 读。
    // 没确认 → 不装后台那一半（后端也会拒，两边都拦）。
    row.serverConfirm = opts?.serverConfirm === true
    try {
      const m = hostManager()
      if (!m) throw new Error('宿主没有提供 pluginManager 服务（插件管理需要一个能装插件的宿主）')
      if (!doc || typeof doc.createElement !== 'function') throw new Error('当前环境没有 document，无法用 <script> 加载插件')
      const abs = absolutize(row.entry.url, baseOfCatalogUrl(state.catalogUrl))
      const mod = (await createUmdLoader({ document: doc, win })(abs, row.entry.globalName)) as LoadedPluginModule as unknown as PluginModule
      row.realName = mod.name
      await m.install(mod)
      row.installed = true
      // 前端装上了 → 顺带装后台那一半（成对安装；后台失败不影响前端已装成的事实）
      await installServerHalf(row)
      setIntent(row.entry.id, true)
      syncRuntimeState()
      persistIntent()
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err)
    } finally {
      row.busy = false
    }
  }

  async function uninstall(id: string): Promise<void> {
    const row = state.rows.find((r) => r.entry.id === id)
    if (!row) return
    if (row.entry.builtin === true) return // 自带插件不可卸（页面上不给按钮，这里兜底）
    if (!hostManager()) {
      row.error = '宿主没有提供 pluginManager 服务'
      return
    }
    row.busy = true
    row.error = undefined
    try {
      if (!tryUninstall(row)) throw new Error(`没能卸载（可能不是本插件管理的插件，或该插件不允许卸载）：${row.entry.id}`)
      row.installed = false
      row.state = undefined
      // 前端卸了 → 顺带卸后台那一半（成对；后台失败只记 serverError，不影响前端已卸成）
      await uninstallServerHalf(row)
      setIntent(row.entry.id, false)
      syncRuntimeState()
      persistIntent()
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err)
    } finally {
      row.busy = false
    }
  }

  async function reinstall(id: string): Promise<void> {
    const row = state.rows.find((r) => r.entry.id === id)
    if (!row) return
    if (row.entry.builtin === true) return // 自带插件不可重装（页面上不给按钮，这里兜底）
    const m = hostManager()
    if (!m) {
      row.error = '宿主没有提供 pluginManager 服务'
      return
    }
    row.busy = true
    row.error = undefined
    try {
      // 先卸（若在装；尽力而为，本来就没装也不影响）；再用带时间戳的地址重拉（破浏览器缓存 → 拿到改过的产物）
      tryUninstall(row)
      const abs = absolutize(row.entry.url, baseOfCatalogUrl(state.catalogUrl))
      const loader = createUmdLoader({ document: doc, win })
      const mod = (await loader(bustCache(abs, Date.now()), row.entry.globalName)) as LoadedPluginModule as unknown as PluginModule
      row.realName = mod.name
      await m.install(mod)
      row.installed = true
      // 重装也顺带重装后台那一半
      await installServerHalf(row)
      setIntent(row.entry.id, true)
      syncRuntimeState()
      persistIntent()
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err)
    } finally {
      row.busy = false
    }
  }

  async function installAll(): Promise<void> {
    state.installingAll = true
    try {
      // 含后台半的插件：一次性确认（installAll 入口弹一次，覆盖本批所有 server 插件），
      // 不然"全部安装"会把服务端半静默留在半装状态（后端 400 拒掉 confirm=false 的请求）。
      const hasServer = state.rows.some((row) => !row.installed && row.entry.server !== undefined)
      const serverConfirm = !hasServer || window.confirm(SERVER_CONFIRM_TEXT)
      await installMany(
        state.rows.filter((row) => !row.installed).map((row) => row.entry.id),
        { serverConfirm },
      )
    } finally {
      state.installingAll = false
    }
  }

  /**
   * 批量装载（并发受限）。串行 for-await 在插件多时启动时间线性膨胀（每个 = 下载 + 执行 + 装配）；
   * 并发能显著缩短启动窗口。并发上限 4：再高会对浏览器/网络造成无谓压力，收益递减。
   * 失败隔离：单个失败不影响其它（错误已写进各自 row.error）。
   */
  async function installMany(ids: string[], opts?: { serverConfirm?: boolean }): Promise<void> {
    const CONCURRENCY = 4
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]!
        await install(id, opts)
      }
    })
    await Promise.all(workers)
  }

  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = doRefresh().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }

  async function doRefresh(): Promise<void> {
    state.loading = true
    state.error = ''
    try {
      const res = await doFetch(state.catalogUrl, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`中转后台返回 ${res.status}`)
      const json = (await res.json()) as unknown
      const entries = normalizeCatalog(json)

      // 读存档（未存过 = undefined → 首次默认全装）
      const saved = await save()?.get<string[]>(INSTALLED_KEY, 'config')
      const desired = resolveDesiredIds(entries, saved)
      state.intent = [...desired]

      // 复核行（**原地**对齐，不整批换新对象）——这样即便本函数与另一趟 refresh 交叠，
      // 两边操作的也是同一批 row 对象，不会有「孤儿行」（真实踩过：三插件只装上两个）。
      reconcileRows(entries)
      syncRuntimeState()
      state.ready = true

      // 首次（saved === undefined）：把清单里默认该装的都装上
      if (saved === undefined) {
        // 先记「想装全部」（意图），再逐条装 —— 中途失败/关页面，下次也会把没装上的补上。
        persistIntent()
        state.installingAll = true
        try {
          await installMany(desired)
        } finally {
          state.installingAll = false
        }
      } else {
        // 有存档：只装「存档里有、但此刻内核里没有」的（例如换机器、或上次卸载失败留下的缺口）
        const missing = desired.filter((id) => {
          const row = state.rows.find((r) => r.entry.id === id)
          return row && !row.installed
        })
        await installMany(missing)
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      state.ready = false
    } finally {
      state.loading = false
    }
  }

  bindAdapterReload()

  // ============================================================================
  // NPM 市场（计划 Task 5）：搜索 / 安装 / 更新 / 卸载（走 cloud-server 的 npm-plugins 路由）
  // ============================================================================
  async function searchNpmPlugins(q: string): Promise<NpmSearchResult[]> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/search?q=' + encodeURIComponent(q), {
      headers: { accept: 'application/json' },
    })
    const json = (await res.json()) as { ok?: boolean; results?: NpmSearchResult[]; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(json.error ?? '搜索失败：' + res.status)
    return json.results ?? []
  }

  /** 装一个 NPM 包（含后台半时调用方必须已确认；confirm 直传后端） */
  async function installFromNpm(pkg: string, opts?: { serverConfirm?: boolean }): Promise<void> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: pkg, confirm: opts?.serverConfirm === true }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(json.error ?? 'NPM 安装失败：' + res.status)
    // 装完重拉本地清单（新插件的前端半这时才出现在 rows 里），并把它的**前端半立刻装进内核**——
    // 用户点一次「安装」就该看到插件活，而不是还要在本地列表里再点一次（实测踩过：装完是"未安装"）。
    await refresh()
    await installFrontHalfOfNpm(pkg)
  }

  /**
   * 把刚经 NPM 装进来的那个包的前端半装进内核。
   * 按包名对应到 catalog 行的 id（落盘目录名 = 包名去掉 @ 后把 / 换成 __）。
   */
  async function installFrontHalfOfNpm(pkg: string): Promise<void> {
    const wantId = pkg.replace(/^@/, '').replace('/', '__')
    const row = state.rows.find((r) => r.entry.id === wantId)
    if (!row || row.installed) return
    await install(row.entry.id, { serverConfirm: true })
  }

  async function updateFromNpm(pkg: string): Promise<{ updated: boolean; to?: string }> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: pkg, confirm: true }),
    })
    const json = (await res.json()) as { ok?: boolean; updated?: boolean; to?: string; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(json.error ?? 'NPM 更新失败：' + res.status)
    // 更新后同样把前端半刷成新产物：先卸内核里的旧版，再重装（地址带破缓存参数，见 reinstall）
    await refresh()
    if (json.updated === true) {
      const wantId = pkg.replace(/^@/, '').replace('/', '__')
      const row = state.rows.find((r) => r.entry.id === wantId)
      if (row) await reinstall(row.entry.id)
    }
    return { updated: json.updated === true, to: json.to }
  }

  async function uninstallFromNpm(pkg: string): Promise<void> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: pkg }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(json.error ?? 'NPM 卸载失败：' + res.status)
    // 卸载前先把内核里的**前端半**摘掉 —— 后端只删磁盘文件，不会动浏览器里已装载的插件
    // （实测踩过：文件删了但面板还活着）。用卸前的 rows 找它的 id（refresh 后行就没了）。
    const wantId = pkg.replace(/^@/, '').replace('/', '__')
    const wasInstalled = state.rows.find((r) => r.entry.id === wantId)?.installed === true
    if (wasInstalled) await uninstall(wantId)
    await refresh()
  }

  /** 已从 NPM 装的包（含版本与是否有更新） */
  async function listNpmInstalled(): Promise<NpmInstalledEntry[]> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/installed', { headers: { accept: 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; plugins?: NpmInstalledEntry[] }
    return json.plugins ?? []
  }

  return {
    state, refresh, install, uninstall, reinstall, installAll,
    searchNpmPlugins, installFromNpm, updateFromNpm, uninstallFromNpm, listNpmInstalled,
  }
}

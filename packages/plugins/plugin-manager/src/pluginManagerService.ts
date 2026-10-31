/**
 * pluginManagerService —— 插件管理服务的状态与动作。
 *
 * 三件事：
 * 1. **拉清单**：从「中转后台」请求 /catalog.json（地址可配），归一成可渲染的列表；
 * 2. **装 / 卸 / 重装**：经宿主传入的统一安装句柄（`host.manager`）把插件装进画布；
 * 3. **记住选择**：把「已装/已卸」存进 save(config) 域，刷新后照旧；**首次没有存档 → 默认全装**。
 *
 * 边界：本服务不认识具体插件，只认清单行的「地址 + 全局名」。装什么、从哪装由清单决定。
 */
import { reactive } from 'vue'
import { withAdminToken, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import {
  normalizeCatalog,
  resolveDesiredIds,
  type CatalogEntry,
} from './catalogTypes'
import { createUmdLoader, bustCache, type LoadedPluginModule } from './umdLoader'

/** 存「已装 id 集合」的 save key（config 域） */
export const INSTALLED_KEY = 'plugin-manager:installed'

/**
 * 安装名单的**本地备份**物理 key（直接走浏览器 localStorage，不经过可切换的 config adapter）。
 *
 * 为什么需要它（用户实测）：装「云端连接」时，这个插件会把 config 域整体切到云端；
 * 之后写安装名单只落到云端。刷新页面时本地后端里没有名单，而 cloud-client 在 ui dev 下
 * 又不是自带件 —— 没人去读云端，于是「装好的插件刷新后全没了」。
 *
 * 与 INSTALLED_KEY 同名前缀（'config:' 是 SaveService 的物理 key 规则），这样：
 * - 本地后端就是激活后端时，备份与正式存档是同一格，不会出现两份互相矛盾的本地名单；
 * - 切到云端后，本地这一格保留最后一次同步，刷新时仍能先把插件装回来。
 *
 * 它是"启动用的种子"，不是第二份权威数据：一旦 cloud-client 连上后台，云端名单仍会
 * 通过 onAdapterChange 重读并对齐（见 reloadFromBackend）。
 */
export const INSTALLED_BACKUP_STORAGE_KEY = 'config:' + INSTALLED_KEY

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
  /** 后台那一半是否已**登记进内核**（= 正在生效）。只有文件没登记为 false。刷新后由服务端回填。 */
  serverLoaded?: boolean
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
  /**
   * 绑定宿主的统一安装句柄（`host.manager`）。
   *
   * 为什么要延迟绑定：内核只向插件 `apply` 传 `config`，插件拿不到宿主句柄；
   * 页面在渲染子树里能读到 `useCanvasRender().host.manager`，由它调用这里完成接线。
   * 重复绑定同一句柄是幂等的；换句柄会刷新已装状态。
   *
   * 返回的 Promise 在「绑定后补装存档缺口」完成后 resolve；调用方不需要等它也能用界面。
   * 为什么绑定后要补装：插件 apply 里先 refresh；那时页面还没挂载，宿主句柄没绑上，
   * 存档里该装的插件会装失败。只在 row 上留 error 不够 —— 页面挂载时若 ready 已为 true，
   * 不会再 refresh，缺口就永远补不上。
   */
  bindManager(manager: HostPluginManager): Promise<void>
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
  reinstall(id: string, opts?: { serverConfirm?: boolean }): Promise<void>
  /** 装全部未装的（默认全装也走它） */
  installAll(): Promise<void>
  /** NPM 市场搜索（服务端代查 + installable 过滤） */
  searchNpmPlugins(q: string): Promise<NpmSearchResult[]>
  /** NPM 市场浏览：按允许的包名前缀列出全部可安装插件（列表页默认加载，不必先搜） */
  browseNpmPlugins(): Promise<NpmSearchResult[]>
  /** 从 NPM 安装（含后台半时调用方须已确认） */
  installFromNpm(pkg: string, opts?: { serverConfirm?: boolean }): Promise<void>
  /** 从 NPM 更新到 latest */
  updateFromNpm(pkg: string): Promise<{ updated: boolean; to?: string }>
  /** 卸载 NPM 来源的包（两半一起删；后台半重启生效） */
  uninstallFromNpm(pkg: string): Promise<void>
  /** NPM 来源的已装清单 */
  listNpmInstalled(): Promise<NpmInstalledEntry[]>
  /**
   * 检查哪些已装插件有新版（返回 包名 → 最新版）。
   *
   * 附录 Task 5 要求已装列表有"有更新"灯；靠这个把"最新版"拉回来跟本地版本比。
   * 数据源是 browse（它已经查过每个包的 packument，带最新 version），不额外打服务端接口。
   */
  checkNpmUpdates(): Promise<Record<string, string>>
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

/** 403 时给用户的动作提示（保留服务端原文，方便排查是缺令牌还是来源不受信任） */
const ADMIN_TOKEN_HINT = '请先在设置 → 插件里填写管理令牌'

function readableServerError(message: string, status: number): string {
  return status === 403 ? `${ADMIN_TOKEN_HINT}（${message}）` : message
}

export interface CreateServiceOptions {
  /** 中转后台清单地址（含 /catalog.json） */
  catalogUrl?: string
  /** 拉清单用的 fetch（测试注入假实现） */
  fetchImpl?: typeof fetch
  /** 注入 document/window（默认取全局；测试注入假实现） */
  document?: Document
  win?: Record<string, unknown>
  /** 宿主统一安装句柄（`host.manager`）。旧 `pluginManager` 服务名已下线。 */
  manager?: HostPluginManager
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
  /**
   * 宿主统一安装句柄。构造时可直接给（测试/嵌入方），也可由页面经 `bindManager` 延迟绑定
   * —— 插件 apply 只拿得到 config，拿不到 host。
   */
  let boundManager: HostPluginManager | undefined = opts.manager

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
    return boundManager
  }

  async function bindManager(manager: HostPluginManager): Promise<void> {
    if (boundManager !== manager) boundManager = manager
    // 页面可能在清单已拉完之后才绑定（热装插件）：把已装状态补一遍，别让界面继续显示旧值。
    if (!state.ready) return
    // 若启动时那趟 refresh 还在跑（ready 已置 true，后面还在补装），等它结束再算缺口：
    // 否则会把正在安装（busy）的行当成缺口，而 install 对 busy 行直接返回，缺口就漏掉了。
    await inFlight
    syncRuntimeState()
    // 列表已就绪但绑定前装不上的行（典型的启动顺序）：现在有宿主句柄了，把缺口补上。
    const missing = state.intent.filter((id) => {
      const row = state.rows.find((r) => r.entry.id === id)
      return row !== undefined && row.entry.builtin !== true && !row.installed
    })
    if (missing.length === 0) return
    await installMany(missing).catch((err) => {
      // 单条失败已经写进各自 row.error；这里只兜住意外，避免调用方拿到未处理的 rejection。
      state.error = err instanceof Error ? err.message : String(err)
    })
  }

  /**
   * 按清单声明的**产物形态**把插件装进内核，返回它的运行时名。
   *
   * 两条路（不可互换，故由清单的 format 显式决定，见 catalogTypes 的说明）：
   * - 'esm'：交给宿主的统一安装句柄 manager.install({ url }) —— 内部是 fetch 文本 →
   *   import(data:text/javascript)。适合零裸模块名 import 的自包含产物（如云端客户端）。
   * - 'umd'（缺省，向后兼容）：<script> 注入 + 从 window 全局取插件对象。仓库里多数插件是这种。
   *
   * 两条路都在本函数里完成安装（而不是"取模块、由调用方再装"）——
   * 因为 esm 那条**本身就是安装动作**，若再让调用方装一次会变成"装完立刻卸了重装"。
   *
   * @param opts.bust 是否加时间戳破浏览器缓存（重装用；首次装不必）
   */
  async function installEntryModule(
    row: PluginRow,
    env: { document: Document; win: Record<string, unknown> },
    opts: { bust: boolean; manager: HostPluginManager },
  ): Promise<string> {
    const abs = absolutize(row.entry.url, baseOfCatalogUrl(state.catalogUrl))
    const url = opts.bust ? bustCache(abs, Date.now()) : abs
    if (row.entry.format === 'esm') {
      return await opts.manager.install({ url })
    }
    const mod = (await createUmdLoader({ document: env.document, win: env.win })(url, row.entry.globalName)) as LoadedPluginModule as unknown as PluginModule
    return await opts.manager.install(mod)
  }
  /** 存储（可选探测）；用来记住「哪些装过」 */
  function save() {
    return ctx.tryGet<{ get<T>(k: string, t?: string): Promise<T | undefined>; set(k: string, v: unknown, t?: string): void }>('save')
  }

  /** 浏览器本地那份备份（拿不到 localStorage 时安静返回 undefined） */
  function localBackupStorage(): Storage | undefined {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
      // Safari 隐私模式等：访问 localStorage 本身就会抛
      return undefined
    }
  }

  /** 读本地备份的安装名单（形状不对一律当没有） */
  function readLocalBackup(): string[] | undefined {
    const storage = localBackupStorage()
    if (!storage) return undefined
    try {
      const raw = storage.getItem(INSTALLED_BACKUP_STORAGE_KEY)
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string') ? (parsed as string[]) : undefined
    } catch {
      return undefined
    }
  }

  /** 把安装名单写一份到本地（配额不足等失败不抛：正式存档仍会照常写） */
  function writeLocalBackup(ids: string[]): void {
    const storage = localBackupStorage()
    if (!storage) return
    try {
      storage.setItem(INSTALLED_BACKUP_STORAGE_KEY, JSON.stringify(ids))
    } catch {
      /* 本地配额满 / 隐私模式：备份失败不影响主流程 */
    }
  }

  /**
   * 读「已装名单」：**当前后端优先，本地备份兜底**。
   *
   * 为什么要有兜底（用户实测）：装云端连接后 config 被切到云端，名单只写进了云端；
   * 刷新时本地后端里没有名单，cloud-client 本身又不在启动清单里，于是没人把云端那份读回来。
   * 本地留一份备份，刷新时先按它把插件装回来，云端连上后再由 onAdapterChange 对齐。
   */
  async function readSavedIntent(): Promise<string[] | undefined> {
    try {
      const saved = await save()?.get<string[]>(INSTALLED_KEY, 'config')
      if (Array.isArray(saved) && saved.every((x) => typeof x === 'string')) return saved
    } catch (err) {
      // 云端暂时连不上：不要因此把已装插件判成"从没装过"
      console.warn('[plugin-manager] 读取安装名单失败，改用本地备份', err)
    }
    return readLocalBackup()
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
        void reloadFromBackend()
      })
      return () => off.dispose()
    })
  }

  /**
   * 按**当前 config 后端**对齐安装名单。
   *
   * 关键：**清单没拉完（!state.ready）时绝不能写后端**。
   * 用户实测的数据丢失 bug：cloud-client 切 config 到云端那一刻，若 refresh 还没跑完，
   * state.intent 还是初始的 []；旧代码会把这个空数组写进云端 → refresh 随后读回 []（非 undefined）
   * 当成"用户选择不装" → 所有插件显示未装，且空名单已落盘，反复刷新也回不来。
   * 现在：没就绪就只触发一次 refresh，等它就绪后再对齐。
   *
   * 另一条实测修正（装云端连接时）：新后端里那份**可能是我们自己刚写的**（见 intentWrittenAt）。
   * 那种情况不能回灌 —— 否则刚装上的插件会被旧名单立刻卸掉（点了安装没反应）。
   */
  async function reloadFromBackend(): Promise<void> {
    if (!state.ready) {
      await refresh()
      if (!state.ready) return // 拉清单失败：宁可不动，也不要用不确定的名单覆盖后端
    }
    // 本服务在这次切换之前刚写过名单 → 新后端里承载的就是我们那份，不必（也不能）回灌。
    // 只在"从没写过"（真正换台机器 / 首次上云）时才以新后端为准。
    if (intentWrittenAt > 0) return
    // 这里必须**直接问当前后端**，不能走 readSavedIntent：那样本地备份会把"后端还是空的"
    // 这件事盖住，导致首次上云永远不把名单推上去（换台机器就又没有安装记录了）。
    let saved: string[] | undefined
    try {
      const current = await save()?.get<string[]>(INSTALLED_KEY, 'config')
      if (Array.isArray(current) && current.every((x) => typeof x === 'string')) saved = current
    } catch (err) {
      console.warn('[plugin-manager] 切换后端后读取安装名单失败，本次不对齐', err)
      return
    }
    if (saved === undefined) {
      // 全新后端：把本地备份（没有就用当前意图）搬过去，别让后端的空抹掉已装插件。
      const seed = readLocalBackup() ?? [...state.intent]
      state.intent = [...seed]
      save()?.set(INSTALLED_KEY, [...seed], 'config')
      writeLocalBackup(seed)
      return
    }
    state.intent = [...saved]
    await applyIntent(saved)
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
      // 是否已装只看**内核里有没有这个唯一名字**，与谁装的无关：
      // 调试插件先装过同一个名字时，这里也必须显示「已安装」，否则再点安装就会重复装载。
      // （真正的去重由内核按名字保证；这里只是让界面不撒谎。）
      row.installed = !!info
      // 绑定前失败留下的「宿主没有提供 manager」已不成立：插件此刻确实在内核里。
      // 不清掉的话，页面会一直挂着一条假红字，看起来像装失败了。
      if (info && row.error?.includes('宿主没有提供')) row.error = undefined
    }
  }

  /** 把「意图（想装哪些）」存盘，供下次启动照旧 */
  /**
   * 从**服务端真实状态**回填每一行的"后台半"状态（serverInstalled / serverError）。
   *
   * 为什么必须有它：serverInstalled 只是"本次会话点过安装"的记忆 —— 刷新页面就丢，
   * 于是"后台其实装着、界面却显示未装/失败"（用户实测）。真相在服务端的
   * /api/server-plugins（它按目录实况列出）+ /api/npm-plugins/installed（NPM 来源版本）。
   * 这里拉一次、按 id 对齐，把真相写回行上。
   */
  async function syncServerState(): Promise<void> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const installedIds = new Set<string>()
    const loadedNames = new Set<string>()
    // 目录实况：任何来源装的后台半都在这里（含手工丢文件、NPM 装、启动装载）
    try {
      const res = await doFetch(origin + "/api/server-plugins", { headers: { accept: "application/json" } })
      if (res.ok) {
        const j = (await res.json()) as { plugins?: Array<{ id?: string }>; loaded?: string[] }
        for (const p of j.plugins ?? []) if (p.id) installedIds.add(p.id)
        // loaded = 本次启动已登记进内核的（能证明"真的活着"，不只是文件在）
        for (const n of j.loaded ?? []) loadedNames.add(n)
      }
      // 另一个可能的落点：前端半目录名（服务端 pluginsDir）—— 有些部署后台半与前端半同 id
    } catch { /* 服务端不可达：保持现状，不误报 */ }

    for (const row of state.rows) {
      if (!row.hasServer) continue
      // 服务端目录里的 id 与清单 id 一致（都是文件名形如 imohuan__plugin-showcase）
      const onServer = installedIds.has(row.entry.id) || (row.realName ? installedIds.has(row.realName) : false)
      row.serverInstalled = onServer
      // 已登记进内核 = 正在生效。
      // ⚠️ loaded 为空数组**不等于**"都生效"——它只说明服务端没报出任何已登记项
      // （旧版本服务 / 接口尚未支持 loaded）。这种情况判"未生效"是保守的正确解：
      // 宁可少显示一个绿灯，也不能对每个后台行都误报"已生效"（审查指出）。
      row.serverLoaded = onServer && loadedNames.has(row.realName ?? row.entry.name)
      // 装着就清掉陈旧的"失败"红字（它可能来自上一次未确认的静默请求）
      if (onServer) row.serverError = undefined
    }
  }
  function persistIntent(): void {
    save()?.set(INSTALLED_KEY, [...state.intent], 'config')
    // 同时留一份本地备份：即使 config 已切到云端，刷新时也能先把插件装回来
    writeLocalBackup(state.intent)
    intentWrittenAt = Date.now()
  }

  /**
   * 本服务最近一次**写**安装名单的时刻。
   *
   * 为什么需要它（实测踩到的死循环）：点「安装云端连接」时，那个插件会把 config 域后端切到
   * 云端；切完触发 reloadFromBackend → 用**云端里那份旧名单**回灌，而旧名单当然不含刚装的
   * 云端连接自己 → 刚装上的插件又被卸掉，看起来就是"点了安装没反应、装了立刻消失"。
   *
   * 判据：切换后若**已经**有「用户/服务刚写的名单」（intentWrittenAt 晚于这次订阅建立），
   * 说明后端里那份是我们自己的写入被承载过去的结果，不必回灌——回灌反而会把刚装上的抹掉。
   * 反之（真正换台机器 / 首次上云）没写过，就照旧以新后端为准。
   */
  let intentWrittenAt = 0

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
          serverLoaded: false,
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
    // 没有用户显式确认**不要**发请求：后台插件是以服务端权限运行的代码，
    // confirm 缺省 false 会被后端 400 拒（"需要 confirm: true"）。把 400 当失败报红是**假故障**
    // （用户实测：后台其实已装好、接口能访问，界面却显示"后台失败"）。
    // 正确做法：静默留在"未装"，等用户在界面上点安装（那时才有确认）。
    if (row.serverConfirm !== true) return
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
        headers: withAdminToken({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          id: row.entry.id,
          code,
          // 清单声明的哈希（服务端会拿它跟自己扫出来的对；对不上就拒）
          sha256: server.sha256,
          // 用户已在界面上显式确认"以服务端权限运行"（由 install() 的 opts.confirm 传来）
          confirm: true,
          origin,
        }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok !== true) throw new Error(readableServerError(j.error ?? '后台安装失败：' + r.status, r.status))
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
        headers: withAdminToken({ 'content-type': 'application/json' }),
        body: JSON.stringify({ id: row.entry.id }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (!r.ok || j.ok !== true) throw new Error(readableServerError(j.error ?? '后台卸载失败：' + r.status, r.status))
      row.serverInstalled = false
    } catch (err) {
      row.serverError = err instanceof Error ? err.message : String(err)
    }
  }

  /**
   * 装一个插件的前端半。
   *
   * @param opts.skipServerHalf 只装前端半、不碰后台半 —— 给"后台半已由别处装好"的调用方用
   *   （从 NPM 安装走的是 /api/npm-plugins/install，它**已经**装了后台半；若这里再调
   *   /api/server-plugins/install 会重复写入/重复热装，与卸载那个 404 同型的重复调用）。
   */
  async function install(id: string, opts?: { serverConfirm?: boolean; skipServerHalf?: boolean }): Promise<void> {
    const row = state.rows.find((r) => r.entry.id === id)
    if (!row) return
    if (row.entry.builtin === true) return // 自带插件不可装卸（页面上也不给按钮，这里是兜底）
    // 同名只该有一份：内核里已经有这个唯一名字（可能是调试入口装的），就不再装第二遍。
    // 判据现查内核，不看安装记录 —— 两个插件各自独立，谁也不读谁的本子。
    if (hostManager()?.list().some((p) => p.name === row.entry.name)) {
      row.installed = true
      row.realName = row.entry.name
      return
    }
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
      if (!m) throw new Error('宿主没有提供 host.manager（插件管理需要一个能装插件的宿主）')
      if (!doc || typeof doc.createElement !== 'function') throw new Error('当前环境没有 document，无法用 <script> 加载插件')
      row.realName = await installEntryModule(row, { document: doc, win }, { bust: false, manager: m })
      row.installed = true
      // 前端装上了 → 顺带装后台那一半（成对安装；后台失败不影响前端已装成的事实）
      // 除非调用方说明后台半已由别处处理（NPM 安装那条路）。
      if (!opts?.skipServerHalf) await installServerHalf(row)
      setIntent(row.entry.id, true)
      syncRuntimeState()
      persistIntent()
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err)
    } finally {
      row.busy = false
    }
  }

  /**
   * 卸一个插件。
   *
   * @param opts.skipServerHalf 只卸前端半、不碰后台半 —— 给"后台半已由别处删掉"的调用方用
   *   （NPM 卸载走的是 /api/npm-plugins/uninstall，它**已经**删了后台文件；若这里再调
   *   /api/server-plugins/uninstall 会因为文件已不在而 404，用户实测到多余的那个 404）。
   */
  async function uninstall(id: string, opts?: { skipServerHalf?: boolean }): Promise<void> {
    const row = state.rows.find((r) => r.entry.id === id)
    if (!row) return
    if (row.entry.builtin === true) return // 自带插件不可卸（页面上不给按钮，这里兜底）
    if (!hostManager()) {
      row.error = '宿主没有提供 manager'
      return
    }
    row.busy = true
    row.error = undefined
    try {
      if (!tryUninstall(row)) throw new Error(`没能卸载（可能不是本插件管理的插件，或该插件不允许卸载）：${row.entry.id}`)
      row.installed = false
      row.state = undefined
      // 后台半：只有"还没被别处处理过"时才由这里卸载（NPM 卸载已删过 → 跳过，避免 404 噪音）
      if (!opts?.skipServerHalf) {
        // 前端卸了 → 顺带卸后台那一半（成对；后台失败只记 serverError，不影响前端已卸成）
        await uninstallServerHalf(row)
      }
      setIntent(row.entry.id, false)
      syncRuntimeState()
      persistIntent()
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err)
    } finally {
      row.busy = false
    }
  }

  async function reinstall(id: string, opts?: { serverConfirm?: boolean }): Promise<void> {
    const row = state.rows.find((r) => r.entry.id === id)
    if (!row) return
    if (row.entry.builtin === true) return // 自带插件不可重装（页面上不给按钮，这里兜底）
    // 用户在界面上点了重装 = 已确认"以服务端权限重写后台代码"（与 install 同一语义）
    if (opts?.serverConfirm === true) row.serverConfirm = true
    const m = hostManager()
    if (!m) {
      row.error = '宿主没有提供 manager'
      return
    }
    row.busy = true
    row.error = undefined
    try {
      // 先卸（若在装；尽力而为，本来就没装也不影响）；再用带时间戳的地址重拉（破浏览器缓存 → 拿到改过的产物）
      tryUninstall(row)
      row.realName = await installEntryModule(row, { document: doc, win }, { bust: true, manager: m })
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
      const saved = await readSavedIntent()
      const desired = resolveDesiredIds(entries, saved)
      state.intent = [...desired]

      // 复核行（**原地**对齐，不整批换新对象）——这样即便本函数与另一趟 refresh 交叠，
      // 两边操作的也是同一批 row 对象，不会有「孤儿行」（真实踩过：三插件只装上两个）。
      reconcileRows(entries)
      syncRuntimeState()
      // 后台半的真相在服务端（刷新页面后 serverInstalled 记忆会丢，必须回填）
      await syncServerState()
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
  /** 浏览：服务端按前缀列出全部可安装插件（列表页默认加载用） */
  async function browseNpmPlugins(): Promise<NpmSearchResult[]> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/browse', { headers: { accept: 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; results?: NpmSearchResult[]; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(json.error ?? '浏览失败：' + res.status)
    return json.results ?? []
  }


  /** 装一个 NPM 包（含后台半时调用方必须已确认；confirm 直传后端） */
  async function installFromNpm(pkg: string, opts?: { serverConfirm?: boolean }): Promise<void> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/install', {
      method: 'POST',
      headers: withAdminToken({ 'content-type': 'application/json' }),
      body: JSON.stringify({ package: pkg, confirm: opts?.serverConfirm === true }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(readableServerError(json.error ?? 'NPM 安装失败：' + res.status, res.status))
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
    // 后台半已在 /api/npm-plugins/install 里装好了 → 这里只装前端半，别再发一次后台安装请求
    await install(row.entry.id, { serverConfirm: true, skipServerHalf: true })
  }

  async function updateFromNpm(pkg: string): Promise<{ updated: boolean; to?: string }> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/update', {
      method: 'POST',
      headers: withAdminToken({ 'content-type': 'application/json' }),
      body: JSON.stringify({ package: pkg, confirm: true }),
    })
    const json = (await res.json()) as { ok?: boolean; updated?: boolean; to?: string; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(readableServerError(json.error ?? 'NPM 更新失败：' + res.status, res.status))
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
      headers: withAdminToken({ 'content-type': 'application/json' }),
      body: JSON.stringify({ package: pkg }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || json.ok !== true) throw new Error(readableServerError(json.error ?? 'NPM 卸载失败：' + res.status, res.status))
    // 卸载前先把内核里的**前端半**摘掉 —— 后端只删磁盘文件，不会动浏览器里已装载的插件
    // （实测踩过：文件删了但面板还活着）。用卸前的 rows 找它的 id（refresh 后行就没了）。
    const wantId = pkg.replace(/^@/, '').replace('/', '__')
    const wasInstalled = state.rows.find((r) => r.entry.id === wantId)?.installed === true
    // 后台半已在上面那个请求里删掉了 → 这里只摘前端半，别再调 /api/server-plugins/uninstall
    // （否则文件已不在，会多出一个 404）。
    if (wasInstalled) await uninstall(wantId, { skipServerHalf: true })
    await refresh()
  }

  /** 已从 NPM 装的包（含版本与是否有更新） */
  async function listNpmInstalled(): Promise<NpmInstalledEntry[]> {
    const origin = baseOfCatalogUrl(state.catalogUrl)
    const res = await doFetch(origin + '/api/npm-plugins/installed', { headers: { accept: 'application/json' } })
    const json = (await res.json()) as { ok?: boolean; plugins?: NpmInstalledEntry[] }
    return json.plugins ?? []
  }

  /**
   * 检查已装的 NPM 插件哪些有新版。
   *
   * 做法：已装清单（本地版本）+ browse（每个包的最新版）逐一比对。
   * browse 查不到某个包（下架/网络问题）就跳过它 —— 宁可少报"有更新"，也不误报。
   */
  async function checkNpmUpdates(): Promise<Record<string, string>> {
    const [installed, market] = await Promise.all([listNpmInstalled(), browseNpmPlugins()])
    const latestOf = new Map(market.map((m) => [m.pkg, m.version]))
    const out: Record<string, string> = {}
    for (const e of installed) {
      const latest = latestOf.get(e.pkg)
      if (latest && latest !== e.version) out[e.pkg] = latest
    }
    return out
  }

  return {
    state, refresh, bindManager, install, uninstall, reinstall, installAll,
    searchNpmPlugins, browseNpmPlugins, installFromNpm, updateFromNpm, uninstallFromNpm, listNpmInstalled, checkNpmUpdates,
  }
}

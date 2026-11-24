/**
 * PluginManagerPage 的状态与动作。
 *
 * 页面只负责把这里返回的状态交给工具栏、页签正文和卡片网格；
 * 清单、NPM 市场、安装/更新/卸载仍按原来的顺序执行。
 */
import { computed, onMounted, ref } from 'vue'
import { useCanvasContextOrRender } from '@plume-canvas/canvas-render'
import type { FeedbackService } from '@plume-canvas/canvas-render'
import type { NotifyContract } from '@plume-canvas/plugin-sdk'
import { usePluginManager } from '../../../usePluginManager'
import type { PluginRow } from '../../../pluginManagerService'
import type {
  PluginCardAction,
  PluginCardTone,
  PluginManagerCardView,
  PluginServerTone,
} from '../pluginCardTypes'

type Row = PluginRow
export type TabId = 'market' | 'installed' | 'local'

/**
 * 当前是否在画布会话内。
 *
 * doc / selection / view 这些服务由画布会话装卸（项目页没有）；本地清单插件声明了
 * 这些依赖时，项目页上会停在 PENDING —— 那是准确的运行时状态，但"缺少依赖"会误导
 * 用户以为包坏了（用户 2026-11-21 反馈）。在画布外统一说成"待进入画布"。
 */
function inCanvasSession(): boolean {
  try {
    // PlumeUI 是画布宿主 exposeToWindow 挂的全局（App.vue windowKey）；
    // 项目页没有会话 → 不存在。这是插件包内能拿到的最直接判据。
    return Boolean((globalThis as { PlumeUI?: unknown }).PlumeUI)
  } catch {
    return false
  }
}

export function usePluginManagerPage() {
  const svc = usePluginManager()
  const s = svc.state
  /** 统一确认框：卸载 / 含后台安装都走它，不用浏览器原生 confirm。 */
  const feedback = useCanvasContextOrRender().ctx.get<FeedbackService>('feedback')
  /** 全局 toast：装/卸/更新的结果提示（右下角 vue-sonner）。 */
  const notify = useCanvasContextOrRender().ctx.tryGet<NotifyContract>('notify')

  function onRefresh(): void {
    // 刷新 = 重拉清单 + 清市场缓存（否则用户以为刷新了市场列表其实没刷，2026-11-22 复核）
    clearMarketCache()
    void svc.refresh()
    void loadMarket(true)
  }

  /** 带后台的插件必须先确认：后台代码以服务端权限运行。 */
  async function onInstall(row: Row): Promise<void> {
    const hasServer = row.entry.server !== undefined
    if (hasServer) {
      const ok = await feedback?.confirm({
        title: '安装「' + (row.entry.title || row.entry.id) + '」',
        description:
          '这个插件包含后台部分。后台插件会以服务端权限在本机运行（可读写文件、发起网络请求）。\n\n' +
          '只在你信任这个插件来源时才继续。',
        confirmText: '安装',
        cancelText: '取消',
      })
      if (!ok) return
    }
    void svc.install(row.entry.id, { serverConfirm: hasServer })
  }

  async function onReinstall(row: Row): Promise<void> {
    const hasServer = row.entry.server !== undefined
    if (hasServer) {
      const ok = await feedback?.confirm({
        title: '重装「' + (row.entry.title || row.entry.id) + '」',
        description:
          '这个插件包含后台部分。重装会把后台代码重新写入本机并以服务端权限运行。',
        confirmText: '重装',
        cancelText: '取消',
      })
      if (!ok) return
    }
    void svc.reinstall(row.entry.id, { serverConfirm: hasServer })
  }

  const installedCount = computed(() => s.rows.filter((row) => row.installed).length)
  const builtinRows = computed(() => s.rows.filter((row) => row.entry.builtin === true))
  const installableRows = computed(() => s.rows.filter((row) => row.entry.builtin !== true))

/** 每个包的最新版本（来自 /api/updates 报告，pkg → latest）。builtin 卡的「已更新」标示也用它。 */
const npmUpdates = ref<Record<string, string>>({})
/** 本会话里刚更新成功的自带插件（pkg → 版本）：更新完成后徽章显示「已更新」。
 *  刷新页面后消失（报告里它也不再是"有更新"，回落「自带」即可，不持久化）。 */
const justUpdatedVersion = ref(new Map<string, string>())
const justUpdated = computed(() => new Set(justUpdatedVersion.value.keys()))

  function badgeOf(row: Row): { text: string; tone: PluginCardTone } {
    if (row.entry.builtin === true) {
      const pkg = '@plume-canvas/' + row.entry.id
      if (justUpdated.value.has(pkg)) return { text: '已更新', tone: 'on' }
      if (builtinUpdateOf(row)) return { text: '可更新', tone: 'warn' }
      return { text: '自带', tone: 'builtin' }
    }
    if (!row.installed) return { text: '未安装', tone: 'off' }
    if (row.state === 'pending') return { text: '待依赖', tone: 'warn' }
    if (row.state === 'failed') return { text: '装载失败', tone: 'err' }
    return { text: '已安装', tone: 'on' }
  }

  function serverBadgeOf(row: Row): { text: string; tone: PluginServerTone } {
    if (row.serverInstalled) {
      return row.serverLoaded
        ? { text: '后台已生效', tone: 'on' }
        : { text: '后台已装', tone: 'on' }
    }
    if (row.serverError) return { text: '后台失败', tone: 'err' }
    return { text: '后台未装', tone: 'off' }
  }

  function versionMetaOf(row: Row): string {
    const parts = [row.entry.version ? 'v' + row.entry.version : row.entry.id]
    if (row.hasServer) parts.push('含后台')
    return parts.join(' · ')
  }

  /** 自带卡片的版本行：当前版本 → 最新版本（有更新才带箭头；用户口径 2026-11-23） */
  function builtinVersionMetaOf(row: Row): string {
    const current = row.entry.version ? 'v' + row.entry.version : row.entry.id
    const update = builtinUpdateOf(row)
    const parts = [update ? current + ' → v' + update : current]
    if (row.hasServer) parts.push('含后台')
    return parts.join(' · ')
  }

  function cardStatusOf(row: Row): string {
    if (row.busy) return row.installed ? '处理中' : '安装中'
    return badgeOf(row).text
  }

  /** 自带插件是否有可用更新（pkg 名对应 npm 包名） */
  function builtinUpdateOf(row: Row): string | undefined {
    if (row.entry.builtin !== true) return undefined
    // 报告键是 npm 包名(@plume-canvas/<目录名>);entry.name 是画布里的插件名(如 agent),
    // 两者都对一遍 —— 更新报告用的是包名,而清单用的是 pluginName。
    const latest =
      npmUpdates.value['@plume-canvas/' + row.entry.id] ?? npmUpdates.value[row.entry.name]
    if (!latest) return undefined
    // 报告是 30 分钟快照，可能落后于真实状态（用户实测 2026-11-23）。
    // 这里用「当前实际在跑的版本」(row.entry.version) 判断，不读 npmInstalled —— 后者可能来自
    // 30 分钟的市场缓存，缓存里的旧版本会把「可更新」判掉（用户实测踩过）。
    if (row.entry.version && row.entry.version >= latest) return undefined
    return latest
  }

  /**
   * 本地清单卡片。
   * 未安装时整卡可点安装；已安装后整卡不响应点击，避免误触重装。
   */
  const localCards = computed<PluginManagerCardView[]>(() =>
    installableRows.value.map((row) => {
      const badge = badgeOf(row)
      const actions: PluginCardAction[] = []
      if (!row.installed) {
        actions.push({
          key: 'install:' + row.entry.id,
          label: '安装',
          variant: 'default',
          disabled: row.busy,
        })
      } else {
        actions.push({
          key: 'uninstall:' + row.entry.id,
          label: '卸载',
          variant: 'destructive',
          disabled: row.busy,
        })
        actions.push({
          key: 'reinstall:' + row.entry.id,
          label: '重装',
          variant: 'outline',
          disabled: row.busy,
          title: '卸载后按最新产物重新安装',
        })
      }

      return {
        id: row.entry.id,
        title: row.entry.title || row.entry.id,
        description: row.entry.description || '这个插件没有写说明。',
        meta: versionMetaOf(row),
        status: cardStatusOf(row),
        tone: row.busy ? 'warn' : badge.tone,
        busy: row.busy,
        server: row.hasServer ? serverBadgeOf(row) : undefined,
        error: row.error || row.serverError,
        warning: row.missingDeps?.length
          ? inCanvasSession()
            ? '缺少依赖：' + row.missingDeps.join('、')
            : '画布服务依赖（' + row.missingDeps.join('、') + '）：进入画布后自动激活'
          : undefined,
        actions,
      }
    }),
  )

  /** 自带卡片：只读，不提供装卸按钮。 */
  const builtinCards = computed<PluginManagerCardView[]>(() =>
    builtinRows.value.map((row) => ({
      id: row.entry.id,
      title: row.entry.title || row.entry.id,
      description: row.entry.description || '随应用启动的插件。',
      versionDiff: builtinUpdateOf(row) && row.entry.version
        ? { from: 'v' + row.entry.version, to: 'v' + builtinUpdateOf(row)! }
        : undefined,
      meta: builtinVersionMetaOf(row),
      status: cardStatusOf(row),
      tone: row.busy ? 'warn' : badgeOf(row).tone,
      busy: row.busy,
      builtin: true,
      server: row.hasServer ? serverBadgeOf(row) : undefined,
      error: row.serverError,
      // 有更新时给一个「更新」动作（走 /api/npm-plugins/update，与 NPM 卡同款）。
      // 卸载按钮始终不给（自带件不能卸）；点卡片即进详情，不放详情按钮。
      actions: builtinUpdateOf(row)
        ? [
            {
              // key 用 npm 包名(@plume-canvas/<目录名>) —— /api/npm-plugins/update 按包名查来源记录;
              // entry.name 是画布插件名(如 bottom-bar),不是包名(实测 404「无来源记录」)。
              key: 'npm-update:@plume-canvas/' + row.entry.id,
              label: '更新',
              variant: 'default',
              disabled: row.busy,
            },
          ]
        : [],
      footerNote: justUpdated.value.has('@plume-canvas/' + row.entry.id)
        ? '已更新到 v' + (justUpdatedVersion.value.get('@plume-canvas/' + row.entry.id) ?? '')
        : '随应用启动，不能卸载',
    })),
  )

  // ============================================================================
  // NPM 市场
  // ============================================================================
  const npmQuery = ref('')
  const npmSearching = ref(false)
  const npmError = ref('')
  const npmInstalled = ref<Awaited<ReturnType<typeof svc.listNpmInstalled>>>([])
  /** 并发更新的 busy 集合：每个包各自显示自己的加载态(用户实测:同时更新两个只显示后点的) */
  /** pkg → 正在进行的动作 key（npm-install:/npm-update:/npm-uninstall: + pkg）：卡片据此把对应按钮变加载态 */
  const npmBusyPkgs = ref(new Map<string, string>())
  /** 报告里标记 builtin 的包（有更新的那些） */
  const reportBuiltinPkgs = ref(new Set<string>())
  /** 自带插件集合（builtin 清单 + 报告标记）：即使从 NPM 装的也不给卸载按钮（用户口径 2026-11-23） */
  const builtinNpmPkgs = computed(() => {
    const set = new Set(reportBuiltinPkgs.value)
    for (const row of s.rows) {
      if (row.entry.builtin === true) set.add('@plume-canvas/' + row.entry.id)
    }
    return set
  })
  function logError(pkg: string, err: unknown): void {
    // 失败走全局 notify 弹窗即可（用户口径 2026-11-24：不要页内错误块/面板）
    const message = err instanceof Error ? err.message : String(err)
    notify?.error('「' + pkg + '」' + message)
  }
  /** 「日志」视图开关（用户口径 2026-11-24）：打开后主区切换为插件加载日志 */
  const showLogView = ref(false)
  /** 插件加载日志：清单里加载失败的插件（含失败原因） */
  const loadLog = computed(() =>
    s.rows
      .filter((row) => row.error)
      .map((row) => ({
        pkg: row.entry.title || row.entry.id,
        message: row.error ?? '',
        version: row.entry.version || '',
      })),
  )
  /** 页签 = 每个启用源 × (市场/已装/本地)（用户口径 2026-11-24：源与段同级，切页签即切源请求） */
  interface PluginTab { id: string; label: string; sourceId: string; section: TabId }
  const pluginTabs = computed<PluginTab[]>(() => {
    const enabled = s.sources.filter((s) => s.enabled)
    const out: PluginTab[] = [
      { id: 'local:market', label: '市场', sourceId: 'local', section: 'market' },
      { id: 'local:installed', label: '已装', sourceId: 'local', section: 'installed' },
    ]
    // 第三方源：每个源一个页签，点进去展示该源的市场列表（用户口径 2026-11-24）
    for (const src of enabled) {
      if (src.id === 'local') continue
      out.push({ id: src.id + ':market', label: src.name, sourceId: src.id, section: 'market' })
    }
    return out
  })
  /** 当前选中的复合页签（默认第一个） */
  const activeTabId = ref(pluginTabs.value[0]?.id ?? '')
  function selectTab(id: string): void {
    const tab = pluginTabs.value.find((t) => t.id === id)
    if (!tab) return
    activeTabId.value = id
    if (tab.sourceId !== s.activeSourceId) {
      svc.setActiveSource(tab.sourceId)
      clearMarketCache()
      void svc.refresh()
      void loadMarket(true)
    }
  }
  /** 当前页签对应的段（渲染面板用） */
  const activeSection = computed<TabId>(() => {
    const tab = pluginTabs.value.find((t) => t.id === activeTabId.value)
    return (tab?.section ?? 'market') as TabId
  })
  function tabCount(id: string): number {
    const tab = pluginTabs.value.find((t) => t.id === id)
    if (!tab) return 0
    if (tab.sourceId !== s.activeSourceId) return -1
    if (tab.section === 'market') return marketCards.value.length
    if (tab.section === 'installed') return visibleInstalledCards.value.length
    return visibleLocalCards.value.length
  }

  const marketList = ref<Awaited<ReturnType<typeof svc.searchNpmPlugins>>>([])
  /** 卡片区的即时筛选，不改服务端搜索词。 */
  const cardFilter = ref('')

  const filteredMarket = computed(() => {
    const q = cardFilter.value.trim().toLowerCase()
    if (!q) return marketList.value
    return marketList.value.filter(
      (item) =>
        item.pkg.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    )
  })

  const npmVersionOf = (pkg: string): string | undefined =>
    npmInstalled.value.find((entry) => entry.pkg === pkg)?.version

  const marketCards = computed<PluginManagerCardView[]>(() =>
    filteredMarket.value.map((item) => {
      // 本地脚本被删（清单行报「加载脚本失败」）时按未安装处理 → 出现安装按钮（用户口径 2026-11-23）
      const recordVersion = npmVersionOf(item.pkg)
      const id = item.pkg.replace(/^@[^/]+\//, '')
      const brokenRow = s.rows.find((row) => row.entry.id === id && /脚本失败|加载失败/.test(row.error || ''))
      const installedVersion = brokenRow ? undefined : recordVersion
      const busyAction = npmBusyPkgs.value.get(item.pkg)
      const busy = busyAction !== undefined
      const update = npmUpdates.value[item.pkg]
      const actions: PluginCardAction[] = []
      if (!installedVersion) {
        actions.push({
          key: 'npm-install:' + item.pkg,
          label: '安装',
          variant: 'default',
          disabled: busy,
        })
      } else if (update && installedVersion !== update) {
        // 只有检测到新版本才出现「更新」；更新按钮同时承担版本号提示（用户 2026-11-21）
        actions.push({
          key: 'npm-update:' + item.pkg,
          label: '更新',
          variant: 'default',
          disabled: busy,
        })
        // 自带插件不给卸载按钮（卸了也会被 bootstrap 重装，且用户口径明确禁止）
        if (!builtinNpmPkgs.value.has(item.pkg)) {
          actions.push({
            key: 'npm-uninstall:' + item.pkg,
            label: '卸载',
            variant: 'destructive',
            disabled: busy,
          })
        }
      } else if (!builtinNpmPkgs.value.has(item.pkg)) {
        actions.push({
          key: 'npm-uninstall:' + item.pkg,
          label: '卸载',
          variant: 'destructive',
          disabled: busy,
        })
      }

      // 版本行：显示当前安装的版本；有更新时递进显示 当前 → 最新（用户口径 2026-11-23）。
      // 未安装时显示市场最新版。
      const meta = [installedVersion
        ? (update && installedVersion !== update ? 'v' + installedVersion + ' → v' + update : 'v' + installedVersion)
        : 'v' + item.version]
      if (item.hasServer) meta.push('含后台')

      return {
        id: item.pkg,
        title: item.title,
        description: item.description || '这个插件没有写说明。',
        versionDiff: installedVersion && update && installedVersion !== update
          ? { from: 'v' + installedVersion, to: 'v' + update }
          : undefined,
        meta: meta.join(' · '),
        status: busy ? '处理中' : installedVersion ? '已安装' : '未安装',
        busyAction: busy ? busyAction : undefined,
        tone: busy ? 'warn' : installedVersion ? 'on' : 'off',
        busy,
        actions,
        footerNote: undefined,
      }
    }),
  )

  const installedNpmCards = computed<PluginManagerCardView[]>(() =>
    npmInstalled.value.map((entry) => {
      const hit = marketList.value.find((item) => item.pkg === entry.pkg)
      const busyAction = npmBusyPkgs.value.get(entry.pkg)
      const busy = busyAction !== undefined
      const update = npmUpdates.value[entry.pkg]
      const actions: PluginCardAction[] = []
      // 自带插件不给卸载按钮（用户口径 2026-11-23）
      if (!builtinNpmPkgs.value.has(entry.pkg)) {
        actions.push({
          key: 'npm-uninstall:' + entry.pkg,
          label: '卸载',
          variant: 'destructive',
          disabled: busy,
        })
      }
      if (update) {
        actions.unshift({
          key: 'npm-update:' + entry.pkg,
          label: '更新',
          variant: 'default',
          disabled: busy,
        })
      }
      return {
        id: entry.pkg,
        title: hit?.title || entry.pkg,
        busyAction: busy ? busyAction : undefined,
        description: hit?.description || '已从 NPM 安装的插件。',
        versionDiff: update && entry.version !== update
          ? { from: 'v' + entry.version, to: 'v' + update }
          : undefined,
        meta: 'v' + entry.version + ' · ' + entry.pkg,
        status: busy ? '处理中' : '已安装',
        tone: busy ? 'warn' : 'on',
        busy,
        actions,
        footerNote: undefined,
      }
    }),
  )

  /** 卡片筛选：标题、说明、版本/包名、状态都能命中。 */
  function filterCards(cards: PluginManagerCardView[]): PluginManagerCardView[] {
    const q = cardFilter.value.trim().toLowerCase()
    if (!q) return cards
    return cards.filter((card) =>
      [card.title, card.description, card.meta, card.status]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    )
  }

  // 已装 tab = NPM 已装 + 本地清单 + 自带（非 NPM 形态的内置件），统一一个列表（用户口径 2026-11-23）
  // 三个页签（用户口径 2026-11-24）：市场 = NPM 可装；已装 = 从 NPM 装的；
  // 本地 = 服务端/本地 dev 检测到但**不在 NPM 安装记录里**的插件（dev 调试件等）。
  // 归一化身份：NPM 记录 id 带.scope/，清单行 id 带 plume-canvas__ 目录前缀，本地行不带。
  const norm = (id: string): string =>
    id.replace(/^@[^/]+\//, '').replace(/^plume-canvas__/, '')
  const visibleInstalledCards = computed(() => filterCards(installedNpmCards.value))
  const visibleLocalCards = computed(() => {
    const npmIds = new Set(installedNpmCards.value.map((c) => norm(c.id)))
    const seen = new Set<string>()
    const extras = [...localCards.value, ...builtinCards.value].filter((c) => {
      const key = norm(c.id)
      if (npmIds.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    return filterCards(extras)
  })

  // ==========================================================================
  // 市场缓存（用户口径 2026-11-22）：进 tab 用缓存（30 分钟过期），只有真正
  // 点「搜索」才走真实请求。localStorage 不可用时静默降级为不缓存。
  // ==========================================================================
  const MARKET_CACHE_KEY = 'plugin-manager:market-cache'
  const MARKET_CACHE_TTL_MS = 30 * 60 * 1000

  function cacheStorage(): Storage | undefined {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
      return undefined
    }
  }

  interface MarketCache {
    marketList: Awaited<ReturnType<typeof svc.browseNpmPlugins>>
    savedAt: number
  }

  function readMarketCache(): MarketCache | undefined {
    const storage = cacheStorage()
    if (!storage) return undefined
    try {
      const raw = storage.getItem(MARKET_CACHE_KEY)
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as MarketCache
      if (!Array.isArray(parsed.marketList)) return undefined
      if (typeof parsed.savedAt !== 'number') return undefined
      if (Date.now() - parsed.savedAt > MARKET_CACHE_TTL_MS) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  function writeMarketCache(data: Omit<MarketCache, 'savedAt'>): void {
    const storage = cacheStorage()
    if (!storage) return
    try {
      storage.setItem(MARKET_CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
    } catch {
      /* 配额满/隐私模式：缓存失败不影响主流程 */
    }
  }

  function clearMarketCache(): void {
    try {
      cacheStorage()?.removeItem(MARKET_CACHE_KEY)
    } catch {
      /* 忽略 */
    }
  }

  async function fetchMarket(): Promise<void> {
    npmSearching.value = true
    npmError.value = ''
    try {
      marketList.value = await svc.browseNpmPlugins()
      npmInstalled.value = await svc.listNpmInstalled()
      // 优先用服务端缓存的更新报告（启动/定时已算好，快）；没有再走 browse 全量比对
      const report = await svc.fetchUpdateReport()
      npmUpdates.value = report ?? await svc.checkNpmUpdates()
      void svc.fetchBuiltinPkgs().then((set) => { reportBuiltinPkgs.value = set })
      writeMarketCache({
        marketList: marketList.value,
      })
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
      logError('插件源「' + (s.sources.find((x) => x.id === s.activeSourceId)?.name || s.activeSourceId) + '」加载', err)
    } finally {
      npmSearching.value = false
    }
  }

  /** 进 tab / 刷新按钮走这里：有新鲜缓存直接用，过期才发请求。force = 无视缓存。 */
  async function loadMarket(force = false): Promise<void> {
    // 已装清单与更新表**永远实时取**：它们是本地/服务端缓存接口，很便宜；
    // 而装/卸/更新之后旧缓存会让「可更新」判断和加载态全部失真（用户实测 2026-11-23）。
    const liveRefresh = async (): Promise<void> => {
      try {
        npmInstalled.value = await svc.listNpmInstalled()
        const report = await svc.fetchUpdateReport()
        npmUpdates.value = report ?? await svc.checkNpmUpdates()
        void svc.fetchBuiltinPkgs().then((set) => { reportBuiltinPkgs.value = set })
      } catch (err) {
        // 失败保留旧值；但要让用户知道（notify + 日志，用户口径 2026-11-24）
        logError('插件源「' + (s.sources.find((x) => x.id === s.activeSourceId)?.name || s.activeSourceId) + '」数据刷新', err)
      }
    }
    if (!force) {
      const cached = readMarketCache()
      if (cached) {
        marketList.value = cached.marketList
        await liveRefresh()
        return
      }
    }
    await fetchMarket()
  }

  async function onNpmSearch(): Promise<void> {
    const q = npmQuery.value.trim()
    if (!q) {
      await loadMarket(true)
      return
    }
    npmSearching.value = true
    npmError.value = ''
    try {
      marketList.value = await svc.searchNpmPlugins(q)
      npmInstalled.value = await svc.listNpmInstalled()
      // 搜索结果也进缓存：下次进 tab 直接用（30 分钟内足够新鲜；更新表沿用当前值）
      writeMarketCache({
        marketList: marketList.value,
      })
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
    } finally {
      npmSearching.value = false
    }
  }

  async function onNpmInstall(pkg: string, hasServer: boolean): Promise<void> {
    if (hasServer) {
      const ok = await feedback?.confirm({
        title: '从 NPM 安装「' + pkg + '」',
        description:
          '这个包包含后台部分。后台插件会以服务端权限在本机运行（可读写文件、发起网络请求）。\n\n' +
          '只在你信任这个包来源时才继续。',
        confirmText: '安装',
        cancelText: '取消',
      })
      if (!ok) return
    }
    npmBusyPkgs.value.set(pkg, 'npm-install:' + pkg)
    npmError.value = ''
    try {
      await svc.installFromNpm(pkg, { serverConfirm: hasServer })
      npmInstalled.value = await svc.listNpmInstalled()
      // 装完清缓存：下次进 tab 拉到的是装完的最新列表
      clearMarketCache()
      await loadMarket(true)
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
      logError(pkg, err)

    } finally {
      npmBusyPkgs.value.delete(pkg)
    }
  }

  async function onNpmUpdate(pkg: string): Promise<void> {
    npmBusyPkgs.value.set(pkg, 'npm-update:' + pkg)
    npmError.value = ''
    try {
      const r = await svc.updateFromNpm(pkg)
      npmInstalled.value = await svc.listNpmInstalled()
      clearMarketCache()
      await loadMarket(true)
      if (r.updated) {
        justUpdatedVersion.value.set(pkg, r.to ?? '')
        // 本地已知最新:把报告里的更新项摘掉,否则「已更新」徽章旁边还挂着更新按钮
        // (报告是定时快照,刷新前仍带旧数据 —— 用户实测 2026-11-23)。
        delete npmUpdates.value[pkg]
        notify?.success('「' + pkg + '」已更新到 v' + (r.to ?? ''))
      } else {
        notify?.info('「' + pkg + '」已是最新版本')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      npmError.value = msg
      notify?.error('更新「' + pkg + '」失败：' + msg)
      logError(pkg, err)

    } finally {
      npmBusyPkgs.value.delete(pkg)
    }
  }

  async function onNpmUninstall(pkg: string): Promise<void> {
    const ok = await feedback?.confirm({
      title: '从 NPM 卸载「' + pkg + '」',
      description: '卸载后，后台那一半要重启服务才会消失。',
      confirmText: '卸载',
      cancelText: '取消',
      tone: 'destructive',
    })
    if (!ok) return
    npmBusyPkgs.value.set(pkg, 'npm-uninstall:' + pkg)
    npmError.value = ''
    try {
      await svc.uninstallFromNpm(pkg)
      npmInstalled.value = await svc.listNpmInstalled()
      clearMarketCache()
      await loadMarket(true)
      notify?.success('已卸载「' + pkg + '」')
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
      logError(pkg, err)
    } finally {
      npmBusyPkgs.value.delete(pkg)
    }
  }

  function findLocalRow(id: string): Row | undefined {
    return s.rows.find((row) => row.entry.id === id)
  }

  /** 卡片按钮和整卡点击统一从这里分发。 */
  async function onCardAction(key: string): Promise<void> {
    const sep = key.indexOf(':')
    if (sep < 0) return
    const kind = key.slice(0, sep)
    const value = key.slice(sep + 1)

    if (kind === 'install') {
      const row = findLocalRow(value)
      if (row) await onInstall(row)
      return
    }
    if (kind === 'reinstall') {
      const row = findLocalRow(value)
      if (row) await onReinstall(row)
      return
    }
    if (kind === 'uninstall') {
      const row = findLocalRow(value)
      const ok = await feedback?.confirm({
        title: '卸载「' + (row?.entry.title || value) + '」',
        description: '卸载后，它的界面与后台部分会一起停用。',
        confirmText: '卸载',
        cancelText: '取消',
        tone: 'destructive',
      })
      if (ok) await svc.uninstall(value)
      return
    }
    if (kind === 'npm-install') {
      const item = marketList.value.find((entry) => entry.pkg === value)
      if (item) await onNpmInstall(item.pkg, item.hasServer)
      return
    }
    if (kind === 'npm-update') {
      void onNpmUpdate(value)
      return
    }
    if (kind === 'npm-uninstall') {
      void onNpmUninstall(value)
      return
    }
    if (kind === 'detail') {
      void svc.openDetail(value)
      return
    }
  }

  onMounted(() => {
    if (!s.ready && !s.loading) void svc.refresh()
    void svc.fetchBuiltinPkgs().then((set) => { reportBuiltinPkgs.value = set })
    void loadMarket()
  })

  return {
    svc,
    s,
    onRefresh,
    installedCount,
    pluginTabs,
    activeTabId,
    selectTab,
    activeSection,
    tabCount,
    cardFilter,
    showLogView,
    loadLog,
    onNpmSearch,
    npmQuery,
    npmSearching,
    marketCards,
    visibleInstalledCards,
    visibleLocalCards,
    onCardAction,
    openDetail: svc.openDetail,
    closeDetail: svc.closeDetail,
  }
}

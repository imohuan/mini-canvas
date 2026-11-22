/**
 * PluginManagerPage 的状态与动作。
 *
 * 页面只负责把这里返回的状态交给工具栏、页签正文和卡片网格；
 * 清单、NPM 市场、安装/更新/卸载仍按原来的顺序执行。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
export type TabId = 'market' | 'installed' | 'local' | 'builtin'

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

  /** 地址输入框先写草稿，点「刷新」再写回服务。 */
  const urlDraft = ref(s.catalogUrl)
  function onRefresh(): void {
    s.catalogUrl = urlDraft.value.trim() || s.catalogUrl
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

  function badgeOf(row: Row): { text: string; tone: PluginCardTone } {
    if (row.entry.builtin === true) {
      const update = npmUpdates.value[row.entry.name]
      return update ? { text: '已更新', tone: 'on' } : { text: '自带', tone: 'builtin' }
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

  function cardStatusOf(row: Row): string {
    if (row.busy) return row.installed ? '处理中' : '安装中'
    return badgeOf(row).text
  }

  /** 自带插件是否有可用更新（pkg 名对应 npm 包名） */
  function builtinUpdateOf(row: Row): string | undefined {
    if (row.entry.builtin !== true) return undefined
    // 报告键是 npm 包名(@plume-canvas/<目录名>);entry.name 是画布里的插件名(如 agent),
    // 两者都对一遍 —— 更新报告用的是包名,而清单用的是 pluginName。
    return npmUpdates.value['@plume-canvas/' + row.entry.id] ?? npmUpdates.value[row.entry.name]
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
        primaryAction: !row.installed && !row.busy ? 'install:' + row.entry.id : undefined,
        clickHint: '点击卡片安装',
      }
    }),
  )

  /** 自带卡片：只读，不提供装卸按钮。 */
  const builtinCards = computed<PluginManagerCardView[]>(() =>
    builtinRows.value.map((row) => ({
      id: row.entry.id,
      title: row.entry.title || row.entry.id,
      description: row.entry.description || '随应用启动的插件。',
      meta: versionMetaOf(row),
      status: cardStatusOf(row),
      tone: row.busy ? 'warn' : badgeOf(row).tone,
      busy: row.busy,
      builtin: true,
      server: row.hasServer ? serverBadgeOf(row) : undefined,
      error: row.serverError,
      // 有更新时给一个「更新」动作（走 /api/npm-plugins/update，与 NPM 卡同款）；
      // 没有就只有「详情」。卸载按钮始终不给（自带件不能卸）。
      actions: builtinUpdateOf(row)
        ? [
            {
              key: 'npm-update:' + row.entry.name,
              label: '更新到 v' + builtinUpdateOf(row),
              variant: 'default',
              disabled: row.busy,
            },
            {
              key: 'detail:' + row.entry.name,
              label: '详情',
              variant: 'outline',
            },
          ]
        : [
            {
              key: 'detail:' + row.entry.name,
              label: '详情',
              variant: 'outline',
            },
          ],
      footerNote: builtinUpdateOf(row)
        ? '有更新 → v' + builtinUpdateOf(row)
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
  const npmBusyPkg = ref('')
  const npmTab = ref<TabId>('market')
  const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'market', label: '市场' },
    { id: 'installed', label: '已装' },
    { id: 'local', label: '本地清单' },
    { id: 'builtin', label: '自带' },
  ]

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
      const installedVersion = npmVersionOf(item.pkg)
      const busy = npmBusyPkg.value === item.pkg
      const update = npmUpdates.value[item.pkg]
      const actions: PluginCardAction[] = []
      actions.push({
        key: 'detail:' + item.pkg,
        label: '详情',
        variant: 'outline',
        disabled: false,
      })
      if (!installedVersion) {
        actions.push({
          key: 'npm-install:' + item.pkg,
          label: '安装',
          variant: 'default',
          disabled: busy,
        })
      } else if (update) {
        // 只有检测到新版本才出现「更新」；更新按钮同时承担版本号提示（用户 2026-11-21）
        actions.push({
          key: 'npm-update:' + item.pkg,
          label: '更新到 v' + update,
          variant: 'default',
          disabled: busy,
        })
        actions.push({
          key: 'npm-uninstall:' + item.pkg,
          label: '卸载',
          variant: 'destructive',
          disabled: busy,
        })
      } else {
        actions.push({
          key: 'npm-uninstall:' + item.pkg,
          label: '卸载',
          variant: 'destructive',
          disabled: busy,
        })
      }

      const meta = ['v' + item.version]
      if (item.hasServer) meta.push('含后台')

      return {
        id: item.pkg,
        title: item.title,
        description: item.description || '这个插件没有写说明。',
        meta: meta.join(' · '),
        status: busy ? '处理中' : installedVersion ? '已安装' : '未安装',
        tone: busy ? 'warn' : installedVersion ? 'on' : 'off',
        busy,
        actions,
        primaryAction: !installedVersion && !busy ? 'npm-install:' + item.pkg : undefined,
        clickHint: '点击卡片安装',
        footerNote: update ? '可更新到 v' + update : undefined,
      }
    }),
  )

  const installedNpmCards = computed<PluginManagerCardView[]>(() =>
    npmInstalled.value.map((entry) => {
      const hit = marketList.value.find((item) => item.pkg === entry.pkg)
      const busy = npmBusyPkg.value === entry.pkg
      const update = npmUpdates.value[entry.pkg]
      const actions: PluginCardAction[] = [
        {
          key: 'detail:' + entry.pkg,
          label: '详情',
          variant: 'outline',
          disabled: false,
        },
        {
          key: 'npm-uninstall:' + entry.pkg,
          label: '卸载',
          variant: 'destructive',
          disabled: busy,
        },
      ]
      if (update) {
        actions.unshift({
          key: 'npm-update:' + entry.pkg,
          label: '更新到 v' + update,
          variant: 'default',
          disabled: busy,
        })
      }
      return {
        id: entry.pkg,
        title: hit?.title || entry.pkg,
        description: hit?.description || '已从 NPM 安装的插件。',
        meta: 'v' + entry.version + ' · ' + entry.pkg,
        status: busy ? '处理中' : '已安装',
        tone: busy ? 'warn' : 'on',
        busy,
        actions,
        footerNote: update ? '有更新 → v' + update : undefined,
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

  const visibleLocalCards = computed(() => filterCards(localCards.value))
  const visibleBuiltinCards = computed(() => filterCards(builtinCards.value))
  const visibleInstalledCards = computed(() => filterCards(installedNpmCards.value))

  function tabCount(id: TabId): number {
    if (id === 'market') return marketCards.value.length
    if (id === 'installed') return visibleInstalledCards.value.length
    if (id === 'local') return visibleLocalCards.value.length
    return visibleBuiltinCards.value.length
  }

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
    npmInstalled: Awaited<ReturnType<typeof svc.listNpmInstalled>>
    npmUpdates: Record<string, string>
    savedAt: number
  }

  function readMarketCache(): MarketCache | undefined {
    const storage = cacheStorage()
    if (!storage) return undefined
    try {
      const raw = storage.getItem(MARKET_CACHE_KEY)
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as MarketCache
      if (!Array.isArray(parsed.marketList) || !Array.isArray(parsed.npmInstalled)) return undefined
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
      writeMarketCache({
        marketList: marketList.value,
        npmInstalled: npmInstalled.value,
        npmUpdates: npmUpdates.value,
      })
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
    } finally {
      npmSearching.value = false
    }
  }

  /** 进 tab / 刷新按钮走这里：有新鲜缓存直接用，过期才发请求。force = 无视缓存。 */
  async function loadMarket(force = false): Promise<void> {
    if (!force) {
      const cached = readMarketCache()
      if (cached) {
        marketList.value = cached.marketList
        npmInstalled.value = cached.npmInstalled
        npmUpdates.value = cached.npmUpdates
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
        npmInstalled: npmInstalled.value,
        npmUpdates: npmUpdates.value,
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
    npmBusyPkg.value = pkg
    npmError.value = ''
    try {
      await svc.installFromNpm(pkg, { serverConfirm: hasServer })
      npmInstalled.value = await svc.listNpmInstalled()
      // 装完清缓存：下次进 tab 拉到的是装完的最新列表
      clearMarketCache()
      await loadMarket(true)
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
    } finally {
      npmBusyPkg.value = ''
    }
  }

  async function onNpmUpdate(pkg: string): Promise<void> {
    npmBusyPkg.value = pkg
    npmError.value = ''
    try {
      const r = await svc.updateFromNpm(pkg)
      npmInstalled.value = await svc.listNpmInstalled()
      clearMarketCache()
      await loadMarket(true)
      if (r.updated) {
        notify?.success('「' + pkg + '」已更新到 v' + (r.to ?? ''))
      } else {
        notify?.info('「' + pkg + '」已是最新版本')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      npmError.value = msg
      notify?.error('更新「' + pkg + '」失败：' + msg)
    } finally {
      npmBusyPkg.value = ''
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
    npmBusyPkg.value = pkg
    npmError.value = ''
    try {
      await svc.uninstallFromNpm(pkg)
      npmInstalled.value = await svc.listNpmInstalled()
      clearMarketCache()
      await loadMarket(true)
      notify?.success('已卸载「' + pkg + '」')
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
    } finally {
      npmBusyPkg.value = ''
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
    urlDraft.value = s.catalogUrl
    if (!s.ready && !s.loading) void svc.refresh()
    void loadMarket()
  })

  // ==========================================================================
  // 更新通知（用户口径 2026-11-22）：启动扫一遍 + 挂载期间每 30 分钟静默拉一次。
  // 数据源只用 /api/updates 报告（server 已缓存，轻）；拉不到就不弹等下一轮。
  // 去重靠 localStorage 记「pkg → 上次通知过的版本」映射，同一版本不重复弹。
  // ==========================================================================
  const NOTIFIED_KEY = 'plugin-manager:notified-updates'
  let notifyTimer: ReturnType<typeof setInterval> | undefined

  function readNotifiedMap(): Record<string, string> {
    try {
      const raw = cacheStorage()?.getItem(NOTIFIED_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    } catch {
      return {}
    }
  }

  function writeNotifiedMap(map: Record<string, string>): void {
    try {
      cacheStorage()?.setItem(NOTIFIED_KEY, JSON.stringify(map))
    } catch {
      /* 隐私模式/配额满：只是多弹一次，不致命 */
    }
  }

  async function checkUpdatesNotify(): Promise<void> {
    const report = await svc.fetchUpdateReport()
    if (!report) return
    npmUpdates.value = report
    const notified = readNotifiedMap()
    // pkg 名形如 @plume-canvas/plugin-agent —— 通知文案里去掉 scope 显示更好读
    const shortName = (pkg: string): string => pkg.replace(/^@[^/]+\//, '')
    for (const [pkg, latest] of Object.entries(report)) {
      if (notified[pkg] === latest) continue
      notify?.warning(shortName(pkg) + ' 有新版本 v' + latest + '，可在插件管理里更新')
      notified[pkg] = latest
    }
    writeNotifiedMap(notified)
  }

  onMounted(() => {
    void checkUpdatesNotify()
    // 半小时静默扫一次：页开着也能收到「有新版本」提示（服务端定时器也在跑，双保险）
    notifyTimer = setInterval(() => {
      void checkUpdatesNotify()
    }, 30 * 60 * 1000)
  })

  onUnmounted(() => {
    if (notifyTimer) clearInterval(notifyTimer)
  })

  return {
    svc,
    s,
    urlDraft,
    onRefresh,
    installedCount,
    npmTab,
    TABS,
    tabCount,
    cardFilter,
    npmError,
    onNpmSearch,
    npmQuery,
    npmSearching,
    marketCards,
    visibleInstalledCards,
    visibleLocalCards,
    visibleBuiltinCards,
    onCardAction,
    openDetail: svc.openDetail,
    closeDetail: svc.closeDetail,
  }
}

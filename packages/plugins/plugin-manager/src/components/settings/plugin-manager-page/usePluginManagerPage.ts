/**
 * PluginManagerPage 的状态与动作。
 *
 * 页面只负责把这里返回的状态交给工具栏、页签正文和卡片网格；
 * 清单、NPM 市场、安装/更新/卸载仍按原来的顺序执行。
 */
import { computed, onMounted, ref } from 'vue'
import { useCanvasContextOrRender } from '@plume-canvas/canvas-render'
import type { FeedbackService } from '@plume-canvas/canvas-render'
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

export function usePluginManagerPage() {
  const svc = usePluginManager()
  const s = svc.state
  /** 统一确认框：卸载 / 含后台安装都走它，不用浏览器原生 confirm。 */
  const feedback = useCanvasContextOrRender().ctx.get<FeedbackService>('feedback')

  /** 地址输入框先写草稿，点「刷新」再写回服务。 */
  const urlDraft = ref(s.catalogUrl)
  function onRefresh(): void {
    s.catalogUrl = urlDraft.value.trim() || s.catalogUrl
    void svc.refresh()
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

  function badgeOf(row: Row): { text: string; tone: PluginCardTone } {
    if (row.entry.builtin === true) return { text: '自带', tone: 'builtin' }
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
        warning: row.missingDeps?.length ? '缺少依赖：' + row.missingDeps.join('、') : undefined,
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
      status: '自带',
      tone: 'builtin',
      builtin: true,
      server: row.hasServer ? serverBadgeOf(row) : undefined,
      error: row.serverError,
      actions: [],
      footerNote: '随应用启动，不能卸载',
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
  const npmUpdates = ref<Record<string, string>>({})
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
      if (!installedVersion) {
        actions.push({
          key: 'npm-install:' + item.pkg,
          label: '安装',
          variant: 'default',
          disabled: busy,
        })
      } else {
        actions.push({
          key: 'npm-update:' + item.pkg,
          label: '更新',
          variant: 'outline',
          disabled: busy,
        })
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
          key: 'npm-update:' + entry.pkg,
          label: '更新',
          variant: 'outline',
          disabled: busy,
        },
        {
          key: 'npm-uninstall:' + entry.pkg,
          label: '卸载',
          variant: 'destructive',
          disabled: busy,
        },
      ]
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

  async function loadMarket(): Promise<void> {
    npmSearching.value = true
    npmError.value = ''
    try {
      marketList.value = await svc.browseNpmPlugins()
      npmInstalled.value = await svc.listNpmInstalled()
      npmUpdates.value = await svc.checkNpmUpdates()
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
    } finally {
      npmSearching.value = false
    }
  }

  async function onNpmSearch(): Promise<void> {
    const q = npmQuery.value.trim()
    if (!q) {
      await loadMarket()
      return
    }
    npmSearching.value = true
    npmError.value = ''
    try {
      marketList.value = await svc.searchNpmPlugins(q)
      npmInstalled.value = await svc.listNpmInstalled()
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
      await svc.updateFromNpm(pkg)
      npmInstalled.value = await svc.listNpmInstalled()
    } catch (err) {
      npmError.value = err instanceof Error ? err.message : String(err)
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
    }
  }

  onMounted(() => {
    urlDraft.value = s.catalogUrl
    if (!s.ready && !s.loading) void svc.refresh()
    void loadMarket()
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
  }
}

<script setup lang="ts">
/**
 * PluginManagerPage —— 设置面板里「插件」这一页。
 *
 * 布局：
 *   ① 工具条：中转地址 + 刷新 + 全部安装 + 计数
 *   ② 管理令牌
 *   ③ 页签：市场 / 已装 / 本地清单 / 自带
 *   ④ 筛选 + 两列卡片（窄屏一列）
 *
 * 数据仍来自 plugin-manager 服务。这里只拼卡片和转发动作。
 */
import { computed, onMounted, ref } from 'vue'
import { Download, Loader2, PackageSearch, RefreshCw, Search } from 'lucide-vue-next'
import {
  Badge,
  Button,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@mini-canvas/ui-kit-shadcn'
import { getAdminToken, setAdminToken } from '@mini-canvas/canvas-base'
import { usePluginManager } from '../../usePluginManager'
import PluginCard from './PluginCard.vue'
import type {
  PluginCardAction,
  PluginCardTone,
  PluginManagerCardView,
  PluginServerTone,
} from './pluginCardTypes'

type Row = (typeof s.rows)[number]
type TabId = 'market' | 'installed' | 'local' | 'builtin'

const svc = usePluginManager()
const s = svc.state

/** 地址输入框先写草稿，点「刷新」再写回服务。 */
const urlDraft = ref(s.catalogUrl)
/** 管理令牌存在本机浏览器，受保护的装卸请求会自动带上。 */
const tokenDraft = ref(getAdminToken() ?? '')

function onTokenInput(): void {
  setAdminToken(tokenDraft.value)
}

function onRefresh(): void {
  s.catalogUrl = urlDraft.value.trim() || s.catalogUrl
  void svc.refresh()
}

/** 带后台的插件必须先确认：后台代码以服务端权限运行。 */
function onInstall(row: Row): void {
  const hasServer = row.entry.server !== undefined
  if (hasServer) {
    const ok = window.confirm(
      '「' + (row.entry.title || row.entry.id) + '」包含后台插件。\n\n' +
        '后台插件会以服务端权限在本机运行（可读写文件、发起网络请求）。\n' +
        '只在你信任这个插件来源时才继续。\n\n确定要安装吗？',
    )
    if (!ok) return
  }
  void svc.install(row.entry.id, { serverConfirm: hasServer })
}

function onReinstall(row: Row): void {
  const hasServer = row.entry.server !== undefined
  if (hasServer) {
    const ok = window.confirm(
      '「' + (row.entry.title || row.entry.id) + '」包含后台插件。\n\n' +
        '重装会把后台代码重新写入本机并以服务端权限运行。\n\n确定要重装吗？',
    )
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
    const ok = window.confirm(
      '「' + pkg + '」包含后台插件。\n\n' +
        '后台插件会以服务端权限在本机运行（可读写文件、发起网络请求）。\n' +
        '只在你信任这个包来源时才继续。\n\n确定要从 NPM 安装吗？',
    )
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
  if (!window.confirm('从 NPM 卸载「' + pkg + '」？\n（后台半重启服务后消失）')) return
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
function onCardAction(key: string): void {
  const sep = key.indexOf(':')
  if (sep < 0) return
  const kind = key.slice(0, sep)
  const value = key.slice(sep + 1)

  if (kind === 'install') {
    const row = findLocalRow(value)
    if (row) onInstall(row)
    return
  }
  if (kind === 'reinstall') {
    const row = findLocalRow(value)
    if (row) onReinstall(row)
    return
  }
  if (kind === 'uninstall') {
    void svc.uninstall(value)
    return
  }
  if (kind === 'npm-install') {
    const item = marketList.value.find((entry) => entry.pkg === value)
    if (item) void onNpmInstall(item.pkg, item.hasServer)
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
</script>

<template>
  <div class="pmp">
    <div class="pmp-toolbar">
      <label class="pmp-field pmp-url">
        <span class="pmp-label">中转后台地址</span>
        <Input
          v-model="urlDraft"
          class="pmp-input"
          type="text"
          spellcheck="false"
          aria-label="中转后台地址"
          placeholder="http://127.0.0.1:5320/catalog.json"
          @keydown.enter.prevent="onRefresh"
        />
      </label>
      <div class="pmp-toolbar-actions">
        <Button variant="outline" size="sm" type="button" :disabled="s.loading" @click="onRefresh">
          <RefreshCw :size="14" :class="{ spin: s.loading }" aria-hidden="true" />
          刷新
        </Button>
        <Button size="sm" type="button" :disabled="s.loading || s.installingAll" @click="svc.installAll()">
          <Download :size="14" aria-hidden="true" />
          全部安装
        </Button>
      </div>
      <span class="pmp-count">{{ installedCount }} / {{ s.rows.length }} 已装</span>
    </div>

    <div class="pmp-token">
      <label class="pmp-field pmp-token-field">
        <span class="pmp-label">管理令牌</span>
        <Input
          v-model="tokenDraft"
          class="pmp-input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          aria-label="管理令牌"
          placeholder="粘贴后台启动日志或 admin-token 文件里的令牌"
          @input="onTokenInput"
        />
      </label>
      <p class="pmp-token-hint">
        令牌在后台启动日志或 &lt;数据目录&gt;/admin-token 里。它存在本机浏览器里，装了不可信插件等于把它交出去。
      </p>
    </div>

    <Tabs v-model="npmTab" class="pmp-tabs">
      <TabsList variant="line" class="pmp-tab-list" aria-label="插件分类">
        <TabsTrigger v-for="tab in TABS" :key="tab.id" :value="tab.id" class="pmp-tab">
          {{ tab.label }}
          <Badge variant="secondary" class="pmp-tab-count">{{ tabCount(tab.id) }}</Badge>
        </TabsTrigger>
      </TabsList>

      <div class="pmp-filter">
        <Search :size="14" class="pmp-filter-icon" aria-hidden="true" />
        <Input
          v-model="cardFilter"
          class="pmp-input pmp-filter-input"
          type="text"
          spellcheck="false"
          aria-label="筛选插件卡片"
          placeholder="筛选当前卡片：名字、说明或包名"
        />
      </div>

      <p v-if="npmError" class="pmp-error" role="alert">{{ npmError }}</p>
      <p v-if="s.error" class="pmp-error" role="alert">{{ s.error }}</p>

      <TabsContent value="market" class="pmp-panel">
        <form class="pmp-search" @submit.prevent="onNpmSearch">
          <Input
            v-model="npmQuery"
            class="pmp-input"
            type="text"
            spellcheck="false"
            aria-label="搜索 NPM 插件"
            placeholder="搜索包名（留空 = 列出全部可安装插件）"
            @keydown.enter.prevent="onNpmSearch"
          />
          <Button variant="outline" size="sm" type="submit" :disabled="npmSearching">
            <Loader2 v-if="npmSearching" class="spin" :size="14" aria-hidden="true" />
            <Search v-else :size="14" aria-hidden="true" />
            {{ npmSearching ? '加载中' : '搜索' }}
          </Button>
        </form>

        <p class="pmp-hint">只列出声明了 miniCanvas.installable、并在允许前缀里的 NPM 包。</p>

        <div v-if="npmSearching && !marketCards.length" class="pmp-loading">
          <Loader2 class="spin" :size="16" aria-hidden="true" />
          正在加载插件…
        </div>
        <div v-else-if="!marketCards.length" class="pmp-empty">
          <PackageSearch :size="20" aria-hidden="true" />
          {{ cardFilter ? '没有符合筛选的插件。' : '没有匹配的插件。' }}
        </div>
        <div v-else class="pmp-grid">
          <PluginCard v-for="card in marketCards" :key="card.id" :card="card" @action="onCardAction" />
        </div>
      </TabsContent>

      <TabsContent value="installed" class="pmp-panel">
        <div v-if="!visibleInstalledCards.length" class="pmp-empty">
          <PackageSearch :size="20" aria-hidden="true" />
          {{ cardFilter ? '没有符合筛选的已装插件。' : '还没有从 NPM 装过插件。' }}
        </div>
        <div v-else class="pmp-grid">
          <PluginCard
            v-for="card in visibleInstalledCards"
            :key="card.id"
            :card="card"
            @action="onCardAction"
          />
        </div>
      </TabsContent>

      <TabsContent value="local" class="pmp-panel">
        <div v-if="!visibleLocalCards.length" class="pmp-empty">
          <PackageSearch :size="20" aria-hidden="true" />
          {{ cardFilter ? '没有符合筛选的插件。' : '服务端目录里没有可装卸的插件。' }}
        </div>
        <div v-else class="pmp-grid">
          <PluginCard
            v-for="card in visibleLocalCards"
            :key="card.id"
            :card="card"
            @action="onCardAction"
          />
        </div>
      </TabsContent>

      <TabsContent value="builtin" class="pmp-panel">
        <div v-if="!visibleBuiltinCards.length" class="pmp-empty">
          <PackageSearch :size="20" aria-hidden="true" />
          {{ cardFilter ? '没有符合筛选的自带插件。' : '没有自带插件。' }}
        </div>
        <div v-else class="pmp-grid">
          <PluginCard
            v-for="card in visibleBuiltinCards"
            :key="card.id"
            :card="card"
            @action="onCardAction"
          />
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>

<style scoped>
/* 整页只负责排布，卡片样式在 PluginCard.vue。 */
.pmp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.pmp-toolbar {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}

.pmp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
}

.pmp-url { flex: 1; }

.pmp-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ui-ink-mute, #9ca3af);
}

.pmp-input {
  width: 100%;
  font-size: 12px;
}

.pmp-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pmp-count {
  padding-bottom: 7px;
  font-size: 11px;
  color: var(--ui-ink-dim, #6b7280);
  white-space: nowrap;
}

.pmp-token {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.pmp-token-field { flex: 0 1 280px; }

.pmp-token-hint {
  flex: 1 1 320px;
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-ink-dim, #6b7280);
}

.pmp-tabs {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.pmp-tab-list {
  width: 100%;
  justify-content: flex-start;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: 0;
  scrollbar-width: none;
}

.pmp-tab-list::-webkit-scrollbar {
  display: none;
}

.pmp-tab {
  flex: none;
  height: 32px;
  gap: 5px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 600;
}

/* 页签未选中态也保持可读（深色主题下 muted 偏暗） */
.pmp-tab:not([data-state="active"]) {
  color: var(--ui-ink-dim, #6b7280);
}

.pmp-tab-count {
  height: 16px;
  min-width: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
}

.pmp-filter {
  position: relative;
  display: flex;
  align-items: center;
}

.pmp-filter-icon {
  position: absolute;
  left: 10px;
  z-index: 1;
  color: var(--ui-ink-mute, #9ca3af);
  pointer-events: none;
}

.pmp-filter-input { padding-left: 30px; }

.pmp-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-danger, #ef4444);
  border-radius: var(--radius-control, 8px);
  font-size: 12px;
  color: var(--ui-danger, #ef4444);
}

.pmp-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.pmp-search {
  display: flex;
  gap: 8px;
}

.pmp-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-ink-mute, #9ca3af);
}

.pmp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  gap: 10px;
}

.pmp-loading,
.pmp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 32px 12px;
  font-size: 12px;
  color: var(--ui-ink-dim, #6b7280);
  text-align: center;
}

.spin { animation: pmp-spin 0.9s linear infinite; }

@keyframes pmp-spin {
  to { transform: rotate(360deg); }
}

/* 窄屏：两列变一列，卡片文字不被压扁。 */
@media (max-width: 640px) {
  .pmp-grid { grid-template-columns: minmax(0, 1fr); }
  .pmp-toolbar-actions { width: 100%; }
  .pmp-count { padding-bottom: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
}
</style>

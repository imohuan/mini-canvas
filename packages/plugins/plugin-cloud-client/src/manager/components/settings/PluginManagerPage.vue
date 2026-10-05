<script setup lang="ts">
/**
 * PluginManagerPage —— 设置面板里「插件」这一页的整页。
 *
 * 布局（照 plugin-agent 的 AgentSettingsPage 结构：上面一行工具条 + 下面内容区）：
 *   ① 工具条：中转后台地址输入 + 刷新 + 全部安装 + 汇总计数
 *   ② 列表：每行一个插件（名字/说明 + 状态徽章 + 安装/卸载/重装按钮）
 *
 * 数据全部来自 plugin-manager 服务（`ctx.get('plugin-manager')`，见 usePluginManager）。
 * 本组件只负责画与转发点击，不自己装插件。
 */
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Download, Trash2, RotateCcw, Puzzle } from 'lucide-vue-next'
import { usePluginManager } from '../../usePluginManager'

const svc = usePluginManager()
const s = svc.state

/** 地址输入框绑一份本地草稿：改完点「刷新」才写到服务（避免边打字边重拉） */
const urlDraft = ref(s.catalogUrl)

onMounted(() => {
  urlDraft.value = s.catalogUrl
  // 页面打开时若还没清单（比如插件是热装进来的），补拉一次
  if (!s.ready && !s.loading) void svc.refresh()
})

function onRefresh(): void {
  s.catalogUrl = urlDraft.value.trim() || s.catalogUrl
  void svc.refresh()
}

/**
 * 安装一个插件。
 *
 * ⚠️ 若这个插件带后台那一半（entry.server），**必须先让用户显式确认** ——
 * 后台插件是以服务端权限运行的代码，这个确认不是可选项（后端也会拒 `confirm !== true`）。
 * 审查发现早先版本把 confirm 硬编码成 true、界面上没有任何确认动作，等于那道门槛形同虚设。
 */
function onInstall(row: (typeof s.rows)[number]): void {
  const hasServer = row.entry.server !== undefined
  if (hasServer) {
    const ok = window.confirm(
      `「${row.entry.title || row.entry.id}」包含后台插件。\n\n` +
        `后台插件会以**服务端权限**在本机运行（可读写文件、发起网络请求）。\n` +
        '只在你信任这个插件来源时才继续。\n\n确定要安装吗？',
    )
    if (!ok) return
  }
  void svc.install(row.entry.id, { serverConfirm: hasServer })
}

/** 重装：与安装一样要先让用户确认后台半（重装同样会重新写后台代码，别静默做）。 */
function onReinstall(row: (typeof s.rows)[number]): void {
  const hasServer = row.entry.server !== undefined
  if (hasServer) {
    const ok = window.confirm(
      `「${row.entry.title || row.entry.id}」包含后台插件。\n\n` +
        '重装会把后台代码**重新写入本机并以服务端权限运行**。\n\n确定要重装吗？',
    )
    if (!ok) return
  }
  void svc.reinstall(row.entry.id, { serverConfirm: hasServer })
}

const installedCount = computed(() => s.rows.filter((r) => r.installed).length)

/**
 * 分组：自带（只读展示）在前、可装卸的在后。
 * 用户要求"即使自带的插件也显示出来，但不显示安装/卸载" —— 一个页面看清全部，
 * 且明确区分"我能动的"和"应用自带的"。
 */
const builtinRows = computed(() => s.rows.filter((r) => r.entry.builtin === true))
const installableRows = computed(() => s.rows.filter((r) => r.entry.builtin !== true))

/** 状态徽章：自带显示「自带」；可装卸的按内核运行态显示，没装的显示「未安装」 */
function badgeOf(row: (typeof s.rows)[number]): { text: string; tone: 'on' | 'off' | 'warn' | 'err' | 'builtin' } {
  if (row.entry.builtin === true) return { text: '自带', tone: 'builtin' }
  if (!row.installed) return { text: '未安装', tone: 'off' }
  if (row.state === 'pending') return { text: '待依赖', tone: 'warn' }
  if (row.state === 'failed') return { text: '装载失败', tone: 'err' }
  return { text: '已安装', tone: 'on' }
}

/**
 * 后台那一半的状态（清单项带 server 时才有）。
 *
 * 用户要的体验是「一个插件 = 前后端一起装」：这里给出后台那半的独立状态灯，
 * 前端 ✓ / 后台 ✓ 各看各的 —— 后台装不上时能一眼看出是哪一半的问题。
 */
function serverBadgeOf(row: (typeof s.rows)[number]): { text: string; tone: 'on' | 'off' | 'err' } {
  // 以服务端实况为准（serverInstalled/serverLoaded 由 syncServerState 回填）：
  // 服务端装着就绝不显示失败 —— 陈旧红字必须让位给事实（用户实测：后台明明装了，界面却报后台失败）。
  if (row.serverInstalled) {
    return row.serverLoaded
      ? { text: '后台已生效', tone: 'on' }
      : { text: '后台已装', tone: 'on' }
  }
  if (row.serverError) return { text: '后台失败', tone: 'err' }
  return { text: '后台未装', tone: 'off' }
}

// ============================================================================
// NPM 市场（搜索 → 安装/更新/卸载；含后台半的包安装前必须确认）
// ============================================================================
const npmQuery = ref('')
const npmSearching = ref(false)
const npmResults = ref<Awaited<ReturnType<typeof svc.searchNpmPlugins>>>([])
const npmError = ref('')
const npmInstalled = ref<Awaited<ReturnType<typeof svc.listNpmInstalled>>>([])
const npmBusyPkg = ref('')
const npmSearched = ref(false)

async function onNpmSearch(): Promise<void> {
  const q = npmQuery.value.trim()
  if (!q) return
  npmSearching.value = true
  npmError.value = ''
  try {
    npmResults.value = await svc.searchNpmPlugins(q)
    npmSearched.value = true
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
        '后台插件会以**服务端权限**在本机运行（可读写文件、发起网络请求）。\n' +
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

const npmVersionOf = (pkg: string): string | undefined =>
  npmInstalled.value.find((e) => e.pkg === pkg)?.version
</script>

<template>
  <div class="pmp">
    <!-- 工具条：后台地址 + 动作 + 计数 -->
    <div class="pmp-toolbar">
      <label class="pmp-url">
        <span class="pmp-url-label">中转后台地址</span>
        <input v-model="urlDraft" class="pmp-input" type="text" spellcheck="false"
          aria-label="中转后台地址" placeholder="http://127.0.0.1:5320/catalog.json"
          @keydown.enter.prevent="onRefresh" />
      </label>
      <button class="pmp-btn" :disabled="s.loading" @click="onRefresh">
        <RefreshCw :size="14" :class="{ spin: s.loading }" /> 刷新
      </button>
      <button class="pmp-btn primary" :disabled="s.loading || s.installingAll" @click="svc.installAll()">
        <Download :size="14" /> 全部安装
      </button>
      <span class="pmp-count">{{ installedCount }} / {{ s.rows.length }} 已装</span>
    </div>

    <p v-if="s.error" class="pmp-error" role="alert">{{ s.error }}</p>

    <p v-if="!s.rows.length && !s.loading" class="pmp-empty">
        <Puzzle :size="20" />
        <span>还没有插件清单 —— 先起云服务：<code>mini-canvas-cloud serve</code>（清单在 <code>/plugin-catalog.json</code>），再点「刷新」。</span>
    </p>
    <p v-else-if="s.loading && !s.rows.length" class="pmp-empty"><span>正在读取清单…</span></p>
    <template v-else>
      <!-- 自带：随应用冷启动装配，只读展示（用户要求"自带的也显示，但不给安装/卸载"） -->
      <section v-if="builtinRows.length" class="pmp-section">
        <h4 class="pmp-sec-title">自带（随应用启动，不可装卸）<span class="pmp-sec-count">{{ builtinRows.length }}</span></h4>
        <div class="pmp-list">
          <article v-for="row in builtinRows" :key="row.entry.id" class="pmp-row is-builtin">
            <div class="pmp-row-main">
              <strong class="pmp-name">{{ row.entry.title || row.entry.id }}</strong>
              <small class="pmp-desc">{{ row.entry.description || row.entry.id }}</small>
            </div>
            <span class="pmp-badge is-builtin">自带</span>
          </article>
        </div>
      </section>

      <!-- 可装卸：清单里 installable 的那些，默认已装 -->
      <section class="pmp-section">
        <h4 class="pmp-sec-title">
          可装卸<span class="pmp-sec-count">{{ installableRows.filter((r) => r.installed).length }} / {{ installableRows.length }}</span>
        </h4>
        <div class="pmp-list">
          <article v-for="row in installableRows" :key="row.entry.id" class="pmp-row">
            <div class="pmp-row-main">
              <strong class="pmp-name">{{ row.entry.title || row.entry.id }}</strong>
              <small class="pmp-desc">{{ row.entry.description || row.entry.id }}</small>
              <small v-if="row.error" class="pmp-row-err">{{ row.error }}</small>
              <small v-else-if="row.missingDeps && row.missingDeps.length" class="pmp-row-err">缺少依赖：{{ row.missingDeps.join('、') }}</small>
              <small v-if="row.serverError" class="pmp-row-err">{{ row.serverError }}</small>
            </div>
            <!-- 成对插件：两个状态灯（前端 / 后台 各一个） -->
            <span class="pmp-badge" :class="'is-' + badgeOf(row).tone">{{ badgeOf(row).text }}</span>
            <span
              v-if="row.hasServer"
              class="pmp-badge"
              :class="'is-' + serverBadgeOf(row).tone"
              :title="'后台插件（以服务端权限运行）'"
            >{{ serverBadgeOf(row).text }}</span>
            <div class="pmp-actions">
              <button v-if="!row.installed" class="pmp-mini" :disabled="row.busy" @click="onInstall(row)">安装</button>
              <button v-else class="pmp-mini danger" :disabled="row.busy" @click="svc.uninstall(row.entry.id)">
                <Trash2 :size="13" /> 卸载
              </button>
               <button class="pmp-mini" :disabled="row.busy" title="卸载后按最新产物重新安装" @click="onReinstall(row)">
                <RotateCcw :size="13" /> 重装
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>

    <!-- NPM 市场：搜索 + 结果（与本地清单分开一个区块） -->
    <section class="pmp-section pmp-npm">
      <h4 class="pmp-sec-title">NPM 市场<span class="pmp-sec-count">@mini-canvas/</span></h4>
      <form class="pmp-npm-search" @submit.prevent="onNpmSearch">
        <input v-model="npmQuery" class="pmp-input" type="text" spellcheck="false"
          aria-label="搜索 NPM 插件" placeholder="搜索插件，如 showcase…" />
        <button class="pmp-btn" type="submit" :disabled="npmSearching || !npmQuery.trim()">
          <RefreshCw :size="14" :class="{ spin: npmSearching }" /> 搜索
        </button>
      </form>
      <p v-if="npmError" class="pmp-error" role="alert">{{ npmError }}</p>
      <div v-if="npmSearched" class="pmp-list">
        <p v-if="!npmResults.length && !npmSearching" class="pmp-npm-empty">
          没有找到可安装的插件（只显示声明了 miniCanvas.installable 的 @mini-canvas/ 包）。
        </p>
        <article v-for="r in npmResults" :key="r.pkg" class="pmp-row">
          <div class="pmp-row-main">
            <strong class="pmp-name">{{ r.title }} <code class="pmp-pkg">{{ r.pkg }}</code></strong>
            <small class="pmp-desc">{{ r.description }}</small>
            <small class="pmp-desc">v{{ r.version }}<template v-if="r.hasServer"> · 含后台半</template></small>
          </div>
          <span v-if="npmVersionOf(r.pkg)" class="pmp-badge is-on">已装 v{{ npmVersionOf(r.pkg) }}</span>
          <div class="pmp-actions">
            <button v-if="!npmVersionOf(r.pkg)" class="pmp-mini" :disabled="npmBusyPkg === r.pkg"
              @click="onNpmInstall(r.pkg, r.hasServer)">安装</button>
            <button v-else class="pmp-mini" :disabled="npmBusyPkg === r.pkg"
              @click="onNpmUpdate(r.pkg)">更新</button>
            <button v-if="npmVersionOf(r.pkg)" class="pmp-mini danger" :disabled="npmBusyPkg === r.pkg"
              @click="onNpmUninstall(r.pkg)"><Trash2 :size="13" /> 卸载</button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 整页：上面工具条 + 下面列表；列表自己滚动，页面本身不撑高外层。 */
.pmp { display: flex; flex-direction: column; gap: 12px; }
.pmp-toolbar { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.pmp-url { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px; }
.pmp-url-label { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--ui-ink-mute, #9ca3af); }
.pmp-input { height: 30px; padding: 0 9px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font-size: 12px; outline: none; box-sizing: border-box; width: 100%; }
.pmp-input:focus-visible { border-color: var(--ui-accent, #0891b2); }

.pmp-btn { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: transparent; color: var(--ui-ink, #18202b); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.18s ease, color 0.18s ease; }
.pmp-btn:hover:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.pmp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pmp-btn.primary { background: var(--ui-accent, #0891b2); border-color: var(--ui-accent, #0891b2); color: var(--ui-primary-ink, #fff); }
.pmp-btn.primary:hover:not(:disabled) { background: var(--ui-accent-hover, #0e7490); }
.pmp-btn:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.pmp-count { font-size: 11px; color: var(--ui-ink-dim, #6b7280); padding-bottom: 6px; }

.pmp-error { margin: 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: 8px; font-size: 12px; color: var(--ui-danger, #ef4444); }

.pmp-list { display: flex; flex-direction: column; gap: 6px; }
.pmp-section { display: flex; flex-direction: column; gap: 8px; }
.pmp-sec-title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.03em; color: var(--ui-ink-dim, #6b7280); }
.pmp-sec-count { padding: 1px 6px; border-radius: 999px; background: var(--ui-veil, rgb(0 0 0 / 0.04)); font-size: 10px; font-weight: 700; color: var(--ui-ink-dim, #6b7280); }
.pmp-row.is-builtin { background: var(--ui-panel-soft, rgb(0 0 0 / 0.02)); }
.pmp-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 12px; text-align: center; font-size: 12px; color: var(--ui-ink-dim, #6b7280); }
.pmp-empty code { padding: 1px 5px; border-radius: 4px; background: var(--ui-veil, rgb(0 0 0 / 0.04)); font-size: 11px; }

.pmp-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 10px; background: var(--ui-panel, #fff); }
.pmp-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.pmp-name { font-size: 13px; font-weight: 600; color: var(--ui-ink, #18202b); }
.pmp-desc { font-size: 11px; color: var(--ui-ink-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmp-row-err { font-size: 11px; color: var(--ui-danger, #ef4444); }

.pmp-badge { flex: none; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 700; }
.pmp-badge.is-on { color: var(--ui-accent-hover, #0e7490); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.pmp-badge.is-off { color: var(--ui-ink-dim, #6b7280); background: var(--ui-veil, rgb(0 0 0 / 0.04)); }
.pmp-badge.is-warn { color: var(--ui-warn, #b45309); background: var(--ui-warn-soft, rgb(245 158 11 / 0.16)); }
.pmp-badge.is-err { color: var(--ui-danger, #ef4444); background: var(--ui-danger-soft, rgb(239 68 68 / 0.1)); }
.pmp-badge.is-builtin { color: var(--ui-ink-dim, #6b7280); background: var(--ui-veil, rgb(0 0 0 / 0.05)); }

.pmp-actions { display: flex; gap: 4px; flex: none; }
.pmp-mini { display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 9px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 7px; background: transparent; color: var(--ui-ink, #18202b); font-size: 11px; cursor: pointer; white-space: nowrap; transition: background 0.18s ease; }
.pmp-mini:hover:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.pmp-mini:disabled { opacity: 0.45; cursor: not-allowed; }
.pmp-mini.danger { color: var(--ui-danger, #ef4444); }
.pmp-mini:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

.spin { animation: pmp-spin 0.9s linear infinite; }
@keyframes pmp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

.pmp-npm { border-top: 1px solid var(--ui-line-soft, #eef0f4); padding-top: 12px; }
.pmp-npm-search { display: flex; gap: 8px; }
.pmp-npm-search .pmp-input { flex: 1; }
.pmp-npm-empty { margin: 0; font-size: 12px; color: var(--ui-ink-dim, #6b7280); }
.pmp-pkg { font-size: 10px; font-weight: 400; color: var(--ui-ink-dim, #6b7280); }
</style>

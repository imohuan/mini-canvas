<script setup lang="ts">
/**
 * HotReloadPage —— 设置面板里「调试插件」这一页。
 *
 * 只管**调试这一侧**：列出 watch 上报过哪些插件、内核里装没装、状态如何，
 * 并提供重装 / 卸载。它不读也不写「插件管理」的安装名单 —— 两边是两个独立插件。
 *
 * 「是否已安装」的唯一判据 = 内核里有没有这个**插件自己的名字**（`window.MiniCanvasUI.listPlugins()`），
 * 与谁装的、从哪装的无关。同名只会有这一份（内核按名字索引，重复装会被拒）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RefreshCw, RotateCcw, Trash2, Bug } from 'lucide-vue-next'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { presenceStatusOf, type DebugPluginRow, type DebugPresenceStatus, type HotReload } from '../../data/hotReload'

/** 从内核取热重载服务（本插件自己上架的，与插件管理无关） */
const { ctx } = useCanvasRender()
const hr = ctx.get<HotReload>('hot-reload')
if (!hr) throw new Error('[HotReloadPage] 没找到 hot-reload 服务')

const rows = ref<DebugPluginRow[]>([])
const loading = ref(false)
const busy = ref('')
const error = ref('')

const installedCount = computed(() => rows.value.filter((r) => r.installed).length)
/** 监听在线数（只算真的在盯文件的：在线 / 构建中） */
const watchingCount = computed(
  () => rows.value.filter((r) => r.presence === 'online' || r.presence === 'building').length,
)

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    rows.value = await hr.listDebugPlugins()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

/** 重装：按上报地址卸旧装新；后台有产物也一并按路径装 */
async function onReinstall(row: DebugPluginRow): Promise<void> {
  busy.value = row.name
  error.value = ''
  try {
    await hr.reinstallDebugPlugin(row.name)
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

/** 卸载：内核卸 + 后台卸 + 删上报记录 */
async function onUninstall(row: DebugPluginRow): Promise<void> {
  if (!window.confirm('卸载调试插件「' + row.name + '」？\n（只删这一侧；插件管理那边装的同名插件不会被动。）')) return
  busy.value = row.name
  error.value = ''
  try {
    await hr.uninstallDebugPlugin(row.name)
    await refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

/** 状态徽章：已装按内核运行态，未装明确写「未安装」 */
function badgeOf(row: DebugPluginRow): { text: string; tone: 'on' | 'off' | 'warn' | 'err' } {
  if (!row.installed) return { text: '未安装', tone: 'off' }
  if (row.state === 'pending') return { text: '待依赖', tone: 'warn' }
  if (row.state === 'failed') return { text: '装载失败', tone: 'err' }
  return { text: '已安装', tone: 'on' }
}

function timeOf(at?: number): string {
  if (!at) return '—'
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 监听状态徽章。
 *
 * 与「装没装」是**两件事**：插件装着但 watch 已被关掉时，这里必须明确写「失联 / 未知」，
 * 不能因为装了插件就显示成正常 —— 那正是改代码没反应的根源。
 */
function presenceBadge(row: DebugPluginRow): { text: string; tone: 'on' | 'off' | 'warn' | 'err' | 'info' } {
  const s: DebugPresenceStatus = row.presence ?? presenceStatusOf(undefined)
  switch (s) {
    case 'online':
      return { text: '监听中', tone: 'on' }
    case 'building':
      return { text: '构建中', tone: 'info' }
    case 'paused':
      return { text: '已暂停', tone: 'warn' }
    case 'failed':
      return { text: '构建失败', tone: 'err' }
    case 'stale':
      return { text: '已失联', tone: 'err' }
    case 'stopped':
      return { text: '已停止', tone: 'off' }
    default:
      return { text: '未上报心跳', tone: 'off' }
  }
}

/** 心跳距今多久（一句话） */
function ageText(ms?: number): string {
  if (ms === undefined) return '—'
  if (ms < 60_000) return Math.round(ms / 1000) + ' 秒前'
  return Math.round(ms / 60_000) + ' 分钟前'
}

/** 页面可见时补一次对账：SSE 在隐藏期间会漏，不能只靠推送 */
function onVisible(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refresh()
}

let stopPresence: (() => void) | undefined
onUnmounted(() => {
  stopPresence?.()
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})

onMounted(() => {
  void refresh()
  // 监听状态变了就刷新（后台借现有的 KV 长连接广播，不新开连接）
  stopPresence = hr.watchDebugPresence(() => void refresh())
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
})
</script>

<template>
  <div class="hrp">
    <div class="hrp-toolbar">
      <p class="hrp-hint">
        这里是 <strong>watch 上报</strong>过的调试插件。「已安装」只看内核里有没有同名插件；
        「监听」看 watch 是否还在发心跳 —— 两件事分开看，与「插件」页是两套独立入口。
      </p>
      <button class="hrp-btn" :disabled="loading" @click="refresh">
        <RefreshCw :size="14" :class="{ spin: loading }" /> 刷新
      </button>
      <span class="hrp-count">{{ installedCount }} / {{ rows.length }} 已装</span>
      <span class="hrp-count">{{ watchingCount }} 个监听中</span>
    </div>

    <p v-if="error" class="hrp-error" role="alert">{{ error }}</p>

    <div class="hrp-table-wrap">
      <table class="hrp-table">
        <thead>
          <tr><th>插件</th><th>已安装</th><th>监听</th><th>上报地址</th><th>最后心跳</th><th class="hrp-th-act">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.name">
            <td>
              <strong class="hrp-name"><Bug :size="12" /> {{ r.name }}</strong>
              <div v-if="r.server" class="hrp-desc" :title="r.server">后台：{{ r.server }}</div>
            </td>
            <td class="hrp-nowrap">
              <span class="hrp-badge" :class="'is-' + badgeOf(r).tone">{{ badgeOf(r).text }}</span>
            </td>
            <td class="hrp-nowrap">
              <span class="hrp-badge" :class="'is-' + presenceBadge(r).tone" :title="r.presenceMessage || ''">
                {{ presenceBadge(r).text }}
              </span>
              <span v-if="r.presenceInstances && r.presenceInstances > 1" class="hrp-warn"
                :title="'同一插件有 ' + r.presenceInstances + ' 个 watch 实例在跑，可能互相抢构建'">
                多实例 {{ r.presenceInstances }}
              </span>
              <div v-if="r.presenceMessage" class="hrp-row-err">{{ r.presenceMessage }}</div>
            </td>
            <td class="hrp-desc hrp-url" :title="r.front">{{ r.front || '—' }}</td>
            <td class="hrp-nowrap hrp-desc">
              {{ timeOf(r.at) }}
              <div v-if="r.presenceAgeMs !== undefined" class="hrp-age">心跳 {{ ageText(r.presenceAgeMs) }}</div>
            </td>
            <td class="hrp-nowrap hrp-act">
              <button class="hrp-mini" :disabled="busy === r.name || !r.front" @click="onReinstall(r)">
                <RotateCcw :size="13" /> 重装
              </button>
              <button class="hrp-mini danger" :disabled="busy === r.name" @click="onUninstall(r)">
                <Trash2 :size="13" /> 卸载
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="6" class="hrp-empty">
              还没有调试插件。在插件包里跑 <code>pnpm watch</code>，构建一次后会自动出现在这里。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.hrp { display: flex; flex-direction: column; gap: 12px; }
.hrp-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.hrp-hint { flex: 1 1 320px; margin: 0; font-size: 11px; line-height: 1.6; color: var(--ui-ink-dim, #6b7280); }
.hrp-count { font-size: 11px; color: var(--ui-ink-dim, #6b7280); }
.hrp-btn { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: var(--radius-control, 8px); background: transparent; color: var(--ui-ink, #18202b); font-size: 12px; font-weight: 600; cursor: pointer; }
.hrp-btn:hover:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.hrp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.hrp-error { margin: 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: var(--radius-control, 8px); font-size: 12px; color: var(--ui-danger, #ef4444); }
.hrp-table-wrap { display: flex; flex-direction: column; min-width: 0; overflow-x: auto; }
.hrp-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.hrp-table th { text-align: left; padding: 6px 8px; font-size: 11px; font-weight: 700; color: var(--ui-ink-dim, #6b7280); border-bottom: 1px solid var(--ui-line, #e2e5ea); white-space: nowrap; }
.hrp-table td { padding: 8px; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); vertical-align: middle; overflow: hidden; text-overflow: ellipsis; }
.hrp-table th:nth-child(1) { width: 20%; }
.hrp-table th:nth-child(2) { width: 10%; }
.hrp-table th:nth-child(3) { width: 14%; }
.hrp-table th:nth-child(4) { width: 30%; }
.hrp-table th:nth-child(5) { width: 16%; }
.hrp-table tbody tr:hover { background: var(--ui-hover, rgb(0 0 0 / 0.03)); }
.hrp-nowrap { white-space: nowrap; }
.hrp-name { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.hrp-desc { font-size: 11px; color: var(--ui-ink-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hrp-url { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.hrp-act { text-align: right; }
.hrp-th-act { text-align: right; }
.hrp-empty { padding: 20px 8px; text-align: center; color: var(--ui-ink-dim, #6b7280); }
.hrp-empty code { padding: 1px 5px; border-radius: var(--radius-badge, 6px); background: var(--ui-veil, rgb(0 0 0 / 0.04)); font-size: 11px; }
.hrp-badge { display: inline-block; padding: 2px 6px; border-radius: var(--radius-badge, 6px); font-size: 10px; font-weight: 700; }
.hrp-badge.is-on { color: var(--ui-accent-hover, #0e7490); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.hrp-badge.is-off { color: var(--ui-ink-dim, #6b7280); background: var(--ui-veil, rgb(0 0 0 / 0.04)); }
.hrp-badge.is-warn { color: var(--ui-warn, #b45309); background: var(--ui-warn-soft, rgb(245 158 11 / 0.16)); }
.hrp-badge.is-err { color: var(--ui-danger, #ef4444); background: var(--ui-danger-soft, rgb(239 68 68 / 0.1)); }
.hrp-badge.is-info { color: var(--ui-accent, #0891b2); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.hrp-warn { margin-left: 5px; padding: 1px 6px; border-radius: var(--radius-badge, 6px); background: var(--ui-warn-soft, rgb(245 158 11 / 0.16)); color: var(--ui-warn, #b45309); font-size: 10px; font-weight: 700; }
.hrp-age { margin-top: 2px; font-size: 10px; color: var(--ui-ink-faint, #9ca3af); }
.hrp-row-err { margin-top: 2px; font-size: 11px; color: var(--ui-danger, #ef4444); }
.hrp-mini { display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 9px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: var(--radius-control, 8px); background: transparent; color: var(--ui-ink, #18202b); font-size: 11px; cursor: pointer; white-space: nowrap; }
.hrp-mini:hover:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.hrp-mini:disabled { opacity: 0.45; cursor: not-allowed; }
.hrp-mini.danger { color: var(--ui-danger, #ef4444); }
.spin { animation: hrp-spin 0.9s linear infinite; }
@keyframes hrp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>

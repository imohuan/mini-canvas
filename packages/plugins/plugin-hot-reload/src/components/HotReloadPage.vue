<script setup lang="ts">
/**
 * HotReloadPage —— 「热重载」设置分类的整页。
 *
 * 干什么：**手动登记几条链接，产物一变就自动重装插件**。地址可以各不相同（本机 cloud-server、
 * 别的端口、vite dev server 都行），一条链接覆盖一个源（vite 源支持该源下多个插件/组件）。
 *
 * 数据与动作全在共享的 HotReload 单例里（`window.MiniCanvasHotReload`，见 plugin-hot-reload 的
 * data/hotReload.ts）；本组件只负责画与转发。
 *
 * 两种来源：
 * - **SSE**：cloud-server 的 /api/plugin-events —— 它盯本机插件产物目录，变了就推，事件带插件名。
 * - **Vite**：插件自己起的 dev server —— 连它的 HMR，一次覆盖该源下所有插件/组件。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { Zap, Plus, Trash2, RefreshCw, Radio, Boxes, Play, AlertTriangle, Check } from 'lucide-vue-next'
import type { HotReload, HotReloadSource } from '../data/hotReload'

const props = defineProps<{
  /** 共享的热重载单例（宿主注入；缺省从 window 取） */
  manager?: HotReload
}>()

/** 取单例：props 优先，其次 window.MiniCanvasHotReload（宿主挂的），最后退化成一个不连的壳 */
const mgr: HotReload | undefined =
  props.manager ?? (globalThis as unknown as { MiniCanvasHotReload?: HotReload }).MiniCanvasHotReload

const st = mgr?.state
/** 用 reactive 包一层，让界面跟着 state 变（数据层不依赖 Vue） */
const view = reactive({
  sources: [] as HotReloadSource[],
  logs: [] as typeof st extends undefined ? never[] : NonNullable<typeof st>['logs'],
})

// 新增一行用的草稿
const draft = reactive({ url: '', label: '' })
const error = ref('')

const isVite = (s: HotReloadSource): boolean => s.type === 'vite'

/** 加一条源（地址必填；名字缺省按地址生成） */
function onAdd(): void {
  error.value = ''
  const url = draft.url.trim()
  if (!url) {
    error.value = '请先填一个链接（如 http://127.0.0.1:8865/api/plugin-events）'
    return
  }
  if (!mgr) {
    error.value = '热重载管理器不可用（宿主没挂 window.MiniCanvasHotReload）'
    return
  }
  mgr.addSource({ url, label: draft.label.trim(), type: guess(url), enabled: true })
  draft.url = ''
  draft.label = ''
  sync()
}

/** 由地址猜来源类型：带 /@vite/client 或就是个裸 host:port → vite；否则 SSE */
function guess(url: string): 'sse' | 'vite' {
  return /\/@vite\/client($|\?)/.test(url) || /:\d+\/?$/.test(url) ? 'vite' : 'sse'
}

function onRemove(id: number): void {
  mgr?.removeSource(id)
  sync()
}

function onToggle(s: HotReloadSource): void {
  mgr?.updateSource(s.id, { enabled: !s.enabled })
  sync()
}

function onType(s: HotReloadSource, type: 'sse' | 'vite'): void {
  mgr?.updateSource(s.id, { type })
  sync()
}

/** 手动重装一个插件（输入插件名或地址） */
const manualTarget = ref('')
const manualBusy = ref(false)
async function onManualReload(): Promise<void> {
  const t = manualTarget.value.trim()
  if (!t || !mgr) return
  manualBusy.value = true
  error.value = ''
  try {
    await mgr.reload(t)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    manualBusy.value = false
  }
}

function sync(): void {
  if (!st) return
  view.sources = [...st.sources]
  view.logs = [...st.logs]
}

onMounted(() => {
  sync()
  // 打开页面时把已存的源接上（早先可能没连）
  mgr?.reconnect()
  sync()
})

const enabledCount = computed(() => view.sources.filter((s) => s.enabled).length)

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString()
}
function logTone(action: string): string {
  if (action === 'error') return 'err'
  if (action === 'reload') return 'ok'
  return 'dim'
}
</script>

<template>
  <div class="hr">
    <p v-if="!mgr" class="hr-error" role="alert">
      <AlertTriangle :size="13" /> 热重载管理器不可用（宿主应挂 window.MiniCanvasHotReload；
      见 packages/ui 的 hotReloadPlugin）。
    </p>

    <!-- 新增一条 -->
    <section class="hr-card">
      <header class="hr-head"><Plus :size="15" /><h4>新增链接</h4></header>
      <p class="hr-desc">
        填一条地址，产物一变就自动重装。地址可以各不相同：本机 cloud-server（<code>/api/plugin-events</code>）、
        别的端口、或插件自己起的 <b>vite dev server</b>（那条一次覆盖该源下所有插件/组件）。
      </p>
      <div class="hr-row">
        <input v-model="draft.url" class="hr-input hr-input--grow" type="text" spellcheck="false"
          aria-label="链接地址" placeholder="http://127.0.0.1:8865/api/plugin-events 或 http://localhost:5311"
          @keydown.enter.prevent="onAdd" />
        <input v-model="draft.label" class="hr-input" type="text" spellcheck="false" aria-label="备注名（可选）"
          placeholder="备注名（可选）" @keydown.enter.prevent="onAdd" />
        <button class="hr-btn hr-btn--primary" type="button" @click="onAdd"><Plus :size="14" /> 添加</button>
      </div>
      <p v-if="error" class="hr-error" role="alert"><AlertTriangle :size="13" /> {{ error }}</p>
    </section>

    <!-- 已登记的源 -->
    <section class="hr-card">
      <header class="hr-head"><Radio :size="15" /><h4>已监听（{{ enabledCount }} / {{ view.sources.length }} 启用）</h4>
        <button class="hr-btn hr-btn--mini" type="button" title="重新连接全部" @click="mgr?.reconnect(); sync()">
          <RefreshCw :size="13" /> 重连
        </button>
      </header>

      <div v-if="!view.sources.length" class="hr-empty">还没有监听任何链接 —— 在上面填一条。</div>

      <ul v-else class="hr-list">
        <li v-for="s in view.sources" :key="s.id" class="hr-item">
          <button class="hr-switch" :class="{ on: s.enabled }" role="switch" :aria-checked="s.enabled"
            :aria-label="(s.enabled ? '停用' : '启用') + ' ' + (s.label || s.url)" @click="onToggle(s)">
            <span class="hr-switch-dot"></span>
          </button>
          <div class="hr-item-main">
            <div class="hr-item-top">
              <strong class="hr-item-label">{{ s.label || '(未命名)' }}</strong>
              <span class="hr-tag" :class="s.type"><component :is="s.type === 'vite' ? Boxes : Radio" :size="11" />
                {{ s.type === 'vite' ? 'Vite' : 'SSE' }}</span>
            </div>
            <code class="hr-item-url">{{ s.url }}</code>
          </div>
          <div class="hr-item-actions">
            <button class="hr-btn hr-btn--mini" type="button"
              :title="s.type === 'sse' ? '切到 Vite' : '切到 SSE'"
              @click="onType(s, isVite(s) ? 'sse' : 'vite')">
              <component :is="isVite(s) ? Radio : Boxes" :size="13" />
            </button>
            <button class="hr-btn hr-btn--mini danger" type="button" title="删除" @click="onRemove(s.id)">
              <Trash2 :size="13" />
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- 手动重装 -->
    <section class="hr-card">
      <header class="hr-head"><Zap :size="15" /><h4>手动重装一次</h4></header>
      <p class="hr-desc">不靠监听，直接重装某个插件（填插件名、目录名或产物地址）。</p>
      <div class="hr-row">
        <input v-model="manualTarget" class="hr-input hr-input--grow" type="text" spellcheck="false"
          aria-label="插件名或地址" placeholder="style-library / plugin-style-library / /plugins/…/x.js"
          @keydown.enter.prevent="onManualReload" />
        <button class="hr-btn" type="button" :disabled="manualBusy" @click="onManualReload">
          <Play :size="13" /> {{ manualBusy ? '重装中' : '重装' }}
        </button>
      </div>
    </section>

    <!-- 日志 -->
    <section class="hr-card">
      <header class="hr-head"><Check :size="15" /><h4>最近发生</h4>
        <button class="hr-btn hr-btn--mini" type="button" @click="mgr?.clearLogs(); sync()">清空</button>
      </header>
      <div v-if="!view.logs.length" class="hr-empty">还没有记录。</div>
      <ul v-else class="hr-logs">
        <li v-for="(l, i) in view.logs.slice(0, 60)" :key="i" class="hr-log" :class="logTone(l.action)">
          <span class="hr-log-time">{{ fmtTime(l.at) }}</span>
          <span class="hr-log-src">{{ l.sourceLabel || ('#' + l.sourceId) }}</span>
          <span class="hr-log-act">{{ l.action }}</span>
          <span class="hr-log-detail">{{ l.detail }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.hr { display: flex; flex-direction: column; gap: 12px; }
.hr-card { border: 1px solid var(--ui-line, #e2e5ea); border-radius: 12px; background: var(--ui-panel, #fff); padding: 14px 16px; }
.hr-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; color: var(--ui-ink, #18202b); }
.hr-head h4 { margin: 0; font-size: 13px; font-weight: 700; }
.hr-head .hr-btn--mini { margin-left: auto; }
.hr-desc { margin: 0 0 12px; font-size: 12px; line-height: 1.7; color: var(--ui-ink-dim, #6b7280); }
.hr-desc code { padding: 1px 5px; border-radius: 4px; background: var(--ui-veil, rgb(0 0 0 / 0.05)); font-size: 11px; }
.hr-desc b { color: var(--ui-ink, #18202b); }
.hr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hr-input { height: 32px; min-width: 140px; padding: 0 10px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: var(--ui-panel, #fff); color: var(--ui-ink, #18202b); font-size: 12px; outline: none; box-sizing: border-box; }
.hr-input--grow { flex: 1; min-width: 240px; }
.hr-input:focus-visible { border-color: var(--ui-accent, #0891b2); outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.hr-btn { display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 8px; background: transparent; color: var(--ui-ink, #18202b); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background 0.18s ease; }
.hr-btn:hover:not(:disabled) { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.hr-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.hr-btn--primary { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent, #0891b2); color: var(--ui-primary-ink, #fff); }
.hr-btn--primary:hover:not(:disabled) { background: var(--ui-accent-hover, #0e7490); }
.hr-btn--mini { height: 26px; padding: 0 8px; font-size: 11px; }
.hr-btn--mini.danger { color: var(--ui-danger, #ef4444); }
.hr-btn:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

.hr-error { display: flex; align-items: center; gap: 5px; margin: 10px 0 0; font-size: 12px; color: var(--ui-danger, #ef4444); }
.hr-empty { padding: 14px 4px; font-size: 12px; color: var(--ui-ink-mute, #8c95a3); }

.hr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.hr-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--ui-line-soft, #eef0f4); border-radius: 10px; background: var(--ui-panel-soft, rgb(0 0 0 / 0.02)); }
.hr-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.hr-item-top { display: flex; align-items: center; gap: 8px; }
.hr-item-label { font-size: 12px; font-weight: 600; color: var(--ui-ink, #18202b); }
.hr-item-url { font-size: 11px; color: var(--ui-ink-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-item-actions { display: flex; gap: 4px; flex: none; }

.hr-tag { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: 6px; font-size: 10px; font-weight: 700; }
.hr-tag.sse { color: var(--ui-accent-hover, #0e7490); background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.hr-tag.vite { color: var(--ui-warn, #b45309); background: var(--ui-warn-soft, rgb(245 158 11 / 0.16)); }

.hr-switch { flex: none; width: 34px; height: 20px; border: 1px solid var(--ui-line, #e2e5ea); border-radius: 999px; background: var(--ui-hover-strong, rgb(0 0 0 / 0.1)); cursor: pointer; position: relative; transition: background 0.18s ease, border-color 0.18s ease; }
.hr-switch.on { background: var(--ui-accent, #0891b2); border-color: var(--ui-accent, #0891b2); }
/* 滑块圆点用主题的"面板色"（亮色下是白、暗色下是深灰）——不写死 #fff，暗色主题下才不会突兀 */
.hr-switch-dot { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--ui-panel, #ffffff); transition: transform 0.18s ease; }
.hr-switch.on .hr-switch-dot { transform: translateX(14px); }
.hr-switch:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

.hr-logs { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.hr-log { display: flex; align-items: baseline; gap: 8px; font-size: 11px; padding: 3px 0; border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.hr-log-time { flex: none; color: var(--ui-ink-mute, #8c95a3); font-family: ui-monospace, monospace; }
.hr-log-src { flex: none; color: var(--ui-ink-dim, #6b7280); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hr-log-act { flex: none; font-weight: 700; }
.hr-log.ok .hr-log-act { color: var(--ui-accent-hover, #0e7490); }
.hr-log.err .hr-log-act { color: var(--ui-danger, #ef4444); }
.hr-log.dim .hr-log-act { color: var(--ui-ink-mute, #8c95a3); }
.hr-log-detail { min-width: 0; color: var(--ui-ink-dim, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .hr-btn, .hr-switch, .hr-switch-dot { transition: none !important; }
}
</style>

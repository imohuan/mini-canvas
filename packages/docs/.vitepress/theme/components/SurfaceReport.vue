<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * 活快照：把「当前这台画布上注册了什么」直接摊出来。
 *
 * 数据来源按优先级依次尝试，第一个成功即用：
 *   1. 传了 url → 直接 fetch（后台的快照接口、或自建 JSON）；
 *   2. 同页跑着画布应用（window.MiniCanvasUI / window.MiniCanvas）→ 当场调 ctx.surface()；
 *   3. 仓库存的快照文件 public/surface-snapshot.json —— **真实采集**、随仓库走，
 *      页面因此永远有真数据可看；想更新就用「重新采集」下载当次快照、覆盖这个文件。
 *
 * 为什么不直接跨源读运行中的应用：浏览器不允许跨源（或跨标签页）读别的窗口的全局变量，
 * 实测报 "Blocked a frame ... from accessing a cross-origin frame"。
 * 所以"看实时"要么同源注入，要么由后台把快照转成 JSON 下发，两者都需要一点配合。
 *
 * 所以：本地开着画布应用时，这一页显示的就是**你那台画布的真实情况**，不是示例数据。
 */
const props = withDefaults(
  defineProps<{
    url?: string
    /** 运行中应用暴露 API 的全局名（ui 应用用 MiniCanvasUI，裸宿主用 MiniCanvas） */
    windowKey?: string
    /** 额外探测的候选地址（顺序即优先级）；传空数组可关掉自动探测 */
    autoProbe?: string[]
  }>(),
  {
    windowKey: 'MiniCanvasUI',
    // 只试同源桥。/mcapp 由 dev server 代理到本机画布应用（cloud-server :8865）。
   // 想换成别的地址（例如后台的快照接口）就传 autoProbe 覆盖它。
    // 兜底数据源：仓库存的真实快照（随仓库走，保证这一页永远有真数据）。
    // 想换成后台接口 / 其它地址就传 autoProbe 覆盖它。
    autoProbe: () => ['/surface-snapshot.json'],
  },
)

interface ServiceSurface {
  name: string
  source: string
  methods?: string[]
}
interface RegistryKindSurface {
  kind: string
  keys: Array<{ key: string; count: number }>
}
interface RegistryEntrySurface {
  kind: string
  key: string
  id: string
  order: number
  source: string
  fields?: string[]
}
interface CommandSurface {
  id: string
  title?: string
  keys?: string[]
  group?: string
  source: string
  origin: 'field' | 'service'
}
interface ToolSurface {
  name: string
  title?: string
  description?: string
  group?: string
}
interface PluginStatus {
  name: string
  state: string
  core?: boolean
  missingDeps?: string[]
}
interface Report {
  state?: string
  /** 快照采集时间（内置快照文件里带的） */
  capturedAt?: string
  services?: ServiceSurface[]
  registries?: RegistryKindSurface[]
  registryEntries?: RegistryEntrySurface[]
  commands?: CommandSurface[]
  tools?: ToolSurface[]
  modelTools?: Array<{ name: string }>
  events?: string[]
  plugins?: PluginStatus[]
}

const status = ref<'loading' | 'ok' | 'error'>('loading')
const errorMsg = ref('')
const source = ref('')
const report = ref<Report>({})
const tab = ref<'plugins' | 'services' | 'registries' | 'tree' | 'commands' | 'tools' | 'events'>('plugins')
/** 探测失败过的地址（错误提示里列出来，方便排查） */
const tried = ref<string[]>([])
/** 快照采集时间（内置快照才带；实时读时为采集那一刻） */
const capturedAt = ref('')

const w = (): any => globalThis as any

/** 读一个"已就绪的 API 门面"：自带 getContext + surface 才算数 */
function readFromApi(api: any): Report | null {
  if (!api?.getContext) return null
  const ctx = api.getContext()
  if (!ctx?.surface) return null
  return { ...ctx.surface(), plugins: ctx.inspectPlugins?.() }
}

/** 从某个地址 fetch 一份快照 JSON（快照文件 / 后台接口都走这条） */
async function fetchReport(url: string): Promise<Report> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const raw = await res.json()
  // 快照文件是 { capturedAt, source, ...surface, plugins }；接口可能直接给 surface
  return raw && typeof raw === 'object' ? raw : {}
}

/** 「重新采集」：当前页跑着应用时，采一份快照并下载成 JSON（覆盖 public/surface-snapshot.json 即更新数据） */
function recapture() {
  const direct = readFromApi(w()[props.windowKey] ?? w().MiniCanvas)
  if (!direct) {
    errorMsg.value = '当前页没有运行中的画布应用，采不了新快照（' + w().location?.href + '）'
    status.value = 'error'
    return
  }
  const snap = { capturedAt: new Date().toISOString(), source: 'window.MiniCanvasUI.getContext().surface()', ...direct }
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'surface-snapshot.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function load() {
  status.value = 'loading'
  errorMsg.value = ''
  tried.value = []
  try {
    let r: Report
    if (props.url) {
      source.value = props.url
      r = await fetchReport(props.url)
    } else {
      // ① 优先：同页就挂着的 API（文档站与画布应用同源同页时才成立）
      const direct = readFromApi(w()[props.windowKey] ?? w().MiniCanvas)
      if (direct) {
        source.value = '实时 · window.' + props.windowKey + '.getContext().surface()'
        r = direct
      } else {
        // ② 退一步：读仓库存的真实快照（autoProbe 可覆盖成后台接口）
        let got: Report | null = null
        for (const url of props.autoProbe ?? []) {
          tried.value.push(url)
          try {
            got = await fetchReport(url)
            source.value = '内置快照 · ' + url
            if (got?.capturedAt) capturedAt.value = String(got.capturedAt)
            break
          } catch {
            /* 试下一个 */
          }
        }
        if (!got) {
          throw new Error('读不到快照（没传 url、同页也没有 window.' + props.windowKey + '）')
        }
        r = got
      }
    }
    report.value = r
    status.value = 'ok'
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    status.value = 'error'
  }
}

onMounted(load)

const counts = computed(() => ({
  plugins: report.value.plugins?.length ?? 0,
  services: report.value.services?.length ?? 0,
  kinds: report.value.registries?.length ?? 0,
  entries: report.value.registryEntries?.length ?? 0,
  commands: report.value.commands?.length ?? 0,
  tools: report.value.tools?.length ?? 0,
  events: report.value.events?.length ?? 0,
}))

/** 按插件名归拢：这个插件往各注册场放了多少条 */
const bySource = computed(() => {
  const m = new Map<string, { entries: number; kinds: Set<string> }>()
  for (const e of report.value.registryEntries ?? []) {
    const cur = m.get(e.source) ?? { entries: 0, kinds: new Set<string>() }
    cur.entries++
    cur.kinds.add(e.kind)
    m.set(e.source, cur)
  }
  return [...m.entries()].sort((a, b) => b[1].entries - a[1].entries)
})

/** 会注入服务的插件（从 services 的 source 反推） */
const providedBy = computed(() => {
  const m = new Map<string, string[]>()
  for (const s of report.value.services ?? []) {
    const arr = m.get(s.source) ?? []
    arr.push(s.name)
    m.set(s.source, arr)
  }
  return [...m.entries()].sort()
})

const stateBadgeClass = (s: string) =>
  s === 'active' ? 'mc-badge mc-badge--on' : s === 'failed' ? 'mc-badge mc-badge--bad' : 'mc-badge'
</script>

<template>
  <div class="mc-live">
    <div class="mc-plugin-toolbar">
      <span class="mc-badge">数据源 {{ source || '（未取到）' }}</span>
      <span v-if="capturedAt" class="mc-badge">采集于 {{ capturedAt.replace('T', ' ').slice(0, 19) }}</span>
      <button class="mc-preview__btn" @click="load">刷新</button>
      <button class="mc-preview__btn" title="把当前运行中的画布采一份快照并下载（用来更新 public/surface-snapshot.json）" @click="recapture">
        重新采集
      </button>
    </div>

    <div v-if="status === 'loading'" class="mc-empty">正在读取画布的自省快照…</div>

    <div v-else-if="status === 'error'" class="mc-empty">
      <p>读不到：{{ errorMsg }}</p>
      <p v-if="tried.length" class="mc-dim">试过这些地址：{{ tried.join('、') }}</p>
      <p>正常情况下这一页会显示内置的真实快照（public/surface-snapshot.json）。<br />
      没看到数据，多半是快照文件没随站点发布 —— 检查它是否在 public/ 下。</p>
    </div>

    <template v-else>
      <div class="mc-stat-row">
        <div class="mc-stat"><b>{{ counts.plugins }}</b><span>插件</span></div>
        <div class="mc-stat"><b>{{ counts.services }}</b><span>服务</span></div>
        <div class="mc-stat"><b>{{ counts.kinds }}</b><span>注册场种类</span></div>
        <div class="mc-stat"><b>{{ counts.entries }}</b><span>场条目</span></div>
        <div class="mc-stat"><b>{{ counts.commands }}</b><span>命令</span></div>
        <div class="mc-stat"><b>{{ counts.tools }}</b><span>生成工具</span></div>
        <div class="mc-stat"><b>{{ counts.events }}</b><span>事件名</span></div>
      </div>

      <div class="mc-tabs">
        <button
          v-for="t in ([
            ['plugins', '插件'],
            ['tree', '谁放了什么'],
            ['services', '服务'],
            ['registries', '注册场'],
            ['commands', '命令'],
            ['tools', '生成工具'],
            ['events', '事件'],
          ] as const)"
          :key="t[0]"
          :class="['mc-tab', { 'mc-tab--on': tab === t[0] }]"
          @click="tab = t[0]"
        >
          {{ t[1] }}
        </button>
      </div>

      <!-- 插件 -->
      <table v-if="tab === 'plugins'" class="mc-table">
        <thead><tr><th>插件名</th><th>状态</th><th>类型</th><th>缺依赖</th></tr></thead>
        <tbody>
          <tr v-for="p in report.plugins" :key="p.name">
            <td class="mc-code">{{ p.name }}</td>
            <td><span :class="stateBadgeClass(p.state)">{{ p.state }}</span></td>
            <td>{{ p.core ? '核心' : '业务' }}</td>
            <td>{{ p.missingDeps?.length ? p.missingDeps.join(', ') : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 谁放了什么 -->
      <div v-else-if="tab === 'tree'">
        <table class="mc-table">
          <thead><tr><th>来源（谁）</th><th>放了多少条</th><th>用了哪些注册场</th></tr></thead>
          <tbody>
            <tr v-for="[src, info] in bySource" :key="src">
              <td class="mc-code">{{ src }}</td>
              <td>{{ info.entries }}</td>
              <td>{{ [...info.kinds].join(' / ') }}</td>
            </tr>
          </tbody>
        </table>
        <h4>这些插件提供了服务</h4>
        <table class="mc-table">
          <thead><tr><th>来源（谁）</th><th>提供了哪些服务</th></tr></thead>
          <tbody>
            <tr v-for="[src, names] in providedBy" :key="'s-' + src">
              <td class="mc-code">{{ src }}</td>
              <td>{{ names.join(', ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 服务 -->
      <table v-else-if="tab === 'services'" class="mc-table">
        <thead><tr><th>服务名</th><th>谁提供的</th><th>方法</th></tr></thead>
        <tbody>
          <tr v-for="s in report.services" :key="s.name">
            <td class="mc-code">{{ s.name }}</td>
            <td>{{ s.source }}</td>
            <td class="mc-dim">{{ (s.methods ?? []).join(', ') || '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 注册场 -->
      <div v-else-if="tab === 'registries'">
        <table class="mc-table">
          <thead><tr><th>种类</th><th>键数</th><th>条目数</th><th>键明细</th></tr></thead>
          <tbody>
            <tr v-for="k in report.registries" :key="k.kind">
              <td class="mc-code">{{ k.kind }}</td>
              <td>{{ k.keys.length }}</td>
              <td>{{ k.keys.reduce((n, x) => n + x.count, 0) }}</td>
              <td class="mc-dim">
                <span v-for="x in k.keys" :key="x.key" class="mc-keychip">
                  {{ x.key }}<i v-if="x.count > 1">×{{ x.count }}</i>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 命令 -->
      <table v-else-if="tab === 'commands'" class="mc-table">
        <thead><tr><th>命令 id</th><th>来源</th><th>快捷键</th><th>分组</th><th>注册路径</th></tr></thead>
        <tbody>
          <tr v-for="c in report.commands" :key="c.id + c.origin">
            <td class="mc-code">{{ c.id }}</td>
            <td>{{ c.source }}</td>
            <td>{{ (c.keys ?? []).join(', ') || '—' }}</td>
            <td>{{ c.group || '—' }}</td>
            <td>{{ c.origin }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 生成工具 -->
      <table v-else-if="tab === 'tools'" class="mc-table">
        <thead><tr><th>工具名</th><th>标题</th><th>分组</th></tr></thead>
        <tbody>
          <tr v-for="t in report.tools" :key="t.name">
            <td class="mc-code">{{ t.name }}</td>
            <td>{{ t.title || '—' }}</td>
            <td>{{ t.group || '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 事件 -->
      <div v-else-if="tab === 'events'" class="mc-chipbox">
        <span v-for="e in report.events" :key="e" class="mc-badge">{{ e }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mc-live {
  margin: 16px 0;
}
.mc-stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0;
}
.mc-stat {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 8px 14px;
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  min-width: 84px;
}
.mc-stat b {
  font-size: 18px;
}
.mc-stat span {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.mc-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0;
}
.mc-tab {
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 4px 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
}
.mc-tab--on {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.mc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  display: table;
}
.mc-table th,
.mc-table td {
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}
.mc-table th {
  color: var(--vp-c-text-2);
  font-weight: 600;
}
.mc-dim {
  color: var(--vp-c-text-2);
}
.mc-keychip {
  display: inline-block;
  margin: 0 6px 4px 0;
  padding: 2px 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}
.mc-keychip i {
  color: var(--vp-c-brand-1);
  font-style: normal;
  margin-left: 3px;
}
.mc-chipbox {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>

<script setup lang="ts">
/**
 * ShowcasePage —— 面板主体（附录 B 的五区块）。
 *
 * ③ 在线测试台：分组与端点全部来自 GET /api/showcase/endpoints（动态索引），
 *    每条端点一个「运行」按钮；按 method+path 记结果；PUT/DELETE 的 :id 走"真实取值链"
 *    （先 GET/POST 拿真 id，写死 id 一重启就 404 —— 附录 B.9 的坑）。
 * 代码块 = 在线文档：每组折叠一段 fetch 示例，看文档即测试。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { apiUrl, resolveApiBase, showcaseHeaders } from '../apiBase'
import { useCanvasRender } from '@mini-canvas/canvas-render'

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
}
interface EndpointGroup {
  id: string
  label: string
  description: string
  endpoints: Endpoint[]
}
interface RunResult {
  state: 'ok' | 'fail' | 'running'
  httpStatus?: number
  requestBody?: string
  responseBody?: string
  error?: string
  at?: string
}

// ===== 状态（附录 B.1 的形状） =====
const meta = ref<Record<string, unknown> | null>(null)
const groups = ref<EndpointGroup[]>([])
const results = reactive<Record<string, RunResult>>({})
const fetchingIndex = ref(false)
const indexError = ref<string | undefined>()
const selfTest = reactive({ scriptLoaded: true, globalPresent: true, mounted: false })
const jobsTicks = ref<number | undefined>()
let jobsPollTimer: ReturnType<typeof setInterval> | undefined

// 后台半在哪：同源托管时为空串；独立界面（跨源）时读"服务地址"配置。见 apiBase.ts 的说明。
const ctx = useCanvasRender().ctx
const apiBase = resolveApiBase(ctx)

/** 把"后台返回了 HTML（多半是地址不对或后台半没生效）"翻成人话 */
function friendlyError(raw: string): string {
  if (/Unexpected token '<'|<!doctype|not valid JSON/i.test(raw)) {
    return (
      '后台没应答 JSON（收到的是网页）。两种可能：① 画布界面不是由 cloud-server 托管，需在' +
      '「设置 → 常规 → 云端客户端 → 服务地址」填 cloud-server 地址；② 后台半是重启才生效的，' +
      '重启 cloud-server 后再试。'
    )
  }
  return raw
}

const keyOf = (e: { method: string; path: string }): string => e.method + ' ' + e.path

const loadIndex = async (): Promise<void> => {
  fetchingIndex.value = true
  indexError.value = undefined
  try {
    const [metaRes, idxRes] = await Promise.all([
      fetch(apiUrl(apiBase, '/api/showcase/meta'), { headers: showcaseHeaders() }),
      fetch(apiUrl(apiBase, '/api/showcase/endpoints'), { headers: showcaseHeaders() }),
    ])
    if (!metaRes.ok || !idxRes.ok) throw new Error('后台接口不可达（meta ' + metaRes.status + ' / endpoints ' + idxRes.status + '）')
    meta.value = (await metaRes.json()) as Record<string, unknown>
    const idx = (await idxRes.json()) as { groups: EndpointGroup[] }
    groups.value = idx.groups
  } catch (err) {
    indexError.value = friendlyError(err instanceof Error ? err.message : String(err))
  } finally {
    fetchingIndex.value = false
  }
}

// ===== :id 真实取值链（附录 B.9）：PUT/DELETE 前先拿真 id =====
const ensureRealId = async (path: string): Promise<string | null> => {
  if (path.includes('todos/:id')) {
    const res = await fetch(apiUrl(apiBase, '/api/showcase/todos'), {
      method: 'POST',
      headers: showcaseHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ title: '演示条目（测试台自动创建）' }),
    })
    const body = (await res.json()) as { todo?: { id: string } }
    return body.todo?.id ?? null
  }
  if (path.includes('store/notes/:key')) return 'demo-key'
  return null
}

const defaultBody = (method: string, path: string): unknown => {
  if (method === 'GET' || method === 'DELETE') return undefined
  if (path.includes('/echo')) return { hello: 'showcase', n: 1 }
  if (path.includes('/todos') && method === 'POST') return { title: '手动创建的一条 todo' }
  if (path.includes('/todos') && method === 'PUT') return { done: true }
  if (path.includes('store/notes/:key')) return { note: '写在插件私有存储里的值', at: new Date().toISOString() }
  if (path.includes('jobs/heartbeat') && method === 'POST') return { intervalMs: 1000 }
  return undefined
}

const running = ref(false)
const runOne = async (e: Endpoint): Promise<void> => {
  const key = keyOf(e)
  results[key] = { state: 'running' }
  try {
    let path = e.path
    let body = defaultBody(e.method, path)
    if (path.includes(':id') || path.includes(':key')) {
      const id = await ensureRealId(path)
      if (id === null) throw new Error('取真实 id 失败（前置请求没拿到）')
      path = path.replace(/:id|:key/g, id)
    }
    const res = await fetch(apiUrl(apiBase, path), {
      method: e.method,
      // 写接口（POST/PUT/DELETE）要令牌；GET 带上也无害
      headers: body !== undefined ? showcaseHeaders({ 'content-type': 'application/json' }) : showcaseHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    results[key] = {
      state: res.ok ? 'ok' : 'fail',
      httpStatus: res.status,
      requestBody: body !== undefined ? JSON.stringify(body, null, 2) : undefined,
      responseBody: text,
      at: new Date().toLocaleTimeString(),
    }
    if (key === 'GET /api/showcase/jobs/heartbeat') syncJobsTicks(text)
  } catch (err) {
    results[key] = { state: 'fail', error: friendlyError(err instanceof Error ? err.message : String(err)) }
  }
}

const syncJobsTicks = (bodyText: string): void => {
  try {
    const j = JSON.parse(bodyText) as { ticks?: number }
    if (typeof j.ticks === 'number') jobsTicks.value = j.ticks
  } catch { /* 忽略非 JSON */ }
}

/** 运行一组：组内每条顺序执行（:id 链有依赖，不能并发） */
const runGroup = async (g: EndpointGroup): Promise<void> => {
  running.value = true
  try {
    for (const e of g.endpoints) await runOne(e)
  } finally {
    running.value = false
  }
}

const codeOf = (e: Endpoint): string => {
  const body = defaultBody(e.method, e.path)
  return 'await fetch(' + JSON.stringify(apiUrl(apiBase, e.path)) + ', {' +
    (e.method === 'GET' ? '' : "\n  method: '" + e.method + "',") +
    (body !== undefined ? "\n  headers: { 'content-type': 'application/json' }," +
      "\n  body: JSON.stringify(" + JSON.stringify(body) + '),' : '') +
    '\n})'
}

const startedAt = computed(() => {
  const v = meta.value?.startedAt
  return typeof v === 'string' ? new Date(v).toLocaleString() : ''
})

onMounted(async () => {
  // ① 前端自测（**真检测**，不是写死 true —— 审查指出旧版两盏灯是假的）：
  //  - scriptLoaded：UMD 全局对象挂上了没（挂上说明当初的 <script> 真的执行了）
  //  - globalPresent：宿主全局（Vue / MiniCanvasRender）在不在（缺了插件根本跑不到这里）
  //  - mounted：面板挂载（进 onMounted 本身就是证据；这里再校验一次 DOM 真的渲染了）
  const g = window as unknown as Record<string, unknown>
  selfTest.scriptLoaded = typeof g.MiniCanvasPluginShowcase !== 'undefined'
  selfTest.globalPresent = typeof g.MiniCanvasRender !== 'undefined' || typeof g.MiniCanvasBase !== 'undefined'
  // 挂载自测要等一帧（rootEl 的 ref 绑定与 DOM 插入发生在渲染后）
  await nextTick()
  selfTest.mounted = rootEl.value !== null && document.contains(rootEl.value)
  // 取"在线注册"演示用的注册场（插件 apply 时注入的服务）
  demoReg.value = (ctx.tryGet('showcase-demo') as { field: () => DemoField; fieldName: string } | undefined) ?? null
  refreshDemo()
  await loadIndex()
})

/** 面板根元素句柄（挂载自测用：确认它真的在文档里，不是"进 onMounted 就算过"） */
const rootEl = ref<HTMLElement | null>(null)

// ===== ④ 在线注册演示（注册场实时增删；卸载插件时这些注册会一起被回收） =====
interface DemoField {
  add(key: string, value: { label: string }, opts?: { id?: string }): { id: string; dispose(): void }
  remove(key: string, id: string): boolean
  list(key: string): Array<{ id: string; value: { label: string }; source: string }>
}
const demoReg = ref<{ field: () => DemoField; fieldName: string } | null>(null)
const demoItems = ref<Array<{ id: string; label: string; source: string }>>([])
const demoSeq = ref(0)
let demoDisposers: Array<() => void> = []

/** 读当前注册场内容（每次现读，注册场一变立刻反映） */
function refreshDemo(): void {
  const reg = demoReg.value
  if (!reg) return
  demoItems.value = reg.field().list(reg.fieldName).map((e) => ({ id: e.id, label: e.value.label, source: e.source }))
}

/** 运行期加一条（演示"注册场实时生效"） */
function addDemoItem(): void {
  const reg = demoReg.value
  if (!reg) return
  demoSeq.value += 1
  const handle = reg.field().add(reg.fieldName, { label: '演示项 #' + demoSeq.value }, { id: 'demo-' + demoSeq.value })
  demoDisposers.push(handle.dispose)
  refreshDemo()
}

/** 撤销最后加的一条（演示"移除即消失"） */
function removeLastDemoItem(): void {
  const dispose = demoDisposers.pop()
  if (dispose) dispose()
  refreshDemo()
}

onBeforeUnmount(() => {
  if (jobsPollTimer) clearInterval(jobsPollTimer)
})

const groupIcon = (id: string): string => {
  const map: Record<string, string> = {
    routes: '🛣', store: '📦', jobs: '⏱', mcp: '🤖', agent: '🧠',
  }
  return map[id] ?? '🔧'
}
</script>

<template>
  <div class="showcase-page" ref="rootEl">
    <!-- ① 前端自测区（三盏灯） -->
    <section class="sc-section">
      <h3>前端自测</h3>
      <div class="sc-lamps">
        <span class="sc-lamp" :class="{ ok: selfTest.scriptLoaded }">● UMD 脚本加载</span>
        <span class="sc-lamp" :class="{ ok: selfTest.globalPresent }">● 全局对象存在</span>
        <span class="sc-lamp" :class="{ ok: selfTest.mounted }">● 面板挂载成功</span>
      </div>
    </section>

    <!-- ② 后台名片 -->
    <section class="sc-section">
      <h3>后台名片</h3>
      <div v-if="meta" class="sc-meta">
        <div><b>{{ (meta as any).title }}</b> <code>v{{ (meta as any).version }}</code></div>
        <div class="sc-dim">{{ (meta as any).description }}</div>
        <div class="sc-dim">启动于 {{ startedAt }} · 能力：{{ ((meta as any).capabilities ?? []).join(' / ') }}</div>
      </div>
      <div v-else-if="indexError" class="sc-error">后台不可达：{{ indexError }}（外挂后台插件需重启生效）</div>
      <div v-else class="sc-dim">加载中…</div>
    </section>

    <!-- ③ 在线测试台 -->
    <section class="sc-section">
      <div class="sc-h3row">
        <h3>在线测试台</h3>
        <button class="sc-btn" :disabled="fetchingIndex" @click="loadIndex()">刷新索引</button>
      </div>
      <div v-if="indexError" class="sc-error">{{ indexError }}</div>
      <div v-for="g in groups" :key="g.id" class="sc-group">
        <div class="sc-group-head">
          <b>{{ groupIcon(g.id) }} {{ g.label }}</b>
          <span class="sc-dim">{{ g.description }}</span>
          <button class="sc-btn" :disabled="running" @click="runGroup(g)">运行整组</button>
        </div>
        <div v-for="e in g.endpoints" :key="keyOf(e)" class="sc-endpoint">
          <div class="sc-endpoint-head">
            <code class="sc-method" :class="e.method.toLowerCase()">{{ e.method }}</code>
            <code class="sc-path">{{ e.path }}</code>
            <button class="sc-btn" :disabled="results[keyOf(e)]?.state === 'running'" @click="runOne(e)">运行</button>
          </div>
          <div v-if="results[keyOf(e)]" class="sc-result" :class="results[keyOf(e)]!.state">
            <div v-if="results[keyOf(e)]!.error" class="sc-error">网络错误：{{ results[keyOf(e)]!.error }}</div>
            <template v-else>
              <span class="sc-badge" :class="results[keyOf(e)]!.state">
                {{ results[keyOf(e)]!.state === 'ok' ? '生效' : '失败' }} · HTTP {{ results[keyOf(e)]!.httpStatus }}
              </span>
              <span class="sc-dim">{{ results[keyOf(e)]!.at }}</span>
              <pre v-if="results[keyOf(e)]!.requestBody" class="sc-json">{{ results[keyOf(e)]!.requestBody }}</pre>
              <pre class="sc-json">{{ results[keyOf(e)]!.responseBody }}</pre>
            </template>
          </div>
          <details class="sc-doc">
            <summary>示例代码</summary>
            <pre class="sc-json">{{ codeOf(e) }}</pre>
          </details>
        </div>
      </div>
    </section>

    <!-- ④ 生命周期说明（静态，防误解） -->
    <!-- ④ 在线注册演示：运行期往注册场加/删条目，实时生效；卸载插件时这些一起被回收 -->
    <section class="sc-section">
      <div class="sc-h3row">
        <h3>在线注册演示</h3>
        <div class="sc-demo-btns">
          <button class="sc-btn" :disabled="!demoReg" @click="addDemoItem">注册一条</button>
          <button class="sc-btn" :disabled="!demoReg || !demoItems.length" @click="removeLastDemoItem">撤销最后一条</button>
          <button class="sc-btn" @click="refreshDemo">刷新</button>
        </div>
      </div>
      <p class="sc-dim">
        {{ demoReg ? '注册场：' + demoReg.fieldName + '（加/删立即生效；卸载本插件时这些注册会一起被回收）' : '注册场不可用（插件未注入 showcase-demo 服务）' }}
      </p>
      <ul v-if="demoItems.length" class="sc-notes">
        <li v-for="it in demoItems" :key="it.id"><code>{{ it.id }}</code> — {{ it.label }} <span class="sc-dim">(放置方 {{ it.source }})</span></li>
      </ul>
      <p v-else class="sc-dim">还没有注册项 —— 点上面的「注册一条」。</p>
    </section>

    <!-- ⑤ 生命周期说明（静态，防误解） -->
    <section class="sc-section">
      <h3>生效时机</h3>
      <ul class="sc-notes">
        <li>前端半（本面板）：<b>装上即生效</b>，卸载立即消失。</li>
        <li>后台半（API）：<b>装完即热载生效</b>（cloud-server 支持运行期装卸，无需重启）。</li>
        <li>私有存储：跨重启保留；<b>卸载插件即清空</b>。</li>
        <li>定时任务：内存态，重启后停止；store 里的计数保留（ticks 续算）。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.showcase-page { display: flex; flex-direction: column; gap: 20px; }
.sc-section { border: 1px solid var(--ui-line, rgba(128,128,128,.25)); border-radius: 10px; padding: 14px 16px; }
.sc-section h3 { margin: 0 0 10px; font-size: 14px; }
.sc-h3row { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.sc-lamps { display: flex; gap: 16px; flex-wrap: wrap; }
.sc-lamp { font-size: 12px; color: var(--ui-danger, #e24444); }
.sc-lamp.ok { color: var(--ui-accent, #0891b2); }
.sc-meta { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.sc-dim { color: var(--ui-dim, #8a8a8a); font-size: 12px; }
.sc-error { color: var(--ui-danger, #e24444); font-size: 12px; }
.sc-group { border-top: 1px dashed var(--ui-line, rgba(128,128,128,.2)); padding-top: 10px; margin-top: 10px; }
.sc-group-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; margin-bottom: 8px; }
.sc-endpoint { margin: 8px 0 12px; }
.sc-endpoint-head { display: flex; align-items: center; gap: 8px; }
.sc-method { font-weight: 700; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--ui-hover, rgba(128,128,128,.15)); }
.sc-method.get { color: var(--ui-accent, #0891b2); }
.sc-method.post, .sc-method.put, .sc-method.delete { color: var(--ui-warn, #e3a25f); }
.sc-path { font-size: 12px; opacity: .9; }
.sc-btn { font-size: 12px; padding: 2px 10px; border-radius: 6px; border: 1px solid var(--ui-line, rgba(128,128,128,.3)); background: transparent; color: inherit; cursor: pointer; margin-left: auto; }
.sc-btn:disabled { opacity: .5; cursor: default; }
.sc-result { margin-top: 6px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.sc-badge { align-self: flex-start; font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.sc-badge.ok { color: var(--ui-accent, #0891b2); background: color-mix(in srgb, var(--ui-accent, #0891b2) 12%, transparent); }
.sc-badge.fail { color: var(--ui-danger, #e24444); background: color-mix(in srgb, var(--ui-danger, #e24444) 12%, transparent); }
.sc-json { margin: 2px 0 0; padding: 8px; border-radius: 6px; background: var(--ui-code-bg, rgba(128,128,128,.1)); font-size: 11px; max-height: 180px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
.sc-doc summary { font-size: 12px; color: var(--ui-dim, #8a8a8a); cursor: pointer; margin-top: 4px; }
.sc-notes { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.9; }
.sc-demo-btns { display: flex; gap: 6px; }
.sc-demo-btns .sc-btn { margin-left: 0; }
</style>

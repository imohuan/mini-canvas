<script setup lang="ts">
/**
 * HtmlPanelFrame —— 把 provider 自带的一段 HTML 画在底栏里。
 *
 * 为什么用 iframe 而不是 v-html：这段 HTML 来自**后台的 js 文件**，和我们不是一份代码。
 * 它带的样式可能撞主题、脚本也可能乱跑；iframe 把它关在自己的文档里，划得清边界。
 *
 * 安全取舍：`sandbox="allow-scripts"`，**不给 allow-same-origin**。
 * 这样它拿不到画布的 localStorage、cookie 和 DOM，只能通过下面这套 postMessage 通行。
 *
 * 通信协议（两边都只认自己那一个 window）：
 *   宿主 → 面板  { type:'canvas:panel:init', values, params, model, nodeType, disabled, theme }
 *               { type:'canvas:panel:update', values, disabled }  参数在别处被改 / 开始生成
 *   面板 → 宿主  { type:'canvas:panel:set-values', values }     改参数（可一次改多个）
 *               { type:'canvas:panel:run' }                      点发送
 *               { type:'canvas:panel:resize', height }           自己报高度
 *               { type:'canvas:panel:notify', level, message }   提示一句
 *
 * 面板里拿 `window.api` 即可（见注入的桥接脚本），不用自己写 postMessage。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** provider 给的 HTML 正文（可含 <style> / <script>） */
    html: string
    /** 当前参数值 */
    values?: Record<string, unknown>
    /** 参数定义（下拉有哪些选项） */
    params?: readonly unknown[]
    /** 当前动作 id / 名字 */
    actionId?: string
    model?: string
    nodeType?: string
    disabled?: boolean
    /** 主题相关的几个值（iframe 拿不到外层 CSS 变量，只能传进来） */
    theme?: Record<string, string>
    /** 默认高度上限（px）：到上限后交给外部滚动容器；无限高就传 Infinity */
    maxHeight?: number
    /**
     * 是否**自己滚**。
     * false（默认）= 不限高，把内容真实高度报给外面，由外面的 ScrollArea 滚；
     * true = 面板自己滚（没有输入框、直接占底栏那一行的场景用）。
     */
    scrollSelf?: boolean
  }>(),
  { values: () => ({}), params: () => [], disabled: false, maxHeight: Infinity, scrollSelf: false },
)

const emit = defineEmits<{
  /** 面板改了参数（可能一次多个） */
  'set-values': [values: Record<string, unknown>]
  /** 面板要求开始生成 */
  run: []
  /** 面板要提示一句话 */
  notify: [payload: { level: 'info' | 'success' | 'error'; message: string }]
  /** 面板内容的自然高度变化（外层的滚动容器按它决定高度） */
  height: [height: number]
}>()

const frame = ref<HTMLIFrameElement | null>(null)
/** 根元素：读它上面真实的主题变量（主题可能被设置面板改写，读「此刻算出来的值」） */
const hostEl = ref<HTMLElement | null>(null)
/** 面板自己报的高度；没报之前用一个不太高也不塌的值 */
/** 内容的自然高度；0 = 还没量到，此时先给一个最小可视高度，别让面板塌成一条线 */
const measured = ref(0)
const height = computed(() => {
  if (measured.value <= 0) return 28
  return props.scrollSelf ? Math.min(measured.value, props.maxHeight) : measured.value
})
watch(height, (h) => emit('height', h), { immediate: true })

/**
 * 把主题变量读成**真实色值**再交给面板。
 *
 * 为什么不能直接把 `var(--ui-panel)` 发进去：iframe 是独立文档，没有外层那几个变量，
 * `var()` 在里面解析不出来 → 面板里所有颜色都失效（用户 2026-11-07 截图：白底上一片灰）。
 * 也不能写死：主题工作台能改色，写死就会和界面不一致。
 * 所以在宿主里 getComputedStyle 读一次，读不到再用 props.theme / 兜底值。
 */
function readTheme(): Record<string, string> {
  const out: Record<string, string> = { ...(props.theme ?? {}) }
  const el = hostEl.value
  if (!el) return out
  const cs = getComputedStyle(el)
  const names: Record<string, string[]> = {
    panel: ['--ui-panel', '--ui-overlay-solid', '--ui-surface'],
    ink: ['--ui-ink'],
    inkDim: ['--ui-ink-dim', '--ui-ink-mute'],
    line: ['--ui-line'],
    accent: ['--ui-accent'],
    chip: ['--ui-chip', '--ui-hover-soft'],
    danger: ['--ui-danger', '--ui-error'],
    radius: ['--ui-radius', '--radius'],
    font: ['--ui-font', '--ui-font-family'],
  }
  for (const [key, vars] of Object.entries(names)) {
    for (const v of vars) {
      const got = cs.getPropertyValue(v).trim()
      if (got) { out[key] = got; break }
    }
  }
  // 深色 / 亮色：面板据此决定默认文字色（有些主题不设 --ui-ink）
  out.dark = document.documentElement.classList.contains('dark') ? 'true' : 'false'
  return out
}

/**
 * 注入到面板里的桥接脚本。
 *
 * 为什么由宿主注入、而不是让 provider 自己写：provider 只要写「我要改参数」，
 * 不必关心消息名、来源校验、结构化克隆这些细节。
 */
const BRIDGE = '<' + 'scr' + 'ipt>' + `
(function () {
  var pending = null
  var listeners = []
  window.api = {
    onContext: function (fn) { listeners.push(fn); if (pending) fn(pending) },
    setValues: function (v) { parent.postMessage({ type: 'canvas:panel:set-values', values: v }, '*') },
    run: function () { parent.postMessage({ type: 'canvas:panel:run' }, '*') },
    resize: function (h) { parent.postMessage({ type: 'canvas:panel:resize', height: h }, '*') },
    notify: function (message, level) { parent.postMessage({ type: 'canvas:panel:notify', level: level || 'info', message: String(message) }, '*') }
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data || {}
    if (d.type !== 'canvas:panel:init' && d.type !== 'canvas:panel:update') return
    if (d.type === 'canvas:panel:init') pending = d
    // 把宿主主题色写成**真实 CSS 变量**，面板里直接 var(--ui-panel) 就能用
    applyTheme(d.theme || {})
    for (var i = 0; i < listeners.length; i++) listeners[i](d)
  })
  function applyTheme(t) {
    var root = document.documentElement
    var map = {
      '--ui-panel': t.panel, '--ui-ink': t.ink, '--ui-ink-dim': t.inkDim,
      '--ui-line': t.line, '--ui-accent': t.accent, '--ui-chip': t.chip,
      '--ui-danger': t.danger, '--ui-radius': t.radius
    }
    for (var k in map) { if (map[k]) root.style.setProperty(k, map[k]) }
    if (t.dark === 'true') root.style.colorScheme = 'dark'
    if (t.font) document.body.style.fontFamily = t.font
  }
  // 高度自动上报：内容长高/变矮都告诉宿主，provider 不用自己算。
  // 量的是**内容本身**的边界（不是 scrollHeight / 视口高度，那两个永远 >= 当前 iframe 高）。
  function reportHeight() {
    var el = document.body
    if (!el) return
    var box = el.getBoundingClientRect()
    // +1：取整误差会让 iframe 视口比内容矮一丝，iframe 内部就冒出一条原生滚动条
    var h = Math.ceil(box.height) + 1
    parent.postMessage({ type: 'canvas:panel:resize', height: h }, '*')
  }
  function startObserving() {
    if (!document.body) return
    window.api.reportHeight = reportHeight
    if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body)
    reportHeight()
  }
  // 脚本在 <head> 里执行时 body 还不存在：等 DOM 建好再观测（直接 observe(null) 会抛 TypeError）
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserving)
  else startObserving()
  window.addEventListener('load', reportHeight)
  // 内容自己报的触发（字体加载完 / 图片解码后高度会变）
  setTimeout(reportHeight, 60)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reportHeight)
})()
` + '</scr' + 'ipt>'

/**
 * srcdoc：把 provider 的 HTML 和桥接脚本拼成一份完整文档。
 * 桥接脚本放在最前面，这样面板里的脚本一跑就有 window.api。
 */
const srcdoc = computed(() => {
  const html = props.html
  if (/<html[\s>]/i.test(html)) {
    // 已经是完整文档：塞到 <head> 后面 / 文档最前面
    const headAt = html.search(/<head[^>]*>/i)
    if (headAt >= 0) {
      const end = html.indexOf('>', headAt) + 1
      return html.slice(0, end) + BRIDGE + html.slice(end)
    }
    return BRIDGE + html
  }
  return '<!doctype html><html><head><meta charset="utf-8">' + BRIDGE
    + '<style>html,body{margin:0;padding:0;background:transparent;color:inherit;font:inherit;overflow:hidden}'
    // 滚动交给外层 ScrollArea；iframe 内部一旦能滚，就会和外面那条 shadcn 滚动条并排出现
    + '*{box-sizing:border-box}</style>'
    + '</head><body>' + html + '</body></html>'
})

/** 只在来源确实是我们这个 iframe 时才处理消息 */
function onMessage(ev: MessageEvent): void {
  const win = frame.value?.contentWindow
  if (!win || ev.source !== win) return
  const d = ev.data as { type?: string; values?: unknown; height?: unknown; message?: unknown; level?: unknown }
  if (!d || typeof d.type !== 'string') return
  if (d.type === 'canvas:panel:set-values') {
    const values = d.values
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      emit('set-values', { ...(values as Record<string, unknown>) })
    }
    return
  }
  if (d.type === 'canvas:panel:run') {
    emit('run')
    return
  }
  if (d.type === 'canvas:panel:resize') {
    const h = Number(d.height)
    if (Number.isFinite(h) && h > 0) measured.value = Math.ceil(h)
    return
  }
  if (d.type === 'canvas:panel:notify') {
    const level = d.level === 'success' || d.level === 'error' ? d.level : 'info'
    emit('notify', { level, message: String(d.message ?? '') })
  }
}

/** 把当前参数推给面板（首次由 load 事件触发，之后每次值变） */
function pushContext(kind: 'canvas:panel:init' | 'canvas:panel:update'): void {
  const win = frame.value?.contentWindow
  if (!win) return
  /*
   * 必须发**纯数据**：props.values / params 是 Vue 的响应式代理，
   * postMessage 的结构化克隆遇到 Proxy 会直接抛 DataCloneError（规范如此）。
   * 真机上表现为「面板收不到任何上下文」。
   */
  const payload = {
    type: kind,
    values: plain(props.values),
    params: plain(props.params),
    actionId: props.actionId ?? '',
    model: props.model ?? '',
    nodeType: props.nodeType ?? '',
    disabled: props.disabled === true,
    theme: plain(readTheme()),
  }
  try {
    win.postMessage(payload, '*')
  } catch {
    /* 面板刚被换掉等竞态：下一次 update 会补上，不抛给上层 */
  }
}

/** 深拷贝成可克隆的普通对象（丢掉 Proxy / 函数 / undefined） */
function plain(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v ?? null))
  } catch {
    return null
  }
}

function onLoad(): void {
  pushContext('canvas:panel:init')
}

/**
 * 主题变量变了（切换亮暗 / 主题工作台改色）就重发一次上下文。
 * 只监听根节点上的 class 与 style：不用轮询，也不会因为画布其它重绘而空发。
 */
let themeWatch: MutationObserver | null = null
onMounted(() => {
  themeWatch = new MutationObserver(() => pushContext('canvas:panel:update'))
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
})
onBeforeUnmount(() => {
  themeWatch?.disconnect()
  themeWatch = null
})

watch(
  () => [props.values, props.disabled],
  () => pushContext('canvas:panel:update'),
  { deep: true },
)

// 换 HTML 时高度先收起，等新面板自己报 —— 否则上一份的高会把这一份撑出一片空白
watch(() => props.html, () => {
  measured.value = 0
})

onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
</script>

<template>
  <div ref="hostEl" class="nhp" :style="{ height: height + 'px' }">
    <iframe
      ref="frame"
      class="nhp-frame"
      sandbox="allow-scripts"
      scrolling="no"
      :srcdoc="srcdoc"
      title="自定义配置面板"
      @load="onLoad"
    />
  </div>
</template>

<style scoped>
/* 面板整体跟着底栏走：不定宽、不撑破，高度由 iframe 自己报 */
.nhp {
  width: 100%;
  overflow: hidden;
  border-top: 1px solid var(--ui-line, rgb(255 255 255 / 0.08));
}
.nhp-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color-scheme: inherit;
}
/* 没有输入框的形态：占输入框那一行，和上下元素保持同样的内边距 */
.nhp.nb-panel-inline {
  margin: 0;
  border-top: 0;
}
</style>

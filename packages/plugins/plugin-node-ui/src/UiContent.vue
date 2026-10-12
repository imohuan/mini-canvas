<script setup lang="ts">
/**
 * UiContent —— 可视化节点的内容区：把 Agent 写的 HTML 用 iframe 画出来。
 *
 * ## 为什么必须有「遮罩 + 双击进入」（2026-10-12 用户实测）
 *
 * iframe 是**独立文档**，它会把鼠标事件全吃掉（pointerdown / wheel 都不会冒泡给宿主）。
 * 于是：
 *   · 想拖节点 —— 按住卡片往里拖，pointerdown 落在 iframe 里，VueFlow 收不到 → 拖不动；
 *   · 想缩画布 —— 滚轮落在 iframe 里，滚的是生成的内容，画布纹丝不动 → 像"节点自己在滚"。
 * 两件事一个根因。
 *
 * 做法（用户提的方案）：默认盖一层**透明遮罩**，事件落在遮罩上、照常冒泡到 VueFlow，
 * 于是拖拽 / 缩放 / 点选全都正常；**双击**摘掉遮罩进入交互态，里面那个界面才吃得到点击；
 * 一旦不再聚焦（点画布别处 / 选中别的节点 / 按 Esc），遮罩自动恢复。
 *
 * ## 安全边界（这个组件唯一需要小心的地方）
 *
 * iframe 的 `sandbox="allow-scripts"` **故意不给 allow-same-origin**：
 * 少了这一条，生成物就拿到宿主页面的源，等于把 localStorage（里面是整张画布）、cookie、
 * 以及宿主的 DOM 全交出去。给了沙箱之后它是不透明源，只能画自己那一格。
 *
 * ## 数据怎么进去
 *
 * srcdoc 是一份**完整的文档文本**（见 uiData.ts 的 buildSrcdoc）：数据在文档里的小脚本里
 * 就位，生成物一执行就能读到。不用 postMessage —— 那要两边握手、还得处理「界面还没监听就发了」
 * 的时序，而这里只需要单向注一次。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { buildPalette, buildSrcdoc, normalizeInputs, normalizeUpstream, type PaletteToken, type UpstreamItem } from './uiData'
import { THEME_COLOR_TOKENS } from '@mini-canvas/canvas-render'
import { normalizeManualValues, resolveInputValues } from './uiValues'
import { currentCanvasId, readUiConfig, resolveBaseUrl } from './uiConfig'
import { fetchBackendOrigin } from './uiOrigin'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/**
 * 本插件的配置（后台地址 / 允不允许联网）。
 *
 * 后台地址要现算成**绝对**地址：生成页面在 srcdoc 里，相对路径解析不出来。
 */
const pluginConfig = readUiConfig(ctx.tryGet('settings') as { get(k: string): unknown } | undefined)

/**
 * 生成页面该连的地址：**优先用节点上存的后台自报地址**。
 *
 * 为什么不是直接用配置/同源：dev 下前端在 5288、后台在 8865，同源地址不是后台；
 * 而经 vite 代理的跨源写请求会被预检拦死（实测）。生成时问过后台、把它报的地址存进了节点，
 * 这里读它即可 —— 生产（同源托管）与 dev 两条路都成立。
 */
const baseUrl = computed(() => {
  const stored = props.data?.uiBackendOrigin
  if (typeof stored === 'string' && stored) return stored.replace(/\/+$/, '')
  return discoveredOrigin.value || resolveBaseUrl(pluginConfig, typeof location !== 'undefined' ? location.href : undefined)
})

/**
 * 自己问一次后台的地址。
 *
 * 为什么需要：界面可能是 **Agent 经 MCP** 直接写进来的（那条路不经过前端，没人往节点上写
 * uiBackendOrigin）。而 dev 下前端源不是后台源，回落同源会让页面里的写接口失败。
 */
const discoveredOrigin = ref('')
void (async () => {
  const seen = props.data?.uiBackendOrigin
  if (typeof seen === 'string' && seen) return
  const cfg0 = resolveBaseUrl(pluginConfig, typeof location !== 'undefined' ? location.href : undefined)
  const got = await fetchBackendOrigin(cfg0)
  if (got) discoveredOrigin.value = got.replace(/\/+$/, '')
})()

const canvasId = currentCanvasId(typeof location !== 'undefined' ? location.href : undefined)

/** 生成的 HTML（空 = 还没画，显示空态而不是一个白框） */
const html = computed(() => (typeof props.data?.uiHtml === 'string' ? (props.data.uiHtml as string) : ''))
const hasHtml = computed(() => html.value.trim().length > 0)

/** 声明的输入参数 + 手工值 */
const inputs = computed(() => normalizeInputs(props.data?.uiInputs))
const manual = computed(() => normalizeManualValues(props.data?.uiValues))

/**
 * 上游素材：**从连线上现算**。
 *
 * ## 为什么不读节点 data 里那份（踩过的坑）
 *
 * 原来只读 `data.uiUpstream` —— 那是「前端自己调模型生成」那条路写进去的。可 Agent 是经
 * **MCP** 写的，它只写 uiHtml，不会顺手写素材；于是节点上真连着图/视频，页面里
 * `window.__CANVAS_UPSTREAM__` 却是 `[]`（2026-10-12 实测）。
 * 现在两边都认：data 里有就用它（那是生成当时的快照），否则**现算**——只要边在，素材就在。
 */
const NODE_KIND_FIELDS: Array<[string, string]> = [
  ['imageUrl', 'image'],
  ['videoUrl', 'video'],
  ['audioUrl', 'audio'],
  ['panoUrl', 'image'],
]

const upstream = computed<UpstreamItem[]>(() => {
  const stored = normalizeUpstream(props.data?.uiUpstream)
  if (stored.length > 0) return stored
  // 真实 doc 的节点一定带 id（要拿它标出这条素材来自哪个节点），
  // 所以这里把 id 也声明上；类型写窄了会在用 n.id 时被 tsc 拦住。
  const doc = ctx.tryGet<{
    getNode(id: string): { id?: string; type?: string; data?: Record<string, unknown> } | undefined
    getEdges(): Array<{ source: string; target: string }>
  }>('doc')
  if (!doc) return []
  const raw: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const e of doc.getEdges()) {
    if (e.target !== props.id || seen.has(e.source)) continue
    const n = doc.getNode(e.source)
    if (!n) continue
    seen.add(e.source)
    const d = (n.data ?? {}) as Record<string, unknown>
    const hit = NODE_KIND_FIELDS.find(([f]) => typeof d[f] === 'string' && d[f])
    const url = hit ? (d[hit[0]] as string) : undefined
    const text = typeof d.text === 'string' ? d.text : undefined
    // 既没地址也没文字 = 空素材（例如还没生成的图片节点），别塞给生成物当噪音
    if (!url && !text) continue
    raw.push({
      id: n.id,
      kind: hit ? hit[1] : (n.type ?? 'other'),
      ...(typeof d.label === 'string' ? { name: d.label } : {}),
      ...(url ? { url } : {}),
      ...(text ? { value: text } : {}),
    })
  }
  return normalizeUpstream(raw)
})

/** 画布主题色板（亮/暗两套）——只提供，用不用由生成的界面自己决定 */
const palette = computed(() =>
  buildPalette(THEME_COLOR_TOKENS as readonly PaletteToken[], ctx.tryGet('settings') as { get(k: string): unknown } | undefined),
)

/** 注入给生成页面的数据 */
const inputValues = computed(() => resolveInputValues(inputs.value, upstream.value, manual.value))

/** 深浅色：跟着画布主题走（生成物可以用它做深浅分支） */
const theme = ref<'light' | 'dark'>('light')
function syncTheme(): void {
  if (typeof document === 'undefined') return
  theme.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
syncTheme()
let observer: MutationObserver | null = null
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  observer = new MutationObserver(syncTheme)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
onBeforeUnmount(() => observer?.disconnect())

/** srcdoc：只在这几样真变了的时候重算（否则每帧重渲染 iframe = 画面一直闪） */
const srcdoc = computed(() => {
  if (!hasHtml.value) return ''
  return buildSrcdoc(html.value, inputValues.value, upstream.value, {
    theme: theme.value,
    nodeId: props.id,
    baseUrl: baseUrl.value,
    canvasId,
    // 允许联网 = 生成的界面可以调画布接口（这个节点的价值所在）。
    // 关掉它就是「纯展示」，连不上任何地方 —— 见 uiData.buildCsp 的说明。
    allowNetwork: pluginConfig.netEnabled,
    palette: palette.value,
  })
})

/**
 * iframe 的 key：换了 HTML 要**重挂**（改 srcdoc 属性在部分浏览器里不会重跑脚本，
 * 表现就是「重新生成后界面纹丝不动」）。
 */
const gen = ref(0)
watch(html, () => { gen.value += 1 })

/**
 * 交互闸门：true = 已进入交互态（遮罩撤掉，里面的界面吃得到点击）。
 *
 * 为什么默认 false：iframe 会吃掉鼠标事件，遮罩不盖住的话节点拖不动、画布也缩不了
 * （见文件头）。只有用户**明确双击**才让它接管。
 */
const interactive = ref(false)

/** 双击进入交互态 */
function enterInteractive(): void {
  if (!hasHtml.value) return
  interactive.value = true
}

/** 退出交互态（遮罩回来，节点恢复可拖） */
function exitInteractive(): void {
  interactive.value = false
}

/**
 * 什么时候自动退出交互态。
 *
 * 用户口径：「当我在操作画布、相当于这个页面失去聚焦的时候，就恢复这个遮罩」。
 * 落到实现上有三件事，都得管 —— 只做其中一件都会留下"点不回去"的死角：
 *   ① 点画布别处（pointerdown 落在本组件之外）→ 不再聚焦；
 *   ② 选中态变了（点选别的节点 / 点空白清空选择）→ 这个节点不再是"当前"；
 *   ③ 按 Esc → 明确的退出意图。
 */
const rootEl = ref<HTMLElement | null>(null)

/** ① 全局 pointerdown：点在组件之外就退出 */
function onGlobalPointerDown(e: PointerEvent): void {
  if (!interactive.value) return
  const el = rootEl.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  exitInteractive()
}

/** ③ Esc：明确退出 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && interactive.value) exitInteractive()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onGlobalPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
}

/** ② 选中态变化：本节点不再被选中就退出 */
const selection = ctx.tryGet<{ ids?: Iterable<string>; onChange?(cb: () => void): () => void }>('selection')
const isSelected = ref(false)
function syncSelected(): void {
  const ids = selection?.ids ? [...selection.ids] : []
  const now = ids.includes(props.id)
  // 从选中变成没选中 → 退出交互态（用户去点别的地方了）
  if (isSelected.value && !now) exitInteractive()
  isSelected.value = now
}
syncSelected()
let selectionOff: (() => void) | null = null
if (selection?.onChange) selectionOff = selection.onChange(syncSelected)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', onGlobalPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
  selectionOff?.()
})

/** 空态提示：只说一件事 —— 让 Agent 来画 */
const hint = computed(() => {
  if (!ctx.tryGet('doc')) return '画布尚未就绪'
  return '让 Agent 帮你画（在对话里说明要画什么）'
})
</script>

<template>
  <div ref="rootEl" class="ui-node" :class="{ 'is-interactive': interactive }">
    <template v-if="hasHtml">
      <!-- 沙箱 iframe（不授予同源权限，见文件头） -->
      <iframe
        :key="gen"
        class="ui-frame"
        :srcdoc="srcdoc"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        loading="lazy"
        :title="'可视化节点 ' + props.id"
      />
      <!--
        交互遮罩：平时盖在 iframe 上，把鼠标事件让回画布。
        双击摘掉它，里面的界面才开始吃点击；失去聚焦时自动盖回来。

        ⚠️ **不要**给这一层加 nodrag / nopan —— 那两个类的意思正好是"这一层不参与拖拽/平移"，
        而遮罩盖满整张卡，等于把整个节点的拖拽彻底禁掉（2026-10-12 用户实测「依然无法拖拽」的根因）。
        它必须是**普通的一层**：pointerdown 落上去后正常冒泡，VueFlow 才知道用户要拖这个节点。
      -->
      <div
        v-if="!interactive"
        class="ui-gate"
        title="双击进入交互（点击界面里的按钮等）"
        @dblclick.stop="enterInteractive"
      >
        <span class="ui-gate-badge">双击交互</span>
      </div>
    </template>

    <!-- 空态：还没画 -->
    <div v-else class="ui-empty">
      <div class="ui-empty-title">可视化</div>
      <div class="ui-empty-hint">{{ hint }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 内容铺满整张卡（类型声明了 frameless，外壳不再画边框） */
.ui-node {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--canvas-node-surface, #fff);
}
.ui-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}

/* 交互遮罩：透明、盖满，负责"把事件让回画布" */
.ui-gate {
  position: absolute;
  inset: 0;
  z-index: 2;
  /* 透明但要"摸得到"：pointer-events 必须是 auto，否则事件又落回 iframe 了 */
  background: transparent;
  cursor: default;
}
/* 提示角标：只在鼠标停到节点上时淡淡地露一下，不打扰看内容 */
.ui-gate-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-faint, #9ca3af);
  font-size: 11px;
  line-height: 18px;
  opacity: 0;
  transition: opacity 160ms ease;
  pointer-events: none;
}
.ui-gate:hover .ui-gate-badge {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .ui-gate-badge {
    transition: none;
  }
}

/* 交互态：给一圈内描边，让用户知道"现在点进去的是里面那个界面" */
.ui-node.is-interactive {
  box-shadow: inset 0 0 0 2px var(--ui-accent, #0891b2);
}

.ui-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  text-align: center;
}
.ui-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--canvas-node-text-title, #6b7280);
}
.ui-empty-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--canvas-node-text-faint, #9ca3af);
}
</style>


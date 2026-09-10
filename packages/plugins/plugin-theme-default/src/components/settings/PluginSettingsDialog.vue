<script setup lang="ts">
/**
 * PluginSettingsDialog —— theme-default 的默认设置面板皮（Dialog + 左右导航 + 可选二级页签版）。
 *
 * 定位：可替换设置面板 settingsPanel 槽的默认赢家，被 <SettingsHost/> 渲染（喂 props.settings）。
 * 从"一列堆叠分组卡片"重构为**居中 modal 弹窗 + 左右布局的标准设置界面**，并支持"分组名带 / 的二级菜单"：
 *   - 左 = 一级分组导航（一项 = group key 的第一个 `/` 分段；无 `/` 的扁平分组即它自己）
 *   - 右 = 二级页签条 + 内容：某一级下若**多于一个**二级分组则显示页签(tab)切换；只有一个则直接展示内容、不显示 tab
 * 依赖方向：plugin-theme-default → canvas-render(useCanvasRender 拿 ctx) → canvas-core-v2，不反向。
 *
 * ## 分组 key 的语义（新增二级菜单）
 * 每个配置字段声明在某个 `group`（plugin Config schema 里字段的 group / 内核 settings 里申明的组名）。
 * 这里把 group key 按 `/` 切成两级来组织 UI：
 *   - key 无 `/`（如 `图片`、`连线`）→ 一级名 = key 本身，下面只有它自己一个"叶子" → 左导航显示它，右侧直接展示其内容（无页签）。
 *   - key 带 `/`（如 `常规/显示`）→ 一级名 = `常规`，二级名 = `显示` → 左导航按一级名合并显示 `常规`；
 *     同属 `常规` 的二级分组多于一个时，右侧出现 `显示`/… 的页签条，正文跟随当前页签；只有一个则无页签直接展示。
 *
 * ## 三套可扩展插槽（内核 ctx.slots 多 occupant 机制，插件 ctx.slots.register 填充，装卸自动回收）
 *   1) 左导航插槽  `settingsNav`    — 定制一级导航项（id = 一级名，命中顶替；否则末尾追加自定义一级项）。
 *   2) 二级页签插槽 `settingsTab`   — 定制二级页签（id 首段 = 当前一级名，见下），与 settingsNav 语义对称。
 *   3) 右内容插槽  `settingsGroup/<key>` — 接管某个**完整分组 key** 的右侧内容区渲染（key 为带/的叶子全名或扁平分组名）。
 *
 *   `settingsNav`/`settingsTab` occupant 都通过 props 收到 { group, active, onSelect }；onSelect(key) 切过去，不给则点了没反应。
 *   - `settingsNav`：id 命中某一级名 → 顶替该一级导航项；不命中 → 作为"纯自定义一级项"末尾追加（右侧需配 settingsGroup/<id> 接管）。
 *   - `settingsTab`：id 首段 === 当前一级名 才对本级生效——
 *     · id 命中该一级下某个完整分组 key → 顶替那个二级页签（正文仍由该 key 的内容插槽/schema 决定）；
 *     · 不命中 → 追加一个自定义二级页签（需另注册 settingsGroup/<id> 接管其内容）。
 *
 * 打开/关闭：宿主(App.vue)用 v-if="settingsOpen" 控制本面板是否渲染；本面板内部 ✕ / 点遮罩 / Esc
 * 经 ctx.emit('settings:ui-close') 通知宿主关闭（宿主 onReady 里 ctx.on 订阅置 settingsOpen=false）。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER, useCanvasRender } from '@mini-canvas/canvas-render'
import SettingsSchemaField from './SettingsSchemaField.vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlotOcc = { id: string; order: number; component: any; meta?: any }

const props = defineProps<{
  settings: SettingsPanelSource
  /** 是否允许点遮罩关闭（默认 true）；Esc 关闭亦随此开关。 */
  closeOnMask?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { ctx } = useCanvasRender()

// —— 下发"标准 schema 字段渲染器"给本面板内的内容插槽组件（settingsGroup/<key> occupant）——
// 插件自定义组件（预览UI等）经 injectSettingsFieldRenderer() 拿到后，可 <component :is> 直接渲染某字段控件
provide(SETTINGS_FIELD_RENDERER, SettingsSchemaField)

const SEP = '/'

/** 一级名：group key 的第一个分段。扁平分组(=自己) 与 二级分组(=前段) 在此汇合。 */
function navOf(key: string): string {
  return key.split(SEP)[0]
}
/** 二级名 / 展示名：带 `/` 的取 `/` 后段，扁平分组取它自己。 */
function leafLabelOf(key: string): string {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// —— 左导航插槽 occupants（插件塞的导航项），插件装卸/变更时重读 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const navList = ref<SlotOcc[]>([])
function reloadNav(): void {
  navList.value = ctx.slots.occupants('settingsNav').map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
  }))
}
reloadNav()

// —— 二级页签插槽 occupants（settingsTab）：全局读一次，渲染时按"当前一级名"过滤归并 ——
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabList = ref<SlotOcc[]>([])
function reloadTabs(): void {
  tabList.value = ctx.slots.occupants('settingsTab').map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
  }))
}
reloadTabs()

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reloadNav),
  ctx.on('ctx:plugin-uninstalled', reloadNav),
  ctx.on('ctx:plugin-installed', reloadTabs),
  ctx.on('ctx:plugin-uninstalled', reloadTabs),
)
// P2-1：内核 schema 变更订阅 → 强制刷新分组列表（插件热装卸后新 config 分组立即可见）
const rawSettings = ctx.get<{ onSchemaChange(cb: () => void): { dispose(): void } }>('settings')
const schemaOff = rawSettings?.onSchemaChange(() => { refreshTick.value += 1 })
if (schemaOff) disposers.push(schemaOff)
onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
})

// —— 分组（schema）—— 
// P2-1：schema 变化（插件热装卸 define/移除项）经 settings.onSchemaChange 置 refreshTick 强制重算 groups；
const refreshTick = ref(0)
const groups = computed(() => { void refreshTick.value; return props.settings.groups() })
// 一级名 → 其下完整分组 key 列表（保持 groups() 原序）
const sectionMap = computed<Map<string, string[]>>(() => {
  const m = new Map<string, string[]>()
  for (const g of groups.value) {
    const nav = navOf(g)
    if (!m.has(nav)) m.set(nav, [])
    m.get(nav)!.push(g)
  }
  return m
})

// —— 当前激活的一级导航（左侧一级名 / 或纯自定义 nav id）——
// 右侧永远展示"该一级下全部二级块"叠成的长列表，靠滚动浏览；点二级只是滚动定位，不再切内容。
const activeNav = ref<string>('')

interface NavEntry {
  key: string
  kind: 'section' | 'nav'
  leaves: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any
}
const navEntries = computed<NavEntry[]>(() => {
  const out: NavEntry[] = []
  for (const [nav, leaves] of sectionMap.value) out.push({ key: nav, kind: 'section', leaves })
  const byKey = new Map<string, NavEntry>(out.map((e) => [e.key, e]))
  const occs = [...navList.value].sort((a, b) => a.order - b.order)
  const extras: NavEntry[] = []
  for (const oc of occs) {
    if (oc.id.startsWith('#')) continue
    if (byKey.has(oc.id)) {
      const e = byKey.get(oc.id)!
      e.kind = 'nav'
      e.component = oc.component
    } else {
      extras.push({ key: oc.id, kind: 'nav', leaves: [], component: oc.component })
    }
  }
  out.push(...extras)
  return out
})

/** 左侧一级导航项的激活态 */
function isNavActive(key: string): boolean {
  return activeNav.value === key
}

/** 选中一个一级导航：右侧滚动回该一级的第一段顶部 */
function selectNav(value: string): void {
  if (activeNav.value === value) return
  activeNav.value = value
  void nextTick(scrollToTop)
}

// 分组/导航变化时，确保 activeNav 仍指向一个存在的导航项（默认第一个一级）
watch(
  [groups, navEntries],
  () => {
    const navSet = new Set(navEntries.value.map((e) => e.key))
    if (navEntries.value.length && !navSet.has(activeNav.value)) activeNav.value = navEntries.value[0].key
  },
  { immediate: true },
)

// —— 当前一级下的有序"段"（sections）：每个完整二级/扁平分组占一段，叠成右侧长列表 ——
interface Section {
  key: string
  label: string
  kind: 'leaf' | 'tab'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: any
}
const sections = computed<Section[]>(() => {
  const nav = activeNav.value
  const leaves = sectionMap.value.get(nav) ?? []
  const occs = [...tabList.value]
    .sort((a, b) => a.order - b.order)
    // settingsTab 只对"id 首段 === 当前一级名"的项生效（避免跨一级串扰）
    .filter((oc) => oc.id.startsWith(nav + SEP))
  const occByLeaf = new Map<string, SlotOcc>()
  const customs: SlotOcc[] = []
  for (const oc of occs) {
    if (leaves.includes(oc.id)) occByLeaf.set(oc.id, oc)
    else customs.push(oc)
  }
  const out: Section[] = []
  for (const leaf of leaves) {
    const occ = occByLeaf.get(leaf)
    out.push(
      occ
        ? { key: leaf, label: leafLabelOf(leaf), kind: 'tab', component: occ.component }
        : { key: leaf, label: leafLabelOf(leaf), kind: 'leaf' },
    )
  }
  for (const oc of customs) out.push({ key: oc.id, label: leafLabelOf(oc.id), kind: 'tab', component: oc.component })
  return out
})

// —— 右侧滚动容器 + 当前"正在视口顶部"的段（scroll-spy，用于高亮对应 tab）——
const scrollEl = ref<HTMLElement | null>(null)
const currentSection = ref<string>('')

/**
 * 程序化滚动锁：smooth 滚动期间 scroll 事件会连续触发，若任由 scroll-spy 覆盖，
 * 会把高亮在途经的段之间闪来闪去。故点 tab / 切一级触发的滚动会先上一把锁，
 * 锁未解前 scroll-spy 不重算高亮，保证落点高亮即所选段。
 * 解锁时机：容器触发 scrollend（浏览器判定动画结束），或兜底超时。
 */
let scrollLocked = false
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null
const SCROLL_LOCK_MAX_MS = 1200

function releaseScrollLock(): void {
  scrollLocked = false
  if (scrollLockTimer !== null) {
    clearTimeout(scrollLockTimer)
    scrollLockTimer = null
  }
}
function lockScrollUntilSettles(el: HTMLElement): void {
  scrollLocked = true
  // 兜底：即便浏览器不支持/不触发 scrollend，也在一段时间后解锁（避免一直锁死）
  if (scrollLockTimer !== null) clearTimeout(scrollLockTimer)
  scrollLockTimer = setTimeout(releaseScrollLock, SCROLL_LOCK_MAX_MS)
  // 现代浏览器：smooth 动画真正结束时解锁（远跳比固定时长更准）
  const onEnd = () => {
    el.removeEventListener('scrollend', onEnd)
    releaseScrollLock()
  }
  el.addEventListener('scrollend', onEnd)
}

function scrollToTop(): void {
  const cont = scrollEl.value
  if (cont) {
    cont.scrollTo({ top: 0, behavior: 'smooth' })
    lockScrollUntilSettles(cont)
  }
  if (sections.value.length) currentSection.value = sections.value[0].key
}
function scrollToSection(key: string): void {
  const cont = scrollEl.value
  if (!cont) return
  const el = cont.querySelector<HTMLElement>(`.psd-section[data-sec="${cssEscape(key)}"]`)
  if (!el) return
  const target = el.getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop
  cont.scrollTo({ top: target, behavior: 'smooth' })
  // 锁定期间不让 scroll-spy 覆盖，保证落点即所选段
  lockScrollUntilSettles(cont)
  currentSection.value = key
}
function onBodyScroll(): void {
  // 程序化滚动动画进行中：不重算高亮，避免途经段来回闪
  if (scrollLocked) return
  const cont = scrollEl.value
  if (!cont) return
  const ctop = cont.getBoundingClientRect().top
  let best = ''
  for (const s of sections.value) {
    const el = cont.querySelector<HTMLElement>(`.psd-section[data-sec="${cssEscape(s.key)}"]`)
    if (el && el.getBoundingClientRect().top <= ctop + 6) best = s.key
  }
  if (best) currentSection.value = best
}
// 切换一级时，若该一级只有一段也置高亮；否则滚回顶部
watch(sections, () => { void nextTick(scrollToTop) })

/** CSS.escape 兜底：section key 含 `/`、中文等字符也能安全用于属性选择器 */
function cssEscape(v: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const es = (globalThis as any).CSS?.escape
  return typeof es === 'function' ? es(v) : v.replace(/["\\]/g, '')
}

// —— 每个段的正文：默认 schema 控件 + settingsGroup/<key> 内容插槽，统一成"内容块列表" ——
// 内容插槽 occupant 可经 meta.mode 声明摆放：prepend / append / replace(缺省，接管整组)
function slotMode(oc: SlotOcc): 'replace' | 'prepend' | 'append' {
  const m = (oc.meta as { mode?: string } | undefined)?.mode
  return m === 'prepend' ? 'prepend' : m === 'append' ? 'append' : 'replace'
}
type ContentBlock =
  | { kind: 'field'; key: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: 'slot'; occ: SlotOcc }

/** 插件装卸/变更 → 递增版本号，让内容插槽 occupants 重读（与 schema/分组刷新解耦但同源触发） */
const occTick = ref(0)
function bumpOcc(): void { occTick.value += 1 }
disposers.push(
  ctx.on('ctx:plugin-installed', bumpOcc),
  ctx.on('ctx:plugin-uninstalled', bumpOcc),
)

/** 取某段自己的渲染内容块（现取，不缓存，靠 occTick/响应式重算） */
function blocksOf(sectionKey: string): ContentBlock[] {
  void occTick.value
  void refreshTick.value
  const occs = ctx.slots
    .occupants('settingsGroup/' + sectionKey)
    .map((e) => ({ id: e.id, order: e.order, component: markRaw(e.component as object), meta: e.meta }))
  const fields = props.settings.groupOf(sectionKey)
  if (!occs.length) return fields.map((e) => ({ kind: 'field' as const, key: e.key }))
  const coexist = occs.some((o) => slotMode(o) !== 'replace')
  const sorted = (m: string) => occs.filter((o) => slotMode(o) === m).sort((a, b) => a.order - b.order)
  const blocks: ContentBlock[] = []
  blocks.push(...sorted('prepend').map((o) => ({ kind: 'slot' as const, occ: o })))
  if (coexist) blocks.push(...fields.map((e) => ({ kind: 'field' as const, key: e.key })))
  blocks.push(...sorted('replace').map((o) => ({ kind: 'slot' as const, occ: o })))
  blocks.push(...sorted('append').map((o) => ({ kind: 'slot' as const, occ: o })))
  return blocks
}

// —— 关闭：✕ / 遮罩 / Esc（closeOnMask 才响应遮罩与 Esc）——
function close(): void {
  emit('close')
  ctx.emit('settings:ui-close')
}
function onMaskClick(): void {
  if (props.closeOnMask !== false) close()
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.closeOnMask !== false) close()
}

// —— 浮动窗口模式：脱离遮罩，居中→绝对坐标，顶部可拖，右下可 resize，限制不出屏与最小尺寸 ——
const floating = ref(false)

const MIN_W = 520
const MIN_H = 360
const DEFAULT_W = typeof window !== 'undefined' ? Math.min(920, window.innerWidth - 64) : 920
const DEFAULT_H = typeof window !== 'undefined' ? Math.min(Math.floor(0.68 * window.innerHeight), 780) : 780

interface WinGeom { left: number; top: number; width: number; height: number }
/** 进入浮动模式时一次性拍下当前居中几何（用 dialog 当时的实际渲染尺寸） */
const winGeom = ref<WinGeom>({ left: 0, top: 0, width: DEFAULT_W, height: DEFAULT_H })
const dialogEl = ref<HTMLElement | null>(null)

function clampGeom(g: WinGeom): WinGeom {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(MIN_W, Math.min(g.width, vw))
  const h = Math.max(MIN_H, Math.min(g.height, vh))
  const maxL = vw - w
  const maxT = vh - h
  return {
    left: Math.min(Math.max(0, g.left), Math.max(0, maxL)),
    top: Math.min(Math.max(0, g.top), Math.max(0, maxT)),
    width: w,
    height: h,
  }
}

function captureCurrentGeom(): WinGeom {
  const el = dialogEl.value
  if (!el) return winGeom.value
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function enterFloating(): void {
  winGeom.value = clampGeom(captureCurrentGeom())
  floating.value = true
}
function exitFloating(): void {
  floating.value = false
}
function toggleFloating(): void {
  if (floating.value) exitFloating()
  else enterFloating()
}

// 拖拽：仅头部，按下鼠标 → 记偏移 → mousemove 更新 left/top，mouseup 解绑
let dragging = false
let dragOffX = 0
let dragOffY = 0
function onHeadMouseDown(e: MouseEvent): void {
  if (!floating.value) return
  // 拖手柄只允许"非按钮"区域触发：点到头部内的 button / interactive 不开始拖
  const t = e.target as HTMLElement | null
  if (t && t.closest('button, a, input, textarea, select, [role="button"]')) return
  dragging = true
  dragOffX = e.clientX - winGeom.value.left
  dragOffY = e.clientY - winGeom.value.top
  e.preventDefault()
}
function onDocMouseMove(e: MouseEvent): void {
  if (!dragging) return
  winGeom.value = clampGeom({
    ...winGeom.value,
    left: e.clientX - dragOffX,
    top: e.clientY - dragOffY,
  })
}
function onDocMouseUp(): void {
  dragging = false
}

// resize：右下角手柄，按下 → 记初始几何 → mousemove 改 width/height，mouseup 解绑
let resizing = false
let resizeStartX = 0
let resizeStartY = 0
let resizeStartGeom: WinGeom = { left: 0, top: 0, width: MIN_W, height: MIN_H }
function onResizeMouseDown(e: MouseEvent): void {
  if (!floating.value) return
  resizing = true
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  resizeStartGeom = { ...winGeom.value }
  e.preventDefault()
  e.stopPropagation()
}
function onResizeMouseMove(e: MouseEvent): void {
  if (!resizing) return
  const dx = e.clientX - resizeStartX
  const dy = e.clientY - resizeStartY
  winGeom.value = clampGeom({
    ...resizeStartGeom,
    width: resizeStartGeom.width + dx,
    height: resizeStartGeom.height + dy,
  })
}
function onResizeMouseUp(): void {
  resizing = false
}

// 浏览器窗口尺寸变化时把浮动窗拽回可视区
function onWindowResize(): void {
  if (floating.value) winGeom.value = clampGeom(winGeom.value)
}

// —— 二级页签条：溢出时用左右箭头按钮平移 + 区域内滚轮横向滚动（不占竖向空间）——
const tabsEl = ref<HTMLElement | null>(null)
const tabsOverflow = ref(false)
const tabsAtStart = ref(true)
const tabsAtEnd = ref(true)

const TAB_SCROLL_STEP = 160

function updateTabsOverflow(): void {
  const el = tabsEl.value
  if (!el) {
    tabsOverflow.value = false
    tabsAtStart.value = true
    tabsAtEnd.value = true
    return
  }
  const max = el.scrollWidth - el.clientWidth
  tabsOverflow.value = max > 1
  tabsAtStart.value = el.scrollLeft <= 1
  tabsAtEnd.value = el.scrollLeft >= max - 1
}

function scrollTabs(dir: -1 | 1): void {
  const el = tabsEl.value
  if (!el) return
  el.scrollBy({ left: dir * TAB_SCROLL_STEP, behavior: 'smooth' })
}

/** 区域内滚轮 → 横向滚动：只有真能滚（内容溢出且有方向余量）才拦，否则放行给外层 */
function onTabsWheel(e: WheelEvent): void {
  const el = tabsEl.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (delta === 0) return
  const next = Math.min(Math.max(0, el.scrollLeft + delta), max)
  if (next === el.scrollLeft) return
  el.scrollLeft = next
  e.preventDefault()
}

/** 页签更替（切一级/插件装卸/resize）后重算溢出态；ResizeObserver 兜住容器宽度变化 */
let tabsObserver: ResizeObserver | null = null
watch(
  tabsEl,
  (el, _old, onCleanup) => {
    tabsObserver?.disconnect()
    tabsObserver = null
    if (!el || typeof ResizeObserver === 'undefined') return
    tabsObserver = new ResizeObserver(updateTabsOverflow)
    tabsObserver.observe(el)
    onCleanup(() => {
      tabsObserver?.disconnect()
      tabsObserver = null
    })
  },
  { flush: 'post' },
)
watch(sections, () => void nextTick(updateTabsOverflow), { flush: 'post' })
/** 弹窗尺寸变化（浮动窗 resize / 浏览器窗口 resize）会让页签条可用宽跟着变 */
watch(
  () => [floating.value, winGeom.value.width] as const,
  () => void nextTick(updateTabsOverflow),
  { flush: 'post' },
)

const dialogStyle = computed<Record<string, string>>(() => {
  if (!floating.value) return {}
  const g = winGeom.value
  return {
    position: 'fixed',
    left: g.left + 'px',
    top: g.top + 'px',
    width: g.width + 'px',
    height: g.height + 'px',
    animation: 'none',
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('mousemove', onDocMouseMove)
  window.addEventListener('mouseup', onDocMouseUp)
  window.addEventListener('mousemove', onResizeMouseMove)
  window.addEventListener('mouseup', onResizeMouseUp)
  window.addEventListener('resize', onWindowResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onDocMouseMove)
  window.removeEventListener('mouseup', onDocMouseUp)
  window.removeEventListener('mousemove', onResizeMouseMove)
  window.removeEventListener('mouseup', onResizeMouseUp)
  window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="psd-mask"
      :class="{ 'psd-mask-hidden': floating }"
      @click="onMaskClick"
    >
      <div
        ref="dialogEl"
        class="psd-dialog"
        :class="{ 'psd-dialog-floating': floating, 'psd-dialog-resizing': resizing }"
        role="dialog"
        aria-modal="true"
        :style="dialogStyle"
        @click.stop
      >
        <!-- 弹窗头：浮动模式下整条可拖（点到按钮除外） -->
        <div class="psd-head" :class="{ 'psd-head-draggable': floating }" @mousedown="onHeadMouseDown">
          <div class="psd-title-block">
            <span class="psd-eyebrow">偏好</span>
            <h2 class="psd-title">设置</h2>
          </div>
          <div class="psd-head-actions">
            <button
              class="psd-icon-btn"
              :aria-label="floating ? '回到弹窗' : '转为悬浮窗口'"
              :title="floating ? '回到弹窗' : '转为悬浮窗口'"
              @click="toggleFloating"
            >
              <!-- 浮动模式：显示"两个对向箭头 / 收回"图标；弹窗模式：显示"外向箭头"图标 -->
              <svg v-if="floating" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3v6H3"/><path d="M3 9l6-6"/>
                <path d="M15 21v-6h6"/><path d="M21 15l-6 6"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6"/><path d="M9 21H3v-6"/>
                <path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
              </svg>
            </button>
            <button class="psd-close" aria-label="关闭" title="关闭" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 6l12 12"/><path d="M18 6L6 18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="psd-body">
          <!-- 左：一级导航 -->
          <nav class="psd-nav">
            <div v-if="!navEntries.length" class="psd-nav-empty">暂无分组</div>
            <div v-for="item in navEntries" :key="item.key" class="psd-nav-item"
              :class="{ active: isNavActive(item.key), slot: item.kind === 'nav' }" role="button" tabindex="0"
              @click="selectNav(item.key)" @keydown.enter.prevent="selectNav(item.key)">
              <!-- 默认一级项：分组没有图标，直接显示一级名文本（nav label = group 第一个 / 分段；扁平分组即它自己） -->
              <span v-if="item.kind === 'section'" class="psd-nav-inner">
                <span class="psd-nav-txt">{{ item.key }}</span>
              </span>
              <!-- 一级导航插槽顶替/自定义项：渲染插槽组件，注入 { group, active, onSelect } 能力 -->
              <component v-else :is="item.component" :group="item.key" :active="isNavActive(item.key)"
                :on-select="selectNav" />
            </div>
          </nav>

          <!-- 右：该一级下全部二级块叠成"可滚动长列表"；顶部 tab 只做滚动定位（scroll-spy 高亮当前段） -->
          <div class="psd-content">
            <!-- 目录条：本一级下的各段（仅一段时不显示目录）；溢出时两侧出箭头按钮 -->
            <div v-if="sections.length > 1" class="psd-tabbar">
              <button
                v-if="tabsOverflow"
                class="psd-tab-arrow"
                :disabled="tabsAtStart"
                aria-label="向左滚动页签"
                title="向左滚动页签"
                @click="scrollTabs(-1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>

              <div ref="tabsEl" class="psd-tabs" role="tablist" @scroll="updateTabsOverflow" @wheel="onTabsWheel">
                <template v-for="s in sections" :key="s.key">
                  <!-- settingsTab 插槽（顶替/追加）：渲染插槽组件注入 { group, active, onSelect }；active 由滚动定位高亮 -->
                  <component v-if="s.kind === 'tab'" :is="s.component" :group="s.key"
                    :active="currentSection === s.key" :on-select="scrollToSection" class="psd-tab-item" />
                  <!-- 默认目录项：点击滚动到该段 -->
                  <button v-else class="psd-tab-item" :class="{ active: currentSection === s.key }"
                    @click="scrollToSection(s.key)">
                    {{ s.label }}
                  </button>
                </template>
              </div>

              <button
                v-if="tabsOverflow"
                class="psd-tab-arrow"
                :disabled="tabsAtEnd"
                aria-label="向右滚动页签"
                title="向右滚动页签"
                @click="scrollTabs(1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 6l6 6-6 6"/>
                </svg>
              </button>
            </div>

            <div ref="scrollEl" class="psd-content-body" @scroll="onBodyScroll">
              <div v-if="!sections.length" class="psd-empty"><p>暂无分组</p></div>
              <section v-for="s in sections" :key="s.key" class="psd-section" :data-sec="s.key">
                <h4 class="psd-section-title" :class="{ current: currentSection === s.key }">{{ s.label }}</h4>
                <div class="psd-section-body">
                  <template v-for="b in blocksOf(s.key)"
                    :key="(b as any).kind === 'field' ? 'f-' + (b as any).key : 's-' + (b as any).occ.id">
                    <SettingsSchemaField v-if="b.kind === 'field'" :group="s.key" :field-key="b.key"
                      :settings="props.settings" />
                    <component v-else :is="b.occ.component" :group="s.key" :settings="props.settings" />
                  </template>
                  <div v-if="!blocksOf(s.key).length" class="psd-empty">
                    <p>这个分组还没有可配置项</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        <!-- 右下角 resize 把手：仅浮动模式显示，命中区域扩大到一个 16x16 隐形方块 -->
        <div
          v-if="floating"
          class="psd-resize-handle"
          aria-hidden="true"
          @mousedown="onResizeMouseDown"
        >
          <svg viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M3 13l10-10"/><path d="M7 13l6-6"/><path d="M11 13l2-2"/>
          </svg>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.psd-mask {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.06), rgba(15, 23, 42, 0.18));
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  font-family: system-ui, 'Microsoft YaHei', sans-serif;
}

/* 浮动模式下：蒙版透明、不可点击、不拦截事件，dialog 自己 fixed 定位 */
.psd-mask-hidden {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  pointer-events: none;
}
.psd-mask-hidden > * {
  pointer-events: auto;
}

.psd-dialog {
  width: min(920px, 100%);
  height: min(68vh, 780px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
  color: #374151;
  font-size: 13px;
  animation: psd-pop-in 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
  /* 给右下角 resize 把手提供定位上下文；浮动模式由内联 style 覆盖为 fixed */
  position: relative;
}

/* 浮动模式：dialog 由内联 style 给 left/top/width/height，自身不再走 flex 居中 */
.psd-dialog-floating {
  animation: none;
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
}

/* resize 进行中禁用文本选中，鼠标全局呈现 nwse-resize */
.psd-dialog-resizing,
.psd-dialog-resizing * {
  cursor: nwse-resize !important;
  user-select: none;
}

.psd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  flex-shrink: 0;
}

/* 浮动模式：整条头部都是拖手柄；点按钮时由 @mousedown 内做目标检测放过点击 */
.psd-head-draggable {
  cursor: move;
  user-select: none;
}

.psd-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.psd-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px;
}

.psd-eyebrow {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.psd-title {
  margin: 0;
  color: #111827;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
}

.psd-close {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.psd-close svg {
  width: 16px;
  height: 16px;
}

.psd-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #ef4444;
}

/* 头部"转浮动/回弹窗"图标按钮：与关闭按钮同尺寸、同底色，仅 hover 色不同 */
.psd-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  color: #6b7280;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.psd-icon-btn svg {
  width: 16px;
  height: 16px;
}

.psd-icon-btn:hover {
  background: rgba(8, 145, 178, 0.12);
  color: #0891b2;
}

/* 右下角 resize 把手：贴角放一个 16x16 图标 + 隐形放大命中区 */
.psd-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  color: #9ca3af;
  cursor: nwse-resize;
  /* 命中区向右下扩展到 18px，方便抓 */
  box-sizing: content-box;
  margin: 0;
  z-index: 2;
}

.psd-resize-handle:hover {
  color: #0891b2;
}

.psd-body {
  flex: 1;
  display: flex;
  min-height: 0;
  padding-top: 8px;
}

.psd-nav {
  /* 小屏模式优化：用百分比 + min/max 三重约束，按 dialog 自身宽度自适应，
     避免 212px 固定宽度在窄屏（弹窗默认 920px 被 flex 居中压成 600px 时）显得过分占位。 */
  flex: 0 0 auto;
  width: clamp(96px, 22%, 180px);
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  padding: 2px 4px 6px 2px;
  overflow-y: auto;
  scrollbar-width: thin;
}

/* 极窄屏（视口 ≤ 480px，整 dialog 已几乎压扁）：左侧进一步收窄到 ~88px */
@media (max-width: 480px) {
  .psd-nav {
    width: clamp(80px, 22%, 110px);
  }
  .psd-nav-item {
    padding: 6px 6px;
    min-height: 38px;
  }
  .psd-nav-txt {
    font-size: 12px;
  }
}

.psd-nav-empty {
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}

.psd-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  padding: 6px 10px;
  margin-bottom: 2px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  color: #374151;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.psd-nav-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.psd-nav-item.active {
  background: rgba(8, 145, 178, 0.12);
}

.psd-nav-item:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: -1px;
}

.psd-nav-item.slot {
  display: block;
  padding: 0;
}

.psd-nav-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.psd-nav-txt {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.psd-nav-item.active .psd-nav-txt {
  color: #0e7490;
  font-weight: 700;
}

.psd-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-left: 8px;
}

/* ===== 二级页签条（仅一级下二级分组多于一个时出现）：编辑器式下划线 tab ===== */
/* 外框：页签条 + 溢出时两侧箭头按钮，底部分隔线挂在它身上（箭头也压在这条线上） */
.psd-tabbar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.psd-tabs {
  display: flex;
  /* 整条页签在条内垂直居中，页签本身不再被拉伸 */
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  /* 上下等距：文字与两侧箭头按钮在同一水平中线上，底部留出 2px 指示线空间 */
  padding: 9px 12px;
  margin-bottom: 0;
  /* 页签多到放不下时横向滚动（滚动条隐藏，改用两侧箭头 + 滚轮），不换行、不撑破容器 */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.psd-tabs::-webkit-scrollbar {
  display: none;
}

/* 溢出时才出现的左右箭头按钮：细窄，不挤占页签高度 */
.psd-tab-arrow {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0 2px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

.psd-tab-arrow svg {
  width: 15px;
  height: 15px;
}

.psd-tab-arrow:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
}

.psd-tab-arrow:disabled {
  opacity: 0.3;
  cursor: default;
}

.psd-tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 上下等距 padding，文字正好落在页签竖直中线上 */
  padding: 7px 16px;
  border: 0;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.16s ease;
}

.psd-tab-item:hover {
  color: #111827;
}

/* active 态：文字变主题色 + 底部一条 2px 指示线 */
.psd-tab-item.active {
  color: #0891b2;
}

/* 指示线贴在页签条底边（页签条左右各有 12px 内边距，故线随内边距内缩） */
.psd-tab-item.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: #0891b2;
}

.psd-tab-item:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: -2px;
}

/* ===== 每个二级块一段（右侧长列表里叠排） ===== */
.psd-section {
  padding: 4px 0 8px;
}

/* 段标题：把"当前"段标题高亮成主题色，作为滚动定位的可读反馈 */
.psd-section-title {
  margin: 0 0 6px;
  padding: 10px 0 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

.psd-section-title.current {
  color: #0891b2;
}

.psd-section-body {
  padding-top: 2px;
}

/* 段内字段分隔交给 sf-field 自己的 border-top；段之间留白即可 */
.psd-section + .psd-section {
  margin-top: 6px;
}

.psd-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 2px 16px 20px 16px;
  min-height: 0;
  scrollbar-width: thin;
  scroll-behavior: smooth;
}

.psd-empty {
  padding: 24px 10px;
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
}

.psd-empty p {
  margin: 0;
}

/* ============ 动画 ============ */
@keyframes psd-pop-in {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* 横向滚动条已隐藏（改用两侧箭头 + 滚轮），此处不再定义 .psd-tabs 的滚动条样式 */

.psd-content-body::-webkit-scrollbar,
.psd-nav::-webkit-scrollbar {
  width: 8px;
}
.psd-content-body::-webkit-scrollbar-thumb,
.psd-nav::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.12);
}
.psd-content-body::-webkit-scrollbar-thumb:hover,
.psd-nav::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

@media (prefers-reduced-motion: reduce) {
  .psd-dialog {
    animation: none !important;
    transition: none !important;
  }
}
</style>

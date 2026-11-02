<script setup lang="ts">
/**
 * ThemeLab —— 用真实画布 + 真实插件配置做主题工作台。
 *
 * 这一版解决上一轮的三个硬问题：
 * 1) 指示线画整个工作区（不只画布里），左右色块 → 真实组件的线不会再被裁掉；
 * 2) 颜色项从 settings 已声明的 color 字段生成：插件没装就没有这一格，装了就自动出现；
 * 3) 对齐线 / Shift 框选 / 切割刀光用真实手势回放产生，全部由插件自己绘制，不再有假样张。
 *
 * 编辑始终写真实 settings（同一份 store 也驱动画布），而不是另造一套覆盖值。
 */
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  CANVAS_CONTEXT_KEY,
  CanvasHost,
  CanvasProvider,
  RenderEvents,
  currentThemeMode,
  type CanvasContext,
  type CanvasHostHandle,
} from '@mini-canvas/canvas-render'
import { MemoryStorageAdapter, GRAPH_KEY, GRAPH_EDGES_KEY, scopedKey, type CanvasNode, type CanvasEdge } from '@mini-canvas/canvas-data'
import {
  themeDefaultPlugin,
  ColorField,
  NodeEmptyState,
  DEFAULT_THEME_EDGE,
  DEFAULT_THEME_HANDLE,
  DEFAULT_THEME_DEBUG,
} from '@mini-canvas/plugin-theme-default'
import { Button } from '@mini-canvas/ui-kit-shadcn'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
import { themeLabPlugin } from './labPlugin'
import {
  buildColorEntries,
  PLUGIN_LABELS,
  GROUP_ORDER,
  OPTIONAL_PLUGINS,
  SCENE_META,
  type DeclaredColorField,
  type ThemeLabColorEntry,
  type ThemeLabMode,
  type ThemeLabScene,
} from './catalog'
import { buildGuideLine, isSvgPath, isVisibleTarget, pointOnPath, type Box } from './guide'
import { replayScene, releaseHeld, type ReplayContext } from './replay'
import { LAB_THEMES, readLabState, writeLabState, cloneThemes, type LabTheme } from './storage'
import type { LabSettingsStore } from './types'

const props = withDefaults(
  defineProps<{
    height?: number
    embedded?: boolean
    /** 设置页外壳传入的真实 settings（SettingsPanelSource）；独立页不传 */
    /** 外部注入的 settings（设置外壳给的是 SettingsPanelSource，可能缺 get） */
    settingsSource?: Partial<LabSettingsStore>
  }>(),
  { height: 660, embedded: false, settingsSource: undefined },
)

/**
 * 独立预览页没有外层 CanvasProvider；装进应用设置页时外面已经有一个。
 * 嵌入模式下：颜色读写走**主应用**的 settings，预览画布只负责显示效果。
 */
const hostCanvas = inject<CanvasContext | null>(CANVAS_CONTEXT_KEY, null)

const MODES: ThemeLabMode[] = ['light', 'dark']
const saved = readLabState()
const themes = ref<LabTheme[]>(cloneThemes(saved.themes.length ? saved.themes : LAB_THEMES))
const activeId = ref(saved.themes.some((theme) => theme.id === saved.themeId) ? saved.themeId : themes.value[0]?.id ?? 'mist')
const mode = ref<ThemeLabMode>(initialMode())
const editing = ref<string | null>(null)
const hovered = ref<string | null>(null)
const toast = ref('')
const ready = ref(false)
const bootError = ref('')
const stageEl = ref<HTMLElement | null>(null)
const boardEl = ref<HTMLElement | null>(null)
const host = ref<CanvasHostHandle | null>(null)
const scene = ref<ThemeLabScene>('base')
const providerKey = ref(0)
const fields = ref<DeclaredColorField[]>([])
const lines = ref<Array<{ id: string; color: string; d: string; start: { x: number; y: number }; end: { x: number; y: number } }>>([])
const available = reactive(new Map<string, boolean>())
const chipEls = reactive(new Map<string, HTMLElement>())
const connectedPlugins = ref<string[]>(['theme-default', 'demo-theme-lab', ...OPTIONAL_PLUGINS])

/** 预览里装了哪些可选插件（默认主题是整个画布的前提，始终在） */
const enabledPlugins = ref<string[]>([...OPTIONAL_PLUGINS])

const activePlugins = computed(() => {
  const out = [themeDefaultPlugin]
  if (enabledPlugins.value.includes('multi-select')) out.push(multiSelectPlugin)
  if (enabledPlugins.value.includes('align-guide')) out.push(alignGuidePlugin)
  if (enabledPlugins.value.includes('edge-cutting')) out.push(edgeCuttingPlugin)
  out.push(themeLabPlugin)
  return out
})

const activeTheme = computed(() => themes.value.find((theme) => theme.id === activeId.value) ?? themes.value[0])
const installed = computed(() => new Set(connectedPlugins.value))
const entries = computed(() => buildColorEntries(fields.value, installed.value))
const editingEntry = computed(() => entries.value.find((entry) => entry.id === editing.value) ?? null)
const groups = computed(() =>
  GROUP_ORDER.map((group) => ({ group, items: entries.value.filter((entry) => entry.group === group) })).filter((item) => item.items.length > 0),
)
const activeScene = computed(() => SCENE_META.find((item) => item.id === scene.value) ?? SCENE_META[0])
const sceneAvailable = computed(
  () => !activeScene.value.plugin || enabledPlugins.value.includes(activeScene.value.plugin),
)

let toastTimer = 0
let saveTimer = 0
let frame = 0
let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let settingsOff: { dispose(): void } | null = null
let selectionOff: { dispose(): void } | null = null
let replayToken = 0
let fitTimer = 0
let lastStageSize = ''

const replayCtx = (): ReplayContext => ({
  stage: stageEl.value!,
  frame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  notify: () => scheduleRedraw(),
  resetStage: () => resetAllNodes(),
})

function showToast(message: string): void {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
}

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const ok = writeLabState({ version: 1, themeId: activeId.value, mode: mode.value, themes: themes.value })
    if (!ok) showToast('浏览器不允许保存，刷新会丢')
  }, 260)
}

/* ==================== 主题库 ==================== */

function selectTheme(id: string): void {
  activeId.value = id
  editing.value = null
  persist()
  nextTick(() => {
    applyThemeToSettings()
    scheduleRedraw()
  })
}

function duplicateTheme(): void {
  const source = activeTheme.value
  if (!source) return
  const id = 'lab-' + Date.now().toString(36)
  const name = uniqueName(source.name + ' 副本')
  themes.value.push({ id, name, overrides: { ...source.overrides } })
  activeId.value = id
  persist()
  applyThemeToSettings()
  showToast('已复制成「' + name + '」')
}

function removeTheme(id: string): void {
  if (themes.value.length <= 1) return showToast('至少留一套主题')
  const theme = themes.value.find((item) => item.id === id)
  if (!theme) return
  themes.value = themes.value.filter((item) => item.id !== id)
  if (activeId.value === id) activeId.value = themes.value[0].id
  persist()
  applyThemeToSettings()
  showToast('已删除「' + theme.name + '」')
}

function uniqueName(base: string): string {
  let name = base
  let n = 2
  while (themes.value.some((theme) => theme.name === name)) name = base + ' ' + n++
  return name
}

function setMode(next: ThemeLabMode): void {
  if (mode.value === next) return
  mode.value = next
  if (props.embedded) {
    // 设置页里的亮暗只切换这张样张，不改用户整页主题；主应用仍由「外观/主题模式」控制。
    nextTick(scheduleRedraw)
    return
  }
  // 主题模式是渲染层的真实配置：只切 <html> class 会在下一次 settings 同步时被打回去
  try {
    settings()?.set('themeMode', next)
  } catch {
    /* 画布还没启动/字段被别的宿主占用：DOM class 仍按用户选择先落 */
  }
  persist()
  if (!props.embedded) syncMode()
  nextTick(scheduleRedraw)
}

function syncMode(): void {
  // 嵌入设置页时，主题模式归主应用所有：工作台不能替用户改整页亮暗
  if (props.embedded) return
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('dark', mode.value === 'dark')
}

function initialMode(): ThemeLabMode {
  if (props.embedded) {
    const raw = hostCanvas?.ctx.tryGet<{ get(key: string): unknown }>('settings')?.get('themeMode')
    if (raw === 'light' || raw === 'dark') return raw
    return currentThemeMode()
  }
  return saved.mode === 'light' ? 'light' : 'dark'
}

/* ==================== 配置读写（真实 settings） ==================== */

/** 预览画布自己的 settings：实时样张用 */
function previewSettings(): LabSettingsStore | undefined {
  return host.value?.ctx.tryGet<LabSettingsStore>('settings')
}

/** 主应用的 settings（只有嵌进设置页时存在） */
function appSettings(): LabSettingsStore | undefined {
  if (!props.embedded) return undefined
  const source = props.settingsSource as unknown as Partial<LabSettingsStore> | undefined
  if (source) {
    // 设置外壳给的是 SettingsPanelSource（没有 get / onSchemaChange）：补成工作台要的最小接口。
    return {
      has: source.has,
      get: (key) => {
        if (typeof source.get === 'function') return source.get(key)
        if (!source.groups || !source.groupOf) return undefined
        for (const group of source.groups()) {
          const item = source.groupOf(group).find((entry) => entry.key === key)
          if (item) return item.value
        }
        return undefined
      },
      set: (key, value) => source.set?.(key, value) ?? false,
      groups: () => source.groups?.() ?? [],
      groupOf: (group) => source.groupOf?.(group) ?? [],
      onChange: (cb) => source.onChange?.(cb) ?? { dispose: () => {} },
      onSchemaChange: (cb) => source.onSchemaChange?.(cb) ?? { dispose: () => {} },
    }
  }
  return hostCanvas?.ctx.tryGet<LabSettingsStore>('settings')
}

/** 编辑的写入口：嵌入时改主应用，独立页改预览画布 */
function settings(): LabSettingsStore | undefined {
  return props.embedded ? appSettings() : previewSettings()
}

/**
 * 把主应用当前配色镜像进预览画布。
 *
 * 预览是另一块内核（内存存储、不碰用户画布），不会自动获得主应用的 settings；
 * 这里只复制已声明的 color 字段，让样张看到的就是主界面正在用的颜色。
 */
function mirrorThemeToPreview(): void {
  if (!props.embedded) return
  const source = settings()
  const target = previewSettings()
  if (!source || !target) return
  for (const entry of entries.value) {
    for (const key of [entry.keys.light, entry.keys.dark]) {
      if (target.has && !target.has(key)) continue
      const value = source.get(key)
      if (typeof value !== 'string') continue
      try {
        target.set(key, value)
      } catch {
        /* 预览里该插件没装：这一格没有预览宿主，跳过 */
      }
    }
  }
  requestAnimationFrame(scheduleRedraw)
}

/** 从 settings 的「外观/主题配色」「外观/暗色主题配色」两组里收真实 color 字段 */
function readFields(): DeclaredColorField[] {
  const store = settings()
  if (!store) return []
  const out: DeclaredColorField[] = []
  for (const group of store.groups()) {
    if (!group.startsWith('外观/')) continue
    for (const item of store.groupOf(group)) {
      if (item.schema.type !== 'color') continue
      out.push({ group, key: item.key, schema: item.schema, value: item.value })
    }
  }
  return out
}

function keyFor(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
  return forMode === 'light' ? entry.keys.light : entry.keys.dark
}

function valueOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
  const store = settings()
  const key = keyFor(entry, forMode)
  const raw = store?.get(key)
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value) return value
  if (entry.followKey) return followColor(entry.followKey, forMode)
  return forMode === 'light' ? entry.defaults.light : entry.defaults.dark
}

/** 清空 = 跟随主题；实时预览要把“跟随”解析成看得见的颜色 */
function followColor(base: string, forMode: ThemeLabMode): string {
  const store = settings()
  if (!store) return ''
  const target = entries.value.find((item) => item.id === base)
  if (!target) return ''
  return valueOf(target, forMode)
}

/**
 * 把主题套进真实 settings。
 *
 * 这里只有一个通道：settings.set → 插件订阅 → 组件。没有另存一份“预览覆盖值”，
 * 所以色块显示什么、画布就是什么；切换主题 = 把这份 JSON 写进同一批字段。
 */
function applyThemeToSettings(): void {
  const store = settings()
  const theme = activeTheme.value
  if (!store || !theme) return
  const known = new Set(entries.value.flatMap((entry) => [entry.keys.light, entry.keys.dark]))
  for (const [key, value] of Object.entries(theme.overrides)) {
    if (!known.has(key)) continue
    try {
      store.set(key, value)
    } catch {
      /* 插件可能刚被卸掉：忽略已消失的 key */
    }
  }
  // 主题里没写的格子恢复成默认值，避免“切主题后还留着上一套的颜色”
  for (const entry of entries.value) {
    for (const key of [entry.keys.light, entry.keys.dark]) {
      if (key in theme.overrides) continue
      const fallback = key.endsWith('Dark') ? entry.defaults.dark : entry.defaults.light
      const schemaDefault = fieldDefault(key, fallback)
      try {
        if (String(store.get(key) ?? '') !== schemaDefault) store.set(key, schemaDefault)
      } catch {
        /* 同上 */
      }
    }
  }
}

function fieldDefault(key: string, fallback: string): string {
  return fields.value.find((field) => field.key === key)?.schema.default?.toString() ?? fallback
}

function setValue(entry: ThemeLabColorEntry, next: string): void {
  const store = settings()
  const theme = activeTheme.value
  if (!store || !theme) return
  const key = keyFor(entry)
  const value = (next || '').trim()
  if (value && !/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    showToast('颜色要写成 #RRGGBB 或 #RRGGBBAA')
    return
  }
  if (!value && !entry.optional) return
  try {
    store.set(key, value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '这个字段已经不可用')
    return
  }
  if (value) theme.overrides[key] = value
  else delete theme.overrides[key]
  persist()
  requestAnimationFrame(scheduleRedraw)
}

function clearValue(entry: ThemeLabColorEntry): void {
  setValue(entry, '')
}

function exportTheme(): void {
  const theme = activeTheme.value
  if (!theme?.overrides || Object.keys(theme.overrides).length === 0) {
    showToast('当前主题还没有覆盖任何颜色')
    return
  }
  const payload = {
    name: theme.name,
    mode: mode.value,
    colors: Object.fromEntries(Object.entries(theme.overrides)),
  }
  void navigator.clipboard
    ?.writeText(JSON.stringify(payload, null, 2))
    .then(() => showToast('主题 JSON 已复制'))
    .catch(() => showToast('复制失败，请手动选择'))
}

/* ==================== 插件开关 / 场景 ==================== */

function togglePlugin(name: string): void {
  if (!OPTIONAL_PLUGINS.includes(name as (typeof OPTIONAL_PLUGINS)[number])) return
  const next = new Set(enabledPlugins.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  enabledPlugins.value = OPTIONAL_PLUGINS.filter((item) => next.has(item))
  if (!props.embedded) connectedPlugins.value = ['theme-default', 'demo-theme-lab', ...enabledPlugins.value]
  if (scene.value !== 'base' && !sceneAvailableFor(scene.value)) {
    scene.value = 'base'
  }
  providerKey.value += 1
  ready.value = false
  nextTick(() => {
    syncMode()
    scheduleRedraw()
  })
}

function sceneAvailableFor(id: ThemeLabScene): boolean {
  const meta = SCENE_META.find((item) => item.id === id)
  return !meta?.plugin || enabledPlugins.value.includes(meta.plugin)
}

async function selectScene(id: ThemeLabScene): Promise<void> {
  if (!sceneAvailableFor(id)) {
    const meta = SCENE_META.find((item) => item.id === id)
    showToast('需要先安装 ' + (PLUGIN_LABELS[meta?.plugin ?? ''] ?? meta?.plugin ?? '对应插件'))
    return
  }
  releaseHeld(replayCtx())
  resetAllNodes()
  const token = ++replayToken
  scene.value = id
  seekSceneSelection(id)
  scheduleRedraw()
  if (id === 'align' || id === 'box' || id === 'cut') {
    await nextTick()
    await replayScene(id, replayCtx())
    if (token !== replayToken) return
  }
  burstRedraw()
}

/**
 * 把四个真实节点放回标准位。
 *
 * 对齐回放会真实拖动节点；如果每次都从上次留下的位置继续，几轮之后节点会跑到画布外。
 * 走 graph 的唯一写入口，所以拖动历史/渲染态仍然一致。
 */
function resetAllNodes(): void {
  const h = host.value
  if (!h) return
  const home: Record<string, { x: number; y: number }> = {
    'lab-text': { x: 60, y: 84 },
    'lab-image': { x: 420, y: 60 },
    'lab-warning': { x: 60, y: 300 },
    'lab-danger': { x: 60, y: 440 },
  }
  const patches = Object.entries(home)
    .filter(([id]) => Boolean(h.nodeStore.getNode(id)))
    .map(([id, position]) => ({ id, patch: { position } }))
  if (!patches.length) return
  h.graph.updateNodes(patches)
  requestAnimationFrame(() => {
    if (host.value !== h) return
    // 节点就地回位后再取景一次，保证用户看到的就是标准舞台
    h.view.fitView(0.14)
    burstRedraw()
  })
}

/** 插件/画布改 DOM 是分几帧完成的：多补几帧，指示线才不会停在旧目标上 */
function burstRedraw(): void {
  for (const delay of [0, 60, 140, 280, 520, 900]) window.setTimeout(scheduleRedraw, delay)
}

/**
 * 把预览里的四个真实节点放进可见区。
 *
 * CanvasHost 在 persistViewport=false 时刻意不自动取景（不替调用方动视口）；
 * 工作台预览需要在桌面和窄屏都完整看见画布内容，所以由这里显式调用同一套 ViewService。
 */
function fitPreview(): void {
  if (!ready.value || !host.value) return
  host.value.view.fitView(0.14)
  burstRedraw()
}

/** 只有舞台尺寸真的变了才重新取景；编辑面板展开/指示线重绘不会打乱用户正在看的视角 */
function fitOnStageResize(): void {
  const stage = stageEl.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const size = Math.round(rect.width) + 'x' + Math.round(rect.height)
  if (size === lastStageSize) return
  lastStageSize = size
  clearTimeout(fitTimer)
  fitTimer = window.setTimeout(fitPreview, 180)
}

/**
 * 场景的“布景”全部走真实服务：
 * - base：选中一条边，CustomEdge 才会跑流光；
 * - multi：选中两个真实节点，多选插件才会画内外框；
 * - align：清空选中（多选拖动不对齐），由回放拖一次节点；
 * - box/cut：清空选中，由回放生成真实绘制框 / 刀光。
 */
function seekSceneSelection(id: ThemeLabScene): void {
  const h = host.value
  if (!h) return
  if (id === 'base') {
    h.selection.set([])
    h.selection.setEdges(['lab-edge'])
  } else if (id === 'multi') {
    h.selection.setEdges([])
    h.selection.set(['lab-text', 'lab-image'])
  } else {
    h.selection.clear()
  }
}

/* ==================== 指示线 ==================== */

function registerChip(id: string, element: Element | null): void {
  if (element instanceof HTMLElement) chipEls.set(id, element)
  else chipEls.delete(id)
}

/**
 * Vue 的 ref 回调按渲染顺序执行：列表少一格时，后面的色块会复用同一个回调，
 * 于是 Map 里可能留下“旧 id → 新元素”。这里直接按 DOM 补齐，保证 id 与色块一一对应。
 */
function syncChipRefs(): void {
  const board = boardEl.value
  if (!board) return
  for (const entry of entries.value) {
    const el = board.querySelector<HTMLElement>('[data-chip-id="' + entry.id + '"]')
    if (el) chipEls.set(entry.id, el)
  }
}

function scheduleRedraw(): void {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(draw)
}

function draw(): void {
  const board = boardEl.value
  const stage = stageEl.value
  if (!board || !stage) return
  syncChipRefs()
  // 先清掉上一帧对“多选/对齐/切割”目标的通知：这些目标只在特定场景存在，
  // 场景切换后必须让状态重新算，不能沿用旧值。
  for (const entry of entries.value) available.delete(entry.id)
  const boardRect = board.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const next: typeof lines.value = []
  for (const entry of entries.value) {
    const chip = chipEls.get(entry.id)
    if (!chip || !board.contains(chip)) {
      available.set(entry.id, false)
      continue
    }
    const chipRect = chip.getBoundingClientRect()
    const chipBox: Box = {
      x: chipRect.left - boardRect.left,
      y: chipRect.top - boardRect.top,
      w: chipRect.width,
      h: chipRect.height,
    }
    const anchor = pickAnchor(entry)
    if (!anchor) {
      available.set(entry.id, false)
      continue
    }
    const point = resolveAnchorPoint(anchor)
    if (!point) {
      available.set(entry.id, false)
      continue
    }
    const targetBox: Box = {
      x: point.rect.left - boardRect.left,
      y: point.rect.top - boardRect.top,
      w: Math.max(2, point.rect.width),
      h: Math.max(2, point.rect.height),
    }
    const line = buildGuideLine(chipBox, targetBox, { x: point.x - boardRect.left, y: point.y - boardRect.top })
    next.push({
      id: entry.id,
      color: valueOf(entry),
      d: line.d,
      start: line.start,
      end: line.end,
    })
    available.set(entry.id, true)
  }
  lines.value = next
  // 画布矩形只是用于“完全在画布外就不画”的可选过滤；这里保留以便以后加裁剪
  void stageRect
}

function pickAnchor(entry: ThemeLabColorEntry): ThemeLabColorEntry['anchors'][number] | null {
  for (const anchor of entry.anchors) {
    if (anchor.scenes && !anchor.scenes.includes(scene.value)) continue
    if (anchor.plugin && !installed.value.has(anchor.plugin)) continue
    const root = anchor.scope === 'document' ? document : stageEl.value
    const element = root?.querySelector(anchor.selector) ?? null
    if (isVisibleTarget(element)) return anchor
  }
  return null
}

function resolveAnchorPoint(
  anchor: ThemeLabColorEntry['anchors'][number],
): { x: number; y: number; rect: DOMRect } | null {
  const root = anchor.scope === 'document' ? document : stageEl.value
  const element = root?.querySelector(anchor.selector) ?? null
  if (!isVisibleTarget(element)) return null
  const rect = element.getBoundingClientRect()
  if (isSvgPath(element) && anchor.pathAt !== undefined) {
    const point = pointOnPath(element, anchor.pathAt)
    if (!point) return null
    return { ...point, rect }
  }
  const at = anchor.at ?? 'center'
  return {
    x: rect.left + rect.width * (at === 'left' ? 0.16 : at === 'right' ? 0.84 : 0.5),
    y: rect.top + rect.height * (at === 'top' ? 0.14 : at === 'bottom' ? 0.86 : 0.5),
    rect: anchor.thin ? new DOMRect(rect.left - 5, rect.top, 10, Math.max(rect.height, 6)) : rect,
  }
}

/* ==================== 画布启动 / 订阅 ==================== */

function onReady(nextHost: CanvasHostHandle): void {
  host.value = nextHost
  ready.value = true
  // 嵌入时颜色是否显示由“主应用 settings 有没有这个字段”决定：
  // 字段只在声明它的插件已安装时存在，不再拿预览开关二次过滤。
  connectedPlugins.value = props.embedded
    ? ['theme-default', 'demo-theme-lab', ...OPTIONAL_PLUGINS]
    : ['theme-default', 'demo-theme-lab', ...enabledPlugins.value]
  settingsOff?.dispose()
  selectionOff?.dispose()
  const store = settings()
  if (store) {
    fields.value = readFields()
    settingsOff = store.onChange((key) => {
      fields.value = readFields()
      if (key === 'themeMode') {
        const next = store.get('themeMode')
        if ((next === 'light' || next === 'dark') && next !== mode.value) {
          mode.value = next
          persist()
        }
      }
      if (key.endsWith('Color') || key.startsWith('multiSelect') || key === 'pathColor' || key === 'bladeColor') {
        if (props.embedded) mirrorThemeToPreview()
        scheduleRedraw()
      }
    })
    // schema 变化 = 插件装/卸：颜色格跟着增减
    const schemaOff = store.onSchemaChange?.(() => {
      fields.value = readFields()
      nextTick(scheduleRedraw)
    })
    if (schemaOff) {
      const prev = settingsOff
      settingsOff = {
        dispose: () => {
          prev?.dispose()
          schemaOff.dispose()
        },
      }
    }
    if (props.embedded) {
      // 主应用是唯一真源：打开工作台不改用户已经选好的主题
      const current = store.get('themeMode')
      if (current === 'light' || current === 'dark') mode.value = current
    } else {
      // 独立页：工作台选择优先，刷新后仍按存档的亮/暗显示
      try {
        store.set('themeMode', mode.value)
      } catch {
        /* 设置字段缺失时保持 DOM 现状 */
      }
      applyThemeToSettings()
    }
    mirrorThemeToPreview()
  }
  selectionOff = nextHost.ctx.on(RenderEvents.SelectionChange, () => scheduleRedraw())
  // 插件开关会重建 CanvasProvider：重新按当前场景布景，别让多选/对齐/框选停在空画布上
  if (scene.value === 'base') {
    seekSceneSelection('base')
  } else {
    seekSceneSelection(scene.value)
    if (sceneAvailableFor(scene.value) && scene.value !== 'multi') {
      const token = ++replayToken
      window.setTimeout(() => {
        if (!ready.value || token !== replayToken) return
        void replayScene(scene.value, replayCtx()).then(() => {
          if (token === replayToken) burstRedraw()
        })
      }, 220)
    }
  }
  scheduleRedraw()
  burstRedraw()
  // 节点尺寸是挂载后量出来的：等两轮量测落定再取景一次
  window.setTimeout(fitPreview, 80)
  window.setTimeout(fitPreview, 360)
}

function onBootError(error: Error): void {
  bootError.value = error.message
  ready.value = false
}

/**
 * 嵌入设置页：没有预览画布，直接读主应用 settings。
 *
 * 这里只订阅主应用的变化，不再往任何 DOM 根写主题变量。配色值本来就已经由
 * canvas-render 的色板桥写到 document.documentElement，工作台只负责读它、改它。
 */
function bindAppSettings(): void {
  const store = settings()
  if (!store) return
  fields.value = readFields()
  connectedPlugins.value = ['theme-default', 'demo-theme-lab', ...OPTIONAL_PLUGINS]
  const current = store.get('themeMode')
  if (current === 'light' || current === 'dark') mode.value = current
  settingsOff = store.onChange((key) => {
    fields.value = readFields()
    if (key === 'themeMode') {
      const next = store.get('themeMode')
      if ((next === 'light' || next === 'dark') && next !== mode.value) mode.value = next
    }
  })
  const schemaOff = store.onSchemaChange?.(() => {
    fields.value = readFields()
  })
  if (schemaOff) {
    const prev = settingsOff
    settingsOff = {
      dispose: () => {
        prev?.dispose()
        schemaOff.dispose()
      },
    }
  }
}

function mountObservers(): void {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      scheduleRedraw()
      fitOnStageResize()
    })
    if (boardEl.value) resizeObserver.observe(boardEl.value)
    if (stageEl.value) resizeObserver.observe(stageEl.value)
  }
  if (typeof MutationObserver !== 'undefined' && stageEl.value) {
    mutationObserver = new MutationObserver(() => scheduleRedraw())
    mutationObserver.observe(stageEl.value, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
  }
  window.addEventListener('resize', scheduleRedraw)
  window.addEventListener('scroll', scheduleRedraw, true)
}

onMounted(() => {
  syncMode()
  mountObservers()
  if (props.embedded) {
    // 嵌入设置页时没有预览画布，onReady 不会触发；直接绑定主应用的 settings。
    bindAppSettings()
  }
})

onBeforeUnmount(() => {
  releaseHeld(replayCtx())
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  window.removeEventListener('resize', scheduleRedraw)
  window.removeEventListener('scroll', scheduleRedraw, true)
  settingsOff?.dispose()
  selectionOff?.dispose()
  cancelAnimationFrame(frame)
  clearTimeout(fitTimer)
  clearTimeout(saveTimer)
  clearTimeout(toastTimer)
})

watch(mode, () => {
  syncMode()
  scheduleRedraw()
})

/* ==================== 展示辅助 ==================== */

function chipStyle(entry: ThemeLabColorEntry): Record<string, string> {
  const color = valueOf(entry) || '#0891b2' // 主题色白名单: 独立预览页的兜底色（真实颜色始终来自 settings）
  return { '--chip': color, '--chip-ink': inkFor(color) }
}

function inkFor(hex: string): string {
  const value = hex.replace('#', '').slice(0, 6)
  if (value.length !== 6) return '#fff' // 主题色白名单: 对比度计算的兜底返回值
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? '#12201c' : '#fff' // 主题色白名单: 对比度计算选黑/白字，属几何常量
}

function chipStatus(entry: ThemeLabColorEntry): string {
  if (!entry.bound) return '未绑定画布目标'
  if (available.get(entry.id)) return valueOf(entry) || '跟随主题'
  return entry.inactiveHint || '当前场景里没有这个元素'
}

function sceneHint(id: ThemeLabScene): string {
  const meta = SCENE_META.find((item) => item.id === id)
  if (meta?.plugin && !enabledPlugins.value.includes(meta.plugin)) {
    return '需要安装 ' + (PLUGIN_LABELS[meta.plugin] ?? meta.plugin)
  }
  return meta?.hint ?? ''
}

/** 当前页面是否亮色（用于 CSS 变量兜底，避免工作台自身写死配色） */
const pageMode = computed(() => currentThemeMode())
</script>

<template>
  <div class="lab-root" :class="{ 'is-light': mode === 'light', 'is-embedded': props.embedded }" :data-mode="mode">
    <!--
      嵌入设置页：不再启动第二块内核。临时内核会把「外观」色板和亮暗模式再写一次到
      <html>，与主应用互相覆盖；这里改用真实主题组件拼一张实时样张，颜色仍全部来自
      主应用 settings，改色时立刻反映在这张卡上。
    -->
    <template v-if="props.embedded">
      <section class="lab-embed-preview" aria-label="主题实时预览">
        <div class="lab-embed-preview-head">
          <div>
            <p class="lab-eyebrow">实时预览</p>
            <h2>颜色就在真实组件上</h2>
          </div>
          <div class="lab-mode" role="group" aria-label="亮色或暗色">
            <button v-for="item in MODES" :key="item" type="button" :class="{ active: mode === item }" @click="setMode(item)">
              {{ item === 'light' ? '亮色' : '暗色' }}
            </button>
          </div>
        </div>

        <div class="lab-embed-stage" :class="{ 'is-dark': mode === 'dark' }">
          <div class="lab-embed-node">
            <div class="lab-embed-node-head">
              <span class="lab-embed-node-dot" aria-hidden="true"></span>
              <span>灵感卡片</span>
              <span class="lab-embed-node-size">300 × 170</span>
            </div>
            <p class="lab-embed-node-body">节点边框、标题、控制栏和端口都跟着主题颜色一起变。</p>
            <div class="lab-embed-node-bar">
              <Button class="mck-toolbar-btn mck-toolbar-btn--primary" variant="default" size="sm" type="button" title="确认" aria-label="确认" data-lab="accent-action">确认</Button>
              <Button class="mck-toolbar-btn" variant="ghost" size="sm" type="button" title="更多操作" aria-label="更多操作">更多</Button>
              <Button class="mck-toolbar-btn mck-toolbar-btn--danger" variant="destructive" size="sm" type="button" title="删除" aria-label="删除">删除</Button>
            </div>
            <span class="lab-embed-port lab-embed-port--left" aria-hidden="true"></span>
            <span class="lab-embed-port lab-embed-port--right" aria-hidden="true"></span>
          </div>

          <div class="lab-embed-states">
            <div class="lab-embed-state" data-lab="warn-state">
              <NodeEmptyState tone="warning" text="待确认" description="检查后才会继续" />
            </div>
            <div class="lab-embed-state" data-lab="danger-state">
              <NodeEmptyState tone="danger" text="素材已失效" description="请重新上传" />
            </div>
          </div>

          <div class="lab-embed-flow" aria-hidden="true">
            <span class="lab-embed-flow-rail"></span>
            <span class="lab-embed-flow-dot"></span>
          </div>
        </div>

        <p class="lab-embed-note">颜色格来自已声明这些颜色的插件：装了就出现，没装就不会假装存在。</p>
      </section>

      <section v-if="editingEntry" class="lab-embed-editor" aria-live="polite">
        <div class="lab-embed-editor-head">
          <span class="lab-embed-editor-swatch" :style="{ '--chip': valueOf(editingEntry) }"></span>
          <div class="lab-embed-editor-title">
            <h3>{{ editingEntry.label }}</h3>
            <p>{{ editingEntry.description }}</p>
          </div>
          <button class="lab-icon-btn" type="button" aria-label="关闭编辑" @click="editing = null">×</button>
        </div>
        <div class="lab-embed-editor-row">
          <span class="lab-embed-key">{{ keyFor(editingEntry) }}</span>
          <span class="lab-embed-plugin">{{ editingEntry.pluginLabel }}</span>
        </div>
        <ColorField
          :model-value="valueOf(editingEntry)"
          :clearable="editingEntry.optional"
          :aria-label="'选择' + editingEntry.label"
          @update:model-value="setValue(editingEntry, $event)"
        />
        <div class="lab-embed-editor-foot">
          <button v-if="editingEntry.optional" type="button" class="lab-link" @click="clearValue(editingEntry)">清空，跟随主题</button>
          <span>{{ editingEntry.optional ? '清空后会跟随主题强调色' : '这个颜色必须有一个值' }}</span>
        </div>
        <p class="lab-embed-editor-chain">
          {{ editingEntry.chain.join(' → ') }}
        </p>
      </section>

      <section class="lab-embed-groups" aria-label="可编辑的颜色">
        <div v-if="!entries.length" class="lab-embed-empty">
          当前没有可编辑的主题颜色。安装默认主题后，这里会出现配色格。
        </div>
        <div v-for="group in groups" :key="group.group" class="lab-embed-group">
          <div class="lab-embed-group-head">
            <h3>{{ group.group }}</h3>
            <span>{{ group.items.length }} 项</span>
          </div>
          <div class="lab-embed-grid">
            <button
              v-for="entry in group.items"
              :key="entry.id"
              :data-chip-id="entry.id"
              type="button"
              class="lab-embed-chip"
              :class="{ active: editing === entry.id, unbound: !entry.bound }"
              :style="chipStyle(entry)"
              @click="editing = entry.id"
            >
              <span class="lab-embed-chip-swatch" aria-hidden="true"></span>
              <span class="lab-embed-chip-copy">
                <strong>{{ entry.label }}</strong>
                <small>{{ valueOf(entry) || '跟随主题' }}</small>
              </span>
              <span class="lab-embed-chip-plugin">{{ entry.pluginLabel }}</span>
            </button>
          </div>
        </div>
      </section>

      <div class="lab-toast" :class="{ show: toast }">{{ toast }}</div>
    </template>

    <template v-else>
    <header class="lab-head">
      <div class="lab-head-copy">
        <p class="lab-eyebrow">外观 / 主题工作台</p>
        <h1>颜色长在真实组件上</h1>
        <p class="lab-lede">
          改一处颜色，画布、连线、选框和刀光一起变。颜色项来自插件已声明的配置：
          <span class="lab-inline-strong">装了就出现，没装就没有</span>。
        </p>
      </div>
      <div class="lab-head-actions">
        <div class="lab-mode" role="group" aria-label="亮色或暗色">
          <button v-for="item in MODES" :key="item" type="button" :class="{ active: mode === item }" @click="setMode(item)">
            {{ item === 'light' ? '亮色' : '暗色' }}
          </button>
        </div>
        <button v-if="!props.embedded" class="lab-btn" type="button" @click="duplicateTheme">复制当前</button>
        <button v-if="!props.embedded" class="lab-btn" type="button" @click="exportTheme">导出 JSON</button>
      </div>
    </header>

    <div class="lab-toolbar">
      <div v-if="!props.embedded" class="lab-themes" role="list" aria-label="主题">
        <div v-for="theme in themes" :key="theme.id" class="lab-theme" :class="{ active: theme.id === activeId }" role="listitem">
          <button type="button" class="lab-theme-main" @click="selectTheme(theme.id)">
            <span class="lab-theme-dots" aria-hidden="true">
              <i :style="{ background: theme.overrides['accentColorDark'] || '#22d3ee' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
              <i :style="{ background: theme.overrides['edgeFlowColorDark'] || '#22d3ee' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
              <i :style="{ background: theme.overrides['dangerColorDark'] || '#f87171' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
              <i :style="{ background: theme.overrides['warnColorDark'] || '#fbbf24' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
            </span>
            <span class="lab-theme-name">{{ theme.name }}</span>
            <span class="lab-theme-meta">{{ Object.keys(theme.overrides).length }} 项</span>
          </button>
          <button v-if="theme.id === activeId && themes.length > 1" class="lab-theme-del" type="button" aria-label="删除当前主题" @click="removeTheme(theme.id)">×</button>
        </div>
      </div>

      <div class="lab-plugins" aria-label="预览里装哪些插件">
        <span class="lab-plugins-label">预览插件</span>
        <span class="lab-plugin on locked" title="默认主题是画布前提，始终启用">
          <span class="lab-plugin-dot"></span>默认主题
        </span>
        <button
          v-for="name in OPTIONAL_PLUGINS"
          :key="name"
          type="button"
          class="lab-plugin"
          :class="{ on: enabledPlugins.includes(name) }"
          @click="togglePlugin(name)"
        >
          <span class="lab-plugin-dot"></span>{{ PLUGIN_LABELS[name] }}
        </button>
      </div>
    </div>

    <nav class="lab-scenes" aria-label="预览场景">
      <button
        v-for="item in SCENE_META"
        :key="item.id"
        type="button"
        class="lab-scene"
        :class="{ active: scene === item.id, blocked: item.plugin ? !enabledPlugins.includes(item.plugin) : false }"
        @click="selectScene(item.id)"
      >
        <span class="lab-scene-label">{{ item.label }}</span>
        <span v-if="item.plugin" class="lab-scene-plugin">{{ PLUGIN_LABELS[item.plugin] }}</span>
      </button>
    </nav>
    <p class="lab-scene-hint">{{ sceneHint(scene) }}</p>

    <div ref="boardEl" class="lab-board">
      <aside class="lab-rail lab-rail--left" aria-label="品牌与语义颜色">
        <template v-for="group in groups.filter((item) => item.group === '品牌' || item.group === '连线' || item.group === '其它')" :key="group.group">
          <p class="lab-rail-title">{{ group.group }}</p>
          <button
            v-for="entry in group.items"
            :key="entry.id"
            :ref="(el) => registerChip(entry.id, el as Element | null)"
            :data-chip-id="entry.id"
            type="button"
            class="lab-chip"
            :class="{ active: editing === entry.id, hot: hovered === entry.id, unbound: !entry.bound }"
            :style="chipStyle(entry)"
            @mouseenter="hovered = entry.id"
            @mouseleave="hovered = null"
            @click="editing = entry.id"
          >
            <span class="lab-chip-swatch">{{ entry.group === '连线' ? '线' : entry.label.slice(0, 1) }}</span>
            <span class="lab-chip-copy">
              <strong>{{ entry.label }}</strong>
              <small>{{ chipStatus(entry) }}</small>
            </span>
            <span class="lab-chip-badge" :class="{ live: available.get(entry.id) }">{{ available.get(entry.id) ? '●' : '○' }}</span>
          </button>
        </template>
      </aside>

      <section class="lab-stage-wrap" aria-label="真实画布预览">
        <div ref="stageEl" class="lab-stage" :style="{ height: props.height + 'px' }">
          <CanvasProvider
            :key="providerKey"
            :plugins="activePlugins"
            :adapter="newAdapter()"
            :persist-settings="false"
            @ready="onReady"
            @boot-error="onBootError"
          >
            <CanvasHost
              :persist-viewport="false"
              :edge-visual="{ ...DEFAULT_THEME_EDGE }"
              :handle-visual="{ ...DEFAULT_THEME_HANDLE }"
              :debug-visual="{ ...DEFAULT_THEME_DEBUG }"
            />
            <template #error>
              <p class="lab-boot-error">画布启动失败：{{ bootError }}</p>
            </template>
          </CanvasProvider>

          <div class="lab-stage-top">
            <span class="lab-live" :class="{ ready }"><i></i>{{ ready ? '真实画布' : '正在启动…' }}</span>
            <span class="lab-scene-pill">{{ activeScene.label }}</span>
            <span v-if="!sceneAvailable" class="lab-scene-missing">这个场景需要安装对应插件</span>
          </div>
        </div>
        <p class="lab-stage-foot">
          每条线都量自真实 DOM。没有目标的颜色会明确标为“未绑定”，不会画假线。
        </p>
      </section>

      <aside class="lab-rail lab-rail--right" aria-label="选择与切割颜色">
        <template v-for="group in groups.filter((item) => item.group === '选择' || item.group === '切割')" :key="group.group">
          <p class="lab-rail-title">{{ group.group }}</p>
          <button
            v-for="entry in group.items"
            :key="entry.id"
            :ref="(el) => registerChip(entry.id, el as Element | null)"
            :data-chip-id="entry.id"
            type="button"
            class="lab-chip"
            :class="{ active: editing === entry.id, hot: hovered === entry.id, unbound: !entry.bound }"
            :style="chipStyle(entry)"
            @mouseenter="hovered = entry.id"
            @mouseleave="hovered = null"
            @click="editing = entry.id"
          >
            <span class="lab-chip-swatch">{{ entry.label.slice(0, 1) }}</span>
            <span class="lab-chip-copy">
              <strong>{{ entry.label }}</strong>
              <small>{{ chipStatus(entry) }}</small>
            </span>
            <span class="lab-chip-badge" :class="{ live: available.get(entry.id) }">{{ available.get(entry.id) ? '●' : '○' }}</span>
          </button>
        </template>
        <p v-if="!groups.some((item) => item.group === '选择' || item.group === '切割')" class="lab-rail-empty">
          当前没有可编辑的选择 / 切割颜色。安装对应插件后，这里会自动多出颜色格。
        </p>
      </aside>

      <svg class="lab-lines" aria-hidden="true">
        <g
          v-for="line in lines"
          :key="line.id"
          class="lab-line"
          :class="{ hot: hovered === line.id, dim: hovered !== null && hovered !== line.id }"
          :style="{ '--line-color': line.color }"
        >
          <path :d="line.d" />
          <circle :cx="line.start.x" :cy="line.start.y" r="2.6" />
          <circle class="lab-line-end" :cx="line.end.x" :cy="line.end.y" r="4.6" />
          <circle class="lab-line-dot" :cx="line.end.x" :cy="line.end.y" r="1.8" />
        </g>
      </svg>
    </div>

    <section v-if="editingEntry" class="lab-editor" aria-live="polite">
      <div class="lab-editor-main">
        <div class="lab-editor-head">
          <span class="lab-editor-swatch" :style="{ '--chip': valueOf(editingEntry) }"></span>
          <div>
            <h2>{{ editingEntry.label }}</h2>
            <p>{{ editingEntry.description }} · {{ editingEntry.affects }}</p>
          </div>
          <button class="lab-icon-btn" type="button" aria-label="关闭编辑" @click="editing = null">×</button>
        </div>
        <div class="lab-editor-row">
          <span class="lab-editor-key">{{ keyFor(editingEntry) }}</span>
          <span class="lab-editor-plugin">{{ editingEntry.pluginLabel }}</span>
        </div>
        <div class="lab-editor-body">
          <ColorField
            :model-value="valueOf(editingEntry)"
            :clearable="editingEntry.optional"
            :aria-label="'选择' + editingEntry.label"
            @update:model-value="setValue(editingEntry, $event)"
          />
          <button v-if="editingEntry.optional" type="button" class="lab-link" @click="clearValue(editingEntry)">清空，跟随主题</button>
        </div>
        <p class="lab-editor-note">{{ chipStatus(editingEntry) }}</p>
      </div>
      <div class="lab-chain">
        <p class="lab-chain-title">这个颜色怎么走到组件</p>
        <ol>
          <li v-for="(step, index) in editingEntry.chain" :key="step + index"><span>{{ index + 1 }}</span>{{ step }}</li>
        </ol>
        <p class="lab-chain-foot">
          新增颜色时，插件在自己的 Config 里加 <code>type: 'color'</code> 字段即可；
          想连到画布，再加一条锚点。没有锚点也会出现在这里，并标成“未绑定”。
        </p>
      </div>
    </section>

    <div class="lab-toast" :class="{ show: toast }">{{ toast }}</div>
    </template>
  </div>
</template>

<script lang="ts">
/**
 * 画布数据：每次切换插件都重建一份内存存储，保证“没装插件时画布上也没有它的元素”。
 * 放在普通 script 里是为了让 setup 的模板可以直接调用（不引入额外的响应式开销）。
 */
import { MemoryStorageAdapter as MSAdapter, GRAPH_KEY as G_KEY, GRAPH_EDGES_KEY as E_KEY, scopedKey as sKey } from '@mini-canvas/canvas-data'
import type { CanvasNode as CNode, CanvasEdge as CEdge } from '@mini-canvas/canvas-data'

const NODES: CNode[] = [
  { id: 'lab-text', type: 'lab-text', position: { x: 60, y: 84 }, data: { text: '主题改色时，节点壳、端口和连线会一起变。' } },
  { id: 'lab-image', type: 'lab-image', position: { x: 420, y: 60 }, data: { title: '海边房间', subtitle: '示例图片节点' } },
  {
    id: 'lab-warning',
    type: 'lab-warning',
    position: { x: 60, y: 300 },
    data: { tone: 'warning', text: '待确认', description: '检查后才会继续' },
  },
  {
    id: 'lab-danger',
    type: 'lab-danger',
    position: { x: 60, y: 440 },
    data: { tone: 'danger', text: '素材已失效', description: '请重新上传' },
  },
]

const EDGES: CEdge[] = [
  { id: 'lab-edge', source: 'lab-text', target: 'lab-image', sourceHandle: 'source', targetHandle: 'target' },
]

function newAdapter(): MSAdapter {
  const adapter = new MSAdapter()
  void adapter.set(sKey('canvas', G_KEY), NODES)
  void adapter.set(sKey('canvas', E_KEY), EDGES)
  return adapter
}
</script>

<style scoped>
.lab-root {
  /* 工作台自己的外观也走真实主题变量：改强调色时，页头的焦点、选中主题的描边同步变化 */
  color: var(--ui-ink, #17211f);
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  background: var(--ui-app-bg, #f7f9f8);
}

.lab-root.is-light {
  background: var(--ui-app-bg, #f4f7f5);
}

/* 设置页嵌入：外框/页头归应用设置外壳，工作台只当内容区 */
.lab-root.is-embedded {
  background: transparent;
}

.lab-root.is-embedded .lab-head {
  display: none;
}

.lab-root.is-embedded .lab-toolbar {
  padding-top: 2px;
}

.lab-root.is-embedded .lab-board {
  padding-right: 0;
  padding-left: 0;
}

.lab-root.is-embedded .lab-editor {
  margin-right: 0;
  margin-left: 0;
}

/* ==================== 设置页嵌入（不启动第二块内核） ==================== */

.lab-embed-preview {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  box-shadow: 0 6px 18px rgb(15 23 42 / 0.06); /* 主题色白名单: 独立预览页柔和投影（与主题无关的层次阴影） */
}

.lab-embed-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.lab-embed-preview-head h2 {
  margin: 2px 0 0;
  color: var(--ui-ink, #18202b);
  font-size: var(--ui-text-title, 15px);
  letter-spacing: -0.02em;
}

.lab-embed-preview-head .lab-eyebrow {
  margin: 0;
}

.lab-embed-stage {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(140px, 0.65fr);
  gap: 14px;
  padding: 18px;
  overflow: hidden;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-open, 12px);
  background:
    radial-gradient(circle at 15% 15%, color-mix(in srgb, var(--ui-accent, #0891b2) 10%, transparent), transparent 55%),
    var(--ui-canvas-bg, #f5f6f8);
}

.lab-embed-stage.is-dark {
  --canvas-node-surface: #262626;
  --canvas-node-panel-surface: #2e2e2e;
  --canvas-node-border: #3a3a3a;
  --canvas-node-border-subtle: #3a3a3a;
  --canvas-node-text-body: #d4d4d4;
  --canvas-node-text-strong: #f2f2f2;
  --canvas-node-text-muted: #9c9c9c;
  background:
    radial-gradient(circle at 15% 15%, color-mix(in srgb, var(--ui-accent, #22d3ee) 14%, transparent), transparent 55%),
    #141414; /* 主题色白名单: 独立预览页暗色舞台底色 */
}

.lab-embed-node {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--canvas-node-border, #e5e7eb);
  border-radius: 12px;
  background: var(--canvas-node-panel-surface, #fff);
  box-shadow: 0 10px 26px rgb(15 23 42 / 0.10); /* 主题色白名单: 独立预览页柔和投影 */
}

.lab-embed-node-head {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--canvas-node-text-strong, #111827);
  font-size: 12px;
  font-weight: 700;
}

.lab-embed-node-dot {
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent, #0891b2) 16%, transparent);
}

.lab-embed-node-size {
  margin-left: auto;
  color: var(--canvas-node-text-faint, #9ca3af);
  font-size: 9px;
  font-weight: 600;
}

.lab-embed-node-body {
  margin: 0;
  color: var(--canvas-node-text-body, #374151);
  font-size: 11px;
  line-height: 1.65;
}

.lab-embed-node-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}

.lab-embed-port {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  border: 1.5px solid color-mix(in srgb, var(--ui-accent, #0891b2) 55%, transparent);
  border-radius: 99px;
  background: var(--canvas-node-panel-surface, #fff);
  transform: translateY(-50%);
}

.lab-embed-port--left { left: -5px; }
.lab-embed-port--right { right: -5px; }

.lab-embed-states {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.lab-embed-state {
  position: relative;
  flex: 1;
  min-height: 84px;
  overflow: hidden;
  border: 1px solid var(--canvas-node-border-subtle, #e5e7eb);
  border-radius: 10px;
  background: var(--canvas-node-surface, #f9fafb);
}

.lab-embed-flow {
  position: absolute;
  top: 50%;
  left: 47%;
  width: 7%;
  height: 2px;
  pointer-events: none;
}

.lab-embed-flow-rail {
  position: absolute;
  inset: 0;
  border-radius: 99px;
  background: var(--ui-edge-rail, #1f2937);
  opacity: 0.5;
}

.lab-embed-flow-dot {
  position: absolute;
  top: -2px;
  left: 0;
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--ui-edge-flow, var(--ui-accent, #0891b2));
  box-shadow: 0 0 8px var(--ui-edge-flow, var(--ui-accent, #0891b2));
  animation: lab-embed-flow 2.8s linear infinite;
}

@keyframes lab-embed-flow {
  from { transform: translateX(0); }
  to { transform: translateX(44px); }
}

.lab-embed-note {
  margin: 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
  line-height: 1.5;
}

.lab-embed-groups {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 12px;
}

.lab-embed-empty {
  padding: 18px;
  border: 1px dashed var(--ui-line, #e2e5ea);
  border-radius: var(--radius-row, 10px);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  text-align: center;
}

.lab-embed-group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 7px;
}

.lab-embed-group-head h3 {
  margin: 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.lab-embed-group-head span {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
}

.lab-embed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
  gap: 7px;
}

.lab-embed-chip {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  grid-template-rows: auto auto;
  align-items: center;
  gap: 2px 8px;
  min-height: 60px;
  padding: 8px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-row, 10px);
  background: var(--ui-panel, #fff);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-hover, 0.18s) ease, box-shadow var(--dur-hover, 0.18s) ease;
}

.lab-embed-chip:hover {
  border-color: color-mix(in srgb, var(--chip) 55%, var(--ui-line, #e2e5ea));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--chip) 14%, transparent);
}

.lab-embed-chip.active {
  border-color: var(--chip);
  box-shadow: 0 0 0 1px var(--chip);
}

.lab-embed-chip.unbound {
  opacity: 0.78;
}

.lab-embed-chip-swatch {
  grid-row: 1 / span 2;
  width: 24px;
  height: 32px;
  border-radius: 6px;
  background: var(--chip);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.10); /* 主题色白名单: 独立预览页色块内发丝边 */
}

.lab-embed-chip-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.lab-embed-chip-copy strong {
  overflow: hidden;
  color: var(--ui-ink, #18202b);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lab-embed-chip-copy small {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font: 600 9px/1.25 ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lab-embed-chip-plugin {
  justify-self: end;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 8px;
  white-space: nowrap;
}

.lab-embed-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--ui-accent, #0891b2) 25%, var(--ui-line, #e2e5ea));
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgb(0 0 0 / 0.04));
}

.lab-embed-editor-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.lab-embed-editor-swatch {
  flex: none;
  width: 30px;
  height: 32px;
  border-radius: 7px;
  background: var(--chip);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.10); /* 主题色白名单: 独立预览页色块内发丝边 */
}

.lab-embed-editor-title {
  min-width: 0;
}

.lab-embed-editor-title h3 {
  margin: 0;
  color: var(--ui-ink, #18202b);
  font-size: 13px;
}

.lab-embed-editor-title p {
  margin: 2px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
  line-height: 1.45;
}

.lab-embed-editor-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.lab-embed-key {
  color: var(--ui-ink-mute, #8c95a3);
  font: 600 10px/1.2 ui-monospace, monospace;
}

.lab-embed-plugin {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  color: var(--ui-accent, #0e7490);
  font-size: 9px;
  font-weight: 650;
}

.lab-embed-editor-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
}

.lab-embed-editor-chain {
  margin: 2px 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
  color: var(--ui-ink-dim, #6b7280);
  font: 600 9px/1.5 ui-monospace, monospace;
  overflow-wrap: anywhere;
}

@media (max-width: 620px) {
  .lab-embed-stage {
    grid-template-columns: 1fr;
  }
  .lab-embed-states {
    flex-direction: row;
  }
  .lab-embed-state {
    min-height: 78px;
  }
  .lab-embed-flow {
    display: none;
  }
  .lab-embed-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}

.lab-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 30px 12px;
}

.lab-eyebrow {
  margin: 0 0 6px;
  color: var(--ui-ink-mute, #8a9691);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.lab-head h1 {
  margin: 0;
  font-size: 27px;
  letter-spacing: -0.045em;
  line-height: 1.12;
}

.lab-lede {
  max-width: 620px;
  margin: 10px 0 0;
  color: var(--ui-ink-dim, #6f7c77);
  font-size: 12px;
  line-height: 1.6;
}

.lab-inline-strong {
  color: var(--ui-accent, #0891b2);
  font-weight: 700;
}

.lab-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.lab-mode {
  display: flex;
  padding: 3px;
  border: 1px solid var(--ui-line, #dfe6e2);
  border-radius: 9px;
  background: var(--ui-panel-soft, #f4f7f5);
}

.lab-mode button {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #7d8984);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.lab-mode button.active {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #17211f);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.1); /* 主题色白名单: 独立预览页开关阴影 */
}

.lab-btn {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--ui-line, #dfe6e2);
  border-radius: 8px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-dim, #3c4944);
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.lab-btn:hover {
  background: var(--ui-hover, #f4f7f5);
}

.lab-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 0 30px 12px;
}

.lab-themes {
  display: flex;
  gap: 7px;
  overflow-x: auto;
  scrollbar-width: none;
}

.lab-themes::-webkit-scrollbar {
  display: none;
}

.lab-theme {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  border: 1px solid var(--ui-line, #e1e8e4);
  border-radius: 10px;
  background: var(--ui-panel, #fff);
}

.lab-theme.active {
  border-color: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 1px var(--ui-accent, #0891b2);
}

.lab-theme-main {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 11px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.lab-theme-dots {
  display: flex;
  gap: 2px;
}

.lab-theme-dots i {
  width: 8px;
  height: 8px;
  border-radius: 99px;
}

.lab-theme-name {
  font-size: 11px;
  font-weight: 700;
}

.lab-theme-meta {
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9px;
}

.lab-theme-del {
  width: 22px;
  height: 22px;
  margin-right: 5px;
  border: 0;
  border-radius: 99px;
  background: transparent;
  color: var(--ui-ink-mute, #98a39e);
  cursor: pointer;
}

.lab-theme-del:hover {
  background: var(--ui-danger-soft, #fbeaea);
  color: var(--ui-danger, #c94848);
}

.lab-plugins {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.lab-plugins-label {
  margin-right: 3px;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.lab-plugin {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--ui-line, #e1e8e4);
  border-radius: 99px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-mute, #8a9691);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.lab-plugin.on {
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 35%, transparent);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 9%, transparent);
  color: var(--ui-accent, #0d7a6f);
}

.lab-plugin.locked {
  cursor: default;
}

.lab-plugin-dot {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--ui-line-strong, #d0d8d4);
}

.lab-plugin.on .lab-plugin-dot {
  background: var(--ui-accent, #0e8f84);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent, #0e8f84) 14%, transparent);
}

.lab-scenes {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 0 30px;
}

.lab-scene {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--ui-line, #e1e8e4);
  border-radius: 8px;
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-dim, #5d6963);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.lab-scene.active {
  border-color: var(--ui-accent, #0891b2);
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 10%, var(--ui-panel, #fff));
  color: var(--ui-accent, #0e7490);
  font-weight: 700;
}

.lab-scene.blocked {
  opacity: 0.5;
}

.lab-scene-plugin {
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9px;
}

.lab-scene-hint {
  margin: 8px 30px 12px;
  color: var(--ui-ink-mute, #8a9691);
  font-size: 11px;
  line-height: 1.5;
}

.lab-board {
  position: relative;
  display: grid;
  grid-template-columns: 186px minmax(0, 1fr) 186px;
  gap: 16px;
  padding: 0 30px 22px;
  align-items: start;
}

.lab-rail {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.lab-rail-title {
  margin: 6px 2px 0;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lab-rail-title:first-child {
  margin-top: 0;
}

.lab-rail-empty {
  margin: 2px;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 10px;
  line-height: 1.5;
}

.lab-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 46px;
  padding: 6px 7px;
  border: 1px solid var(--ui-line, #e3e9e5);
  border-radius: 10px;
  background: var(--ui-panel, #fff);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.lab-chip:hover,
.lab-chip.hot {
  border-color: var(--chip);
  transform: translateY(-1px);
  box-shadow: 0 5px 16px color-mix(in srgb, var(--chip) 16%, transparent);
}

.lab-chip.active {
  border-color: var(--chip);
  box-shadow: 0 0 0 1px var(--chip);
}

.lab-chip.unbound {
  opacity: 0.72;
}

.lab-chip-swatch {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 31px;
  border-radius: 7px;
  background: var(--chip);
  color: var(--chip-ink);
  font-size: 10px;
  font-weight: 800;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); /* 主题色白名单: 独立预览页色块内发丝边 */
}

.lab-chip-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.lab-chip-copy strong {
  overflow: hidden;
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lab-chip-copy small {
  overflow: hidden;
  color: var(--ui-ink-mute, #98a39e);
  font: 600 8.5px/1.25 ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lab-chip-badge {
  flex: none;
  color: var(--ui-ink-mute, #c0c8c4);
  font-size: 8px;
}

.lab-chip-badge.live {
  color: var(--chip);
}

.lab-stage-wrap {
  min-width: 0;
}

.lab-stage {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--ui-line, #dfe7e2);
  border-radius: 16px;
  background: var(--ui-canvas-bg, #f5f6f8);
  box-shadow: 0 16px 44px rgb(17 31 26 / 0.08); /* 主题色白名单: 独立预览页舞台投影 */
}

.lab-stage :deep(.vue-flow) {
  background: transparent !important;
}

.lab-stage :deep(.canvas-provider-root),
.lab-stage :deep(.canvas-provider-root > *) {
  height: 100%;
}

.lab-stage :deep(.theme-lab-swatch) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
}

.lab-stage :deep(.theme-lab-swatch-sheet) {
  width: 80%;
  height: 110px;
  border-radius: 9px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ui-accent) 92%, #fff), color-mix(in srgb, var(--ui-edge-flow) 66%, #17211f)); /* 主题色白名单: 独立预览页渐变兜底色（主色仍来自主题变量） */
  box-shadow: 0 10px 22px color-mix(in srgb, var(--ui-accent) 18%, transparent);
}

.lab-stage :deep(.theme-lab-swatch-copy) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--canvas-node-text-strong, #111827);
}

.lab-stage :deep(.theme-lab-swatch-copy small) {
  color: var(--canvas-node-text-muted, #98a39e);
  font-size: 8px;
}

.lab-stage :deep(.theme-lab-text) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  color: var(--canvas-node-text-body, #374151);
  font-size: 11px;
  line-height: 1.7;
}

.lab-stage :deep(.theme-lab-text p) {
  margin: 0;
}

.lab-stage :deep(.theme-lab-warning) {
  align-self: flex-start;
  padding: 3px 7px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ui-warn) 14%, transparent);
  color: var(--ui-warn);
  font-size: 9px;
}

.lab-stage-top {
  position: absolute;
  top: 12px;
  left: 14px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 7px;
  pointer-events: none;
}

.lab-live,
.lab-scene-pill,
.lab-scene-missing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--ui-line, rgb(0 0 0 / 0.07));
  border-radius: 7px;
  background: color-mix(in srgb, var(--ui-panel, #fff) 88%, transparent);
  color: var(--ui-ink-mute, #72817b);
  font-size: 9px;
  font-weight: 650;
  backdrop-filter: blur(7px);
}

.lab-live i {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--ui-ink-mute, #c5ccc8);
}

.lab-live.ready i {
  background: var(--ui-accent, #0e8f84);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent, #0e8f84) 16%, transparent);
}

.lab-scene-pill {
  color: var(--ui-accent, #0e7490);
}

.lab-scene-missing {
  border-color: color-mix(in srgb, var(--ui-warn) 35%, transparent);
  color: var(--ui-warn);
}

.lab-stage-foot {
  margin: 9px 2px 0;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9.5px;
}

.lab-lines {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.lab-line path {
  fill: none;
  stroke: var(--line-color);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
  opacity: 0.92;
  transition: opacity 0.16s;
}

.lab-line circle {
  fill: var(--line-color);
}

.lab-line .lab-line-end {
  fill: var(--ui-panel, #fff);
  stroke: var(--line-color);
  stroke-width: 1.6;
}

.lab-line .lab-line-dot {
  fill: var(--line-color);
}

.lab-line.hot path {
  stroke-width: 2;
  opacity: 1;
}

.lab-line.dim {
  opacity: 0.25;
}

.lab-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 22px;
  margin: 0 30px 22px;
  padding: 16px;
  border: 1px solid var(--ui-line, #dfe7e2);
  border-radius: 14px;
  background: var(--ui-panel, #fff);
  box-shadow: 0 10px 28px rgb(17 31 26 / 0.07); /* 主题色白名单: 独立预览页柔和投影 */
}

.lab-editor-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.lab-editor-swatch {
  width: 34px;
  height: 36px;
  flex: none;
  border-radius: 8px;
  background: var(--chip);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); /* 主题色白名单: 独立预览页色块内发丝边 */
}

.lab-editor-head h2 {
  margin: 0;
  font-size: 14px;
}

.lab-editor-head p {
  margin: 4px 0 0;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 10px;
  line-height: 1.45;
}

.lab-icon-btn {
  width: 26px;
  height: 26px;
  margin-left: auto;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 16px;
  cursor: pointer;
}

.lab-icon-btn:hover {
  background: var(--ui-hover, #f4f7f5);
  color: var(--ui-ink, #17211f);
}

.lab-editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 8px;
}

.lab-editor-key {
  color: var(--ui-ink-mute, #98a39e);
  font: 600 10px/1.2 ui-monospace, monospace;
}

.lab-editor-plugin {
  padding: 2px 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 10%, transparent);
  color: var(--ui-accent, #0e7490);
  font-size: 9px;
  font-weight: 650;
}

.lab-editor-body {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.lab-link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-accent, #0e8f84);
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.lab-editor-note {
  margin: 9px 0 0;
  color: var(--ui-ink-dim, #63716b);
  font-size: 10px;
  line-height: 1.5;
}

.lab-chain {
  padding-left: 18px;
  border-left: 1px solid var(--ui-line, #eef2ef);
}

.lab-chain-title {
  margin: 0 0 8px;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lab-chain ol {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.lab-chain li {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-ink-dim, #44514b);
  font: 600 10px/1.3 ui-monospace, monospace;
}

.lab-chain li span {
  display: grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 99px;
  background: var(--ui-panel-soft, #f4f7f5);
  color: var(--ui-ink-mute, #98a39e);
  font-size: 8px;
}

.lab-chain-foot {
  margin: 12px 0 0;
  color: var(--ui-ink-mute, #98a39e);
  font-size: 9.5px;
  line-height: 1.55;
}

.lab-chain-foot code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--ui-panel-soft, #f4f7f5);
  font-family: ui-monospace, monospace;
}

.lab-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  z-index: 50;
  padding: 9px 14px;
  border-radius: 8px;
  background: var(--ui-ink, #17211f);
  color: var(--ui-panel, #fff);
  font-size: 11px;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 8px);
  transition: opacity 0.18s, transform 0.18s;
}

.lab-toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

.lab-boot-error {
  padding: 24px;
  color: var(--ui-danger, #c94848);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .lab-board {
    grid-template-columns: 168px minmax(0, 1fr);
  }
  .lab-rail--right {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .lab-rail--right .lab-rail-title {
    grid-column: 1 / -1;
  }
  .lab-editor {
    grid-template-columns: 1fr;
  }
  .lab-chain {
    padding-top: 14px;
    padding-left: 0;
    border-top: 1px solid var(--ui-line, #eef2ef);
    border-left: 0;
  }
}

@media (max-width: 700px) {
  .lab-head {
    flex-direction: column;
  }
  .lab-head-actions {
    justify-content: flex-start;
  }
  .lab-board {
    display: flex;
    flex-direction: column;
  }
  .lab-rail--left,
  .lab-rail--right {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .lab-rail-title {
    grid-column: 1 / -1;
  }
  .lab-lines {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
</style>

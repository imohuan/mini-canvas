<script setup lang="ts">
/**
 * ThemeStudio —— 设置页「外观 → 主题工作台」正文。
 *
 * 结构照参考图：主题模板 → 颜色配方 → 右侧完整画布卡片。
 * - 色签由各插件已声明的 `type: 'color'` 字段生成，插件没装就不出现；
 * - 每格直接读写真实 settings，亮/暗各一份值；
 * - 预览只用默认主题的真实组件，并在卡片里画一条“从色签到画布元素”的短指示线，
 *   指示线不跨卡片边界，也不冒充真实 SVG DOM。
 */
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { ColorField, NodeEmptyState } from '@mini-canvas/plugin-theme-default'
import { Button } from '@mini-canvas/ui-kit-shadcn'
import {
  BookmarkPlus,
  Check,
  Copy,
  Frame,
  Hand,
  Link2,
  Moon,
  Palette,
  PenTool,
  Plus,
  RotateCcw,
  ScanLine,
  Scissors,
  Sparkles,
  SquareDashed,
  Sun,
  Trash2,
  TriangleAlert,
  Waypoints,
  Zap,
} from 'lucide-vue-next'
import {
  GROUP_ORDER,
  PLUGIN_LABELS,
  buildColorEntries,
  type DeclaredColorField,
  type ThemeLabColorEntry,
  type ThemeLabGroup,
  type ThemeLabMode,
} from './catalog'
import { LAB_THEMES, cloneThemes, readLabState, writeLabState, type LabTheme } from './storage'
import type { LabSettingsStore } from './types'

const props = defineProps<{ settingsSource: SettingsPanelSource }>()

const source = props.settingsSource as SettingsPanelSource & Partial<LabSettingsStore>
const MODES: ThemeLabMode[] = ['light', 'dark']
const stored = readLabState()
const themes = ref<LabTheme[]>(cloneThemes(stored.themes.length ? stored.themes : LAB_THEMES))
const activeId = ref(stored.themes.some((theme) => theme.id === stored.themeId) ? stored.themeId : themes.value[0]?.id ?? 'mist')
const mode = ref<ThemeLabMode>(initialMode())
const fields = ref<DeclaredColorField[]>([])
const tick = ref(0)
const toast = ref('')

let toastTimer = 0
let saveTimer = 0
const disposers: Array<{ dispose(): void }> = []

function groupItems(group: string): Array<{ key: string; schema: DeclaredColorField['schema']; value: string | number | boolean }> {
  return source.groupOf(group)
}

function rawGet(key: string): unknown {
  void tick.value
  if (typeof source.get === 'function') return source.get(key)
  for (const group of source.groups()) {
    const item = groupItems(group).find((entry) => entry.key === key)
    if (item) return item.value
  }
  return undefined
}

function readFields(): DeclaredColorField[] {
  void tick.value
  const out: DeclaredColorField[] = []
  for (const group of source.groups()) {
    if (!group.startsWith('外观/')) continue
    for (const item of groupItems(group)) {
      if (item.schema.type !== 'color') continue
      out.push({ group, key: item.key, schema: item.schema, value: item.value })
    }
  }
  return out
}

// 首屏就按真实 settings 渲染颜色；onMounted 再补一次，保证挂在设置页时拿到的
// 是外壳已经装配完成后的字段。SSR / 独立预览也因此不会先闪一屏“没有颜色”。
fields.value = readFields()

/** 字段存在 = 声明它的插件已装；不再拿插件名单二次过滤。 */
const entries = computed(() => buildColorEntries(fields.value, new Set(Object.keys(PLUGIN_LABELS))))
const activeTheme = computed(() => themes.value.find((theme) => theme.id === activeId.value) ?? themes.value[0])
const groups = computed(() =>
  GROUP_ORDER.map((group) => ({ group, items: entries.value.filter((entry) => entry.group === group) })).filter(
    (group) => group.items.length > 0,
  ),
)

const GROUP_ICONS: Record<ThemeLabGroup, Component> = {
  品牌: Sparkles,
  连线: Waypoints,
  选择: SquareDashed,
  切割: Scissors,
  其它: Palette,
}

const GROUP_HINTS: Record<ThemeLabGroup, string> = {
  品牌: '按钮与状态',
  连线: '连线与流光',
  选择: '框选与参考线',
  切割: '轨迹与刀锋',
  其它: '扩展颜色',
}

function entryOf(base: string): ThemeLabColorEntry | undefined {
  return entries.value.find((entry) => entry.id === base)
}

function isHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
}

function keyOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode): string {
  return forMode === 'light' ? entry.keys.light : entry.keys.dark
}

function rawValueOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
  const value = rawGet(keyOf(entry, forMode))
  return typeof value === 'string' ? value.trim() : ''
}

/** 当前 settings 里的真实颜色；可清空的格子解析成“跟随主题”后的可见色。 */
function colorForBase(base: string, forMode: ThemeLabMode = mode.value, seen = new Set<string>()): string {
  const entry = entryOf(base)
  if (!entry || seen.has(base)) return ''
  seen.add(base)
  const direct = rawValueOf(entry, forMode)
  if (direct) return direct
  if (entry.followKey) {
    const followed = colorForBase(entry.followKey, forMode, seen)
    if (followed) return followed
  }
  return forMode === 'light' ? entry.defaults.light : entry.defaults.dark
}

function valueOf(entry: ThemeLabColorEntry, forMode: ThemeLabMode = mode.value): string {
  return colorForBase(entry.id, forMode)
}

/** 主题卡片里的颜色：优先看这套模板自己的覆盖值，没有就取该字段默认值。 */
function colorFromTheme(theme: LabTheme, base: string, forMode: ThemeLabMode, seen = new Set<string>()): string {
  const entry = entryOf(base)
  if (!entry || seen.has(base)) return ''
  seen.add(base)
  const key = keyOf(entry, forMode)
  if (theme.overrides[key]) return theme.overrides[key]
  const fallback = forMode === 'light' ? entry.defaults.light : entry.defaults.dark
  if (fallback) return fallback
  if (entry.followKey) return colorFromTheme(theme, entry.followKey, forMode, seen)
  return ''
}

/** 模板缩略图只表现配色气质：真正可交互的是右侧预览卡。 */
function themeVisualStyle(theme: LabTheme): Record<string, string> {
  const accent = colorFromTheme(theme, 'accentColor', 'light') || 'currentColor'
  return {
    '--tpl-accent': accent,
    '--tpl-accent-ink': inkFor(accent),
    '--tpl-danger': colorFromTheme(theme, 'dangerColor', 'light') || 'currentColor',
    '--tpl-warn': colorFromTheme(theme, 'warnColor', 'light') || 'currentColor',
    '--tpl-flow': colorFromTheme(theme, 'edgeFlowColor', 'light') || accent,
  }
}

function inkFor(hex: string): string {
  const raw = String(hex || '').replace('#', '').trim()
  const expanded = raw.length === 3 || raw.length === 4 ? raw.slice(0, 3).split('').map((ch) => ch + ch).join('') : raw.slice(0, 6)
  if (expanded.length !== 6) return 'white'
  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  if (![r, g, b].every(Number.isFinite)) return 'white'
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62 ? 'black' : 'white'
}

function initialMode(): ThemeLabMode {
  const raw = source.get?.('themeMode')
  if (raw === 'light' || raw === 'dark') return raw
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'dark'
  return 'light'
}

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const ok = writeLabState({ version: 1, themeId: activeId.value, mode: mode.value, themes: themes.value })
    if (!ok) showToast('浏览器不允许保存模板，刷新会丢')
  }, 220)
}

function showToast(message: string): void {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2400)
}

function uniqueName(base: string): string {
  let name = base
  let index = 2
  while (themes.value.some((theme) => theme.name === name)) name = base + ' ' + index++
  return name
}

function applyTheme(theme: LabTheme): void {
  for (const entry of entries.value) {
    for (const forMode of MODES) {
      const key = keyOf(entry, forMode)
      const value = theme.overrides[key] ?? (forMode === 'light' ? entry.defaults.light : entry.defaults.dark)
      try {
        source.set(key, value)
      } catch {
        /* 插件刚卸掉：对应字段已经不存在 */
      }
    }
  }
  fields.value = readFields()
  tick.value += 1
}

function selectTheme(theme: LabTheme): void {
  activeId.value = theme.id
  applyTheme(theme)
  persist()
  showToast('已换成「' + theme.name + '」')
}

function duplicateTheme(): void {
  const from = activeTheme.value
  if (!from) return
  const name = uniqueName(from.name + ' 副本')
  const theme: LabTheme = { id: 'lab-' + Date.now().toString(36), name, overrides: { ...from.overrides } }
  themes.value.push(theme)
  activeId.value = theme.id
  applyTheme(theme)
  persist()
  showToast('已新建「' + name + '」')
}

function resetTheme(): void {
  const theme = activeTheme.value
  if (!theme) return
  theme.overrides = {}
  applyTheme(theme)
  persist()
  showToast('已恢复主题默认色')
}

function setValue(entry: ThemeLabColorEntry, next: string): void {
  const theme = activeTheme.value
  if (!theme) return
  const value = String(next || '').trim()
  if (value && !isHex(value)) {
    showToast('颜色要写成 #RRGGBB 或 #RRGGBBAA')
    return
  }
  if (!value && !entry.optional) return
  const key = keyOf(entry, mode.value)
  try {
    source.set(key, value)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '这个颜色已经不可用')
    return
  }
  if (value) theme.overrides[key] = value
  else delete theme.overrides[key]
  fields.value = readFields()
  tick.value += 1
  persist()
}

const CSS_VAR_BY_BASE: Record<string, string> = {
  accentColor: '--ui-accent',
  accentHoverColor: '--ui-accent-hover',
  dangerColor: '--ui-danger',
  warnColor: '--ui-warn',
  edgeRailColor: '--ui-edge-rail',
  edgeFlowColor: '--ui-edge-flow',
  alignGuideColor: '--ui-guide',
  multiSelectBoxColor: '--ui-select-box',
  multiSelectFrameOuterColor: '--ui-select-outer',
  multiSelectFrameInnerColor: '--ui-select-inner',
  pathColor: '--edge-cutting-path-color',
  bladeColor: '--edge-cutting-blade-color',
}

function cssBlock(forMode: ThemeLabMode): string {
  return entries.value
    .map((entry) => {
      const name = CSS_VAR_BY_BASE[entry.id]
      if (!name) return ''
      const value = colorForBase(entry.id, forMode)
      return value ? `  ${name}: ${value};` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function copyCss(): void {
  const css = `:root {\n${cssBlock('light')}\n}\n\nhtml.dark {\n${cssBlock('dark')}\n}`
  void navigator.clipboard
    ?.writeText(css)
    .then(() => showToast('CSS 变量已复制'))
    .catch(() => showToast('复制失败，请手动选择'))
}

const previewColors = computed(() => {
  const out: Record<string, string> = {}
  const fallback = (base: string, otherwise: string): string => colorForBase(base) || otherwise
  const accent = fallback('accentColor', 'currentColor')
  out['--ui-accent'] = accent
  out['--ui-accent-hover'] = fallback('accentHoverColor', accent)
  out['--ui-on-accent'] = inkFor(accent)
  out['--ui-danger'] = fallback('dangerColor', 'currentColor')
  out['--ui-warn'] = fallback('warnColor', 'currentColor')
  out['--ui-edge-rail'] = fallback('edgeRailColor', 'currentColor')
  out['--ui-edge-flow'] = fallback('edgeFlowColor', accent)
  out['--ui-select-box'] = fallback('multiSelectBoxColor', accent)
  out['--ui-select-outer'] = fallback('multiSelectFrameOuterColor', accent)
  out['--ui-select-inner'] = fallback('multiSelectFrameInnerColor', accent)
  out['--pv-guide'] = fallback('alignGuideColor', accent)
  out['--pv-cut'] = fallback('pathColor', accent)
  out['--pv-blade'] = fallback('bladeColor', accent)
  return out
})

const previewSwatches = computed(() =>
  ['accentColor', 'warnColor', 'dangerColor', 'edgeRailColor', 'edgeFlowColor', 'pathColor', 'bladeColor']
    .map((base) => (entryOf(base) ? colorForBase(base) : ''))
    .filter(Boolean),
)

const hasSelection = computed(() => Boolean(entryOf('multiSelectFrameOuterColor') || entryOf('multiSelectFrameInnerColor')))
const hasGuide = computed(() => Boolean(entryOf('alignGuideColor')))
const hasCut = computed(() => Boolean(entryOf('pathColor') || entryOf('bladeColor')))
const activeIsPreset = computed(() => LAB_THEMES.some((theme) => theme.id === activeId.value))

onMounted(() => {
  fields.value = readFields()
  const current = rawGet('themeMode')
  if (current === 'light' || current === 'dark') mode.value = current
  disposers.push(
    source.onChange((key, value) => {
      fields.value = readFields()
      tick.value += 1
      if (key === 'themeMode' && (value === 'light' || value === 'dark')) mode.value = value
    }),
  )
  const off = source.onSchemaChange?.(() => {
    fields.value = readFields()
    tick.value += 1
  })
  if (off) disposers.push(off)
})

onBeforeUnmount(() => {
  for (const disposer of disposers) disposer.dispose()
  clearTimeout(toastTimer)
  clearTimeout(saveTimer)
})

function groupIcon(group: ThemeLabGroup): Component {
  return GROUP_ICONS[group] ?? Palette
}

function groupHint(group: ThemeLabGroup): string {
  return GROUP_HINTS[group] ?? ''
}

/** 每个色签中心的小图标：让“这个颜色用在哪”一眼能认出来。 */
function tokenIcon(entry: ThemeLabColorEntry): Component {
  if (entry.id === 'accentColor' || entry.id === 'accentHoverColor') return Zap
  if (entry.id === 'dangerColor') return Trash2
  if (entry.id === 'warnColor') return TriangleAlert
  if (entry.id === 'edgeRailColor') return Link2
  if (entry.id === 'edgeFlowColor') return Sparkles
  if (entry.id === 'alignGuideColor') return ScanLine
  if (entry.id === 'multiSelectBoxColor') return Frame
  if (entry.id.startsWith('multiSelectFrame')) return SquareDashed
  if (entry.id === 'pathColor') return PenTool
  if (entry.id === 'bladeColor') return Scissors
  return Palette
}

function tokenInk(entry: ThemeLabColorEntry): string {
  return inkFor(valueOf(entry))
}

/** 色签下面只放得下短名；全名仍留在 title / 无障碍名称里。 */
function shortLabel(entry: ThemeLabColorEntry): string {
  if (entry.id === 'accentHoverColor') return '悬停色'
  if (entry.id === 'multiSelectBoxColor') return '绘制框'
  if (entry.id === 'multiSelectFrameOuterColor') return '外框'
  if (entry.id === 'multiSelectFrameInnerColor') return '内框'
  if (entry.id === 'alignGuideColor') return '参考线'
  if (entry.id === 'pathColor') return '切割轨迹'
  if (entry.id === 'bladeColor') return '刀锋'
  return entry.label
}

/** 色签 → 画布元素的真实归属，用来决定卡片里那根短指示线的走向。 */
function previewTarget(entry: ThemeLabColorEntry): 'button' | 'warn' | 'danger' | 'edge' | 'selection' | 'guide' | 'cut' {
  if (entry.group === '连线') return 'edge'
  if (entry.id === 'alignGuideColor') return 'guide'
  if (entry.group === '切割') return 'cut'
  if (entry.group === '选择') return 'selection'
  if (entry.id === 'warnColor') return 'warn'
  if (entry.id === 'dangerColor') return 'danger'
  return 'button'
}

/** 只在配色色签上显示细线；不伪造“从页面跨到画布”的长线。 */
function targetHint(entry: ThemeLabColorEntry): string {
  const target = previewTarget(entry)
  if (target === 'button') return '主按钮'
  if (target === 'warn') return '待确认状态'
  if (target === 'danger') return '失效状态'
  if (target === 'edge') return entry.id === 'edgeFlowColor' ? '流光' : '连线'
  if (target === 'selection') return '选框'
  if (target === 'guide') return '参考线'
  return entry.id === 'bladeColor' ? '刀锋' : '轨迹'
}
</script>

<template>
  <div class="studio-root">
    <header class="studio-intro">
      <div class="studio-intro-copy">
        <p class="studio-eyebrow">外观 · 主题配色</p>
        <h2>颜色配方</h2>
        <p>挑一套模板，再点色签单独调。右侧画布会立刻跟着变。</p>
      </div>
      <span class="studio-saved"><Check aria-hidden="true" />自动保存</span>
    </header>

    <section class="studio-template-section" aria-label="主题模板">
      <div class="studio-section-head">
        <div>
          <h3>主题模板</h3>
          <p>整套亮色与暗色一起换。</p>
        </div>
        <button type="button" class="studio-add" @click="duplicateTheme"><Plus aria-hidden="true" />新建</button>
      </div>
      <div class="studio-template-row" role="list">
        <button
          v-for="theme in themes"
          :key="theme.id"
          type="button"
          class="studio-template"
          :class="{ 'is-active': theme.id === activeId }"
          role="listitem"
          :aria-pressed="theme.id === activeId"
          @click="selectTheme(theme)"
        >
          <span class="studio-template-art" :style="themeVisualStyle(theme)" aria-hidden="true">
            <span class="studio-template-half is-light">
              <i class="studio-template-node is-a"></i>
              <i class="studio-template-node is-b"></i>
            </span>
            <span class="studio-template-half is-dark">
              <i class="studio-template-node is-a"></i>
              <i class="studio-template-node is-b"></i>
            </span>
            <span v-if="theme.id === activeId" class="studio-template-check"><Check /></span>
          </span>
          <span class="studio-template-name">{{ theme.name }}</span>
        </button>
        <button type="button" class="studio-template studio-template-new" role="listitem" @click="duplicateTheme">
          <span class="studio-template-plus"><Plus aria-hidden="true" /></span>
          <span class="studio-template-name">新建模板</span>
        </button>
      </div>
    </section>

    <div class="studio-grid">
      <section class="studio-colors" aria-label="全部颜色">
        <div class="studio-section-head">
          <div>
            <h3>全部颜色 <span>{{ entries.length }}</span></h3>
            <p>插件装了就出现，没装就没有这一格。</p>
          </div>
          <div class="studio-head-actions">
            <button type="button" class="studio-reset" title="恢复当前模板的默认色" @click="resetTheme">
              <RotateCcw aria-hidden="true" />还原
            </button>
            <div class="studio-mode" role="group" aria-label="编辑亮色或暗色">
              <button
                v-for="item in MODES"
                :key="item"
                type="button"
                :class="{ 'is-active': mode === item }"
                :aria-pressed="mode === item"
                @click="mode = item; persist()"
              >
                <Sun v-if="item === 'light'" aria-hidden="true" />
                <Moon v-else aria-hidden="true" />
                {{ item === 'light' ? '亮色' : '暗色' }}
              </button>
            </div>
          </div>
        </div>

        <div class="studio-color-card">
          <div v-if="!groups.length" class="studio-empty">
            当前没有可编辑的主题颜色。安装默认主题后，这里会出现颜色。
          </div>
          <section v-for="group in groups" :key="group.group" class="studio-group">
            <div class="studio-group-label">
              <span class="studio-group-icon"><component :is="groupIcon(group.group)" aria-hidden="true" /></span>
              <span><strong>{{ group.group }}</strong><small>{{ groupHint(group.group) }}</small></span>
            </div>
            <div class="studio-token-grid">
              <div v-for="entry in group.items" :key="entry.id" class="studio-token">
                <div
                  class="studio-token-picker"
                  :style="{ '--token-ink': tokenInk(entry) }"
                  :title="entry.label + ' · ' + entry.pluginLabel + ' · ' + targetHint(entry)"
                >
                  <ColorField
                    :model-value="valueOf(entry)"
                    :clearable="entry.optional"
                    :aria-label="'选择' + entry.label"
                    @update:model-value="setValue(entry, $event)"
                  />
                  <span class="studio-token-glyph" aria-hidden="true">
                    <component :is="tokenIcon(entry)" />
                  </span>
                </div>
                <strong>{{ shortLabel(entry) }}</strong>
                <small>{{ targetHint(entry) }}</small>
              </div>
            </div>
          </section>
          <p class="studio-color-foot">
            点色签改色；新增插件只要声明 <code>type: 'color'</code>，这里会自动多出一格。
          </p>
        </div>
      </section>

      <aside class="studio-preview" aria-label="主题实时预览">
        <div class="studio-preview-head">
          <div>
            <span class="studio-live-dot" aria-hidden="true"></span>
            <strong>实时预览</strong>
            <small>跟着调色实时变化</small>
          </div>
          <div class="studio-mode is-compact" role="group" aria-label="预览亮色或暗色">
            <button
              v-for="item in MODES"
              :key="item"
              type="button"
              :title="item === 'light' ? '看亮色样张' : '看暗色样张'"
              :aria-label="item === 'light' ? '亮色样张' : '暗色样张'"
              :class="{ 'is-active': mode === item }"
              :aria-pressed="mode === item"
              @click="mode = item; persist()"
            >
              <Sun v-if="item === 'light'" />
              <Moon v-else />
            </button>
          </div>
        </div>

        <div class="studio-preview-canvas" :class="mode === 'dark' ? 'is-dark' : 'is-light'" :style="previewColors" inert aria-hidden="true">
          <div class="studio-preview-glint" aria-hidden="true"></div>
          <div class="studio-preview-toolbar">
            <Button class="mck-toolbar-btn is-icon-only is-active" variant="ghost" size="sm" type="button" title="移动" aria-label="移动" aria-pressed="true"><Hand /></Button>
            <span class="studio-tool-divider"></span>
            <Button class="mck-toolbar-btn is-icon-only" variant="ghost" size="sm" type="button" title="框选" aria-label="框选"><Frame /></Button>
            <Button v-if="hasSelection" class="mck-toolbar-btn is-icon-only" variant="ghost" size="sm" type="button" title="多选" aria-label="多选"><SquareDashed /></Button>
            <Button v-if="hasCut" class="mck-toolbar-btn is-icon-only" variant="ghost" size="sm" type="button" title="切割" aria-label="切割"><Scissors /></Button>
          </div>

          <svg class="studio-wire" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path class="studio-wire-base" d="M 42 28 C 53 28 49 47 56 47" />
            <path class="studio-wire-flow" d="M 42 28 C 53 28 49 47 56 47" />
            <line v-if="hasGuide" class="studio-guide" x1="84" y1="16" x2="84" y2="45" />
            <path v-if="hasCut" class="studio-cut" d="M 14 80 C 32 74 55 76 82 68" />
            <circle v-if="hasCut" class="studio-blade" cx="82" cy="68" r="1.4" />
            <circle v-if="hasCut" class="studio-blade-glow" cx="82" cy="68" r="2.6" />
          </svg>

          <div class="studio-node studio-node-a">
            <div class="studio-node-title"><i></i><span>灵感速记</span><em>AI</em></div>
            <p>把碎片想法收进来</p>
            <Button class="mck-toolbar-btn mck-toolbar-btn--primary studio-confirm" variant="default" size="sm" type="button" title="确认" aria-label="确认">确认</Button>
            <span class="studio-port is-left"></span>
            <span class="studio-port is-right"></span>
          </div>

          <div class="studio-node studio-node-b">
            <div class="studio-node-title"><span>海边房间</span><em>图片</em></div>
            <span class="studio-thumb"></span>
            <span class="studio-port is-left"></span>
            <span class="studio-port is-right"></span>
          </div>

          <div v-if="hasSelection" class="studio-selection" aria-hidden="true">
            <span class="studio-selection-outer"></span>
            <span class="studio-selection-inner"></span>
          </div>

          <div class="studio-states">
            <span class="studio-state"><NodeEmptyState layout="row" size="sm" tone="warning" text="待确认" /></span>
            <span class="studio-state"><NodeEmptyState layout="row" size="sm" tone="danger" text="素材失效" /></span>
          </div>
        </div>

        <div class="studio-preview-meta">
          <span><i aria-hidden="true"></i>颜色已经应用</span>
          <span>{{ entries.length }} 个颜色</span>
        </div>

        <div class="studio-current">
          <span class="studio-current-icon"><Palette aria-hidden="true" /></span>
          <span class="studio-current-copy">
            <strong>{{ activeTheme?.name || '自定义' }}</strong>
            <small>{{ activeIsPreset ? '内置模板' : '自定义模板' }} · {{ mode === 'light' ? '亮色' : '暗色' }}</small>
          </span>
          <span class="studio-current-dots" aria-hidden="true">
            <i v-for="(color, index) in previewSwatches" :key="index" :style="{ background: color }"></i>
          </span>
        </div>

        <div class="studio-preview-actions">
          <button type="button" @click="duplicateTheme"><BookmarkPlus aria-hidden="true" />另存为模板</button>
          <button type="button" @click="copyCss"><Copy aria-hidden="true" />复制 CSS</button>
        </div>
        <p class="studio-preview-note">亮暗切换只改这张样张，不会改整个应用。</p>
      </aside>
    </div>

    <div class="studio-toast" :class="{ 'is-show': toast }">{{ toast }}</div>
  </div>
</template>

<style scoped>
.studio-root {
  --studio-gap: 18px;
  container-type: inline-size;
  color: var(--ui-ink, #18202b);
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.studio-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 12px;
}

.studio-eyebrow {
  margin: 0 0 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.studio-intro h2 {
  margin: 0;
  color: var(--ui-ink, #18202b);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
}

.studio-intro-copy > p:last-child {
  margin: 3px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  line-height: 1.5;
}

.studio-saved {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  color: var(--ui-accent, #0e7490);
  font-size: 10px;
  font-weight: 700;
}

.studio-saved svg {
  width: 12px;
  height: 12px;
}

.studio-template-section {
  padding: 12px 0 14px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.studio-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.studio-section-head h3 {
  margin: 0;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 700;
}

.studio-section-head h3 span {
  margin-left: 4px;
  color: var(--ui-ink-mute, #8c95a3);
  font-weight: 600;
}

.studio-section-head p {
  margin: 2px 0 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  line-height: 1.4;
}

.studio-add {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel, #fff);
  color: var(--ui-accent, #0e7490);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.studio-add:hover {
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  border-color: var(--ui-accent-line, rgb(8 145 178 / 0.28));
}

.studio-add svg {
  width: 13px;
  height: 13px;
}

.studio-template-row {
  display: flex;
  gap: 8px;
  padding: 1px 1px 3px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.studio-template {
  display: flex;
  flex: 0 0 92px;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-open, 12px);
  background: var(--ui-panel, #fff);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-hover, 0.18s) ease, box-shadow var(--dur-hover, 0.18s) ease, transform var(--dur-hover, 0.18s) ease;
}

.studio-template:hover {
  border-color: var(--ui-accent-line, rgb(8 145 178 / 0.28));
  transform: translateY(-1px);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

.studio-template.is-active {
  border-color: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 1px var(--ui-accent, #0891b2);
}

.studio-template-art {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 44px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--ui-panel-soft, #fff);
}

.studio-template-half {
  position: relative;
  overflow: hidden;
}

.studio-template-half.is-light {
  background: var(--ui-panel, #fff);
}

.studio-template-half.is-dark {
  background: var(--ui-ink, #18202b);
}

.studio-template-node {
  position: absolute;
  display: block;
  border-radius: 3px;
  background: var(--tpl-accent);
}

.studio-template-node.is-a {
  top: 10px;
  left: 7px;
  width: 22px;
  height: 12px;
  opacity: 0.85;
}

.studio-template-node.is-b {
  right: 6px;
  bottom: 8px;
  width: 18px;
  height: 9px;
  background: var(--tpl-flow);
  opacity: 0.8;
}

.studio-template-check {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-on-accent, #fff);
}

.studio-template-check svg {
  width: 9px;
  height: 9px;
  stroke-width: 3;
}

.studio-template-name {
  overflow: hidden;
  padding: 0 1px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-template-new {
  border-style: dashed;
  background: transparent;
}

.studio-template-plus {
  display: grid;
  place-items: center;
  height: 46px;
  border-radius: 7px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-mute, #8c95a3);
}

.studio-template-plus svg {
  width: 16px;
  height: 16px;
}

.studio-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 286px;
  gap: var(--studio-gap);
  align-items: start;
}

.studio-colors {
  min-width: 0;
}

.studio-head-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.studio-reset {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #8c95a3);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.studio-reset:hover {
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
}

.studio-reset svg {
  width: 11px;
  height: 11px;
}

.studio-mode {
  display: flex;
  flex: none;
  padding: 2px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel-soft, #fff);
}

.studio-mode button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-mute, #8c95a3);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.studio-mode button svg {
  width: 11px;
  height: 11px;
}

.studio-mode button.is-active {
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

.studio-mode.is-compact button {
  width: 25px;
  padding: 0;
  justify-content: center;
}

.studio-color-card {
  position: relative;
  padding: 0 12px;
  overflow: visible;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgb(0 0 0 / 0.04));
}

.studio-group {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 12px 0;
}

.studio-group + .studio-group {
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
}

.studio-group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.studio-group-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink-dim, #6b7280);
}

.studio-group-icon svg {
  width: 13px;
  height: 13px;
}

.studio-group-label strong {
  display: block;
  font-size: 11px;
  font-weight: 700;
}

.studio-group-label small {
  display: block;
  margin-top: 1px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
  line-height: 1.2;
}

.studio-token-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 6px;
  min-width: 0;
}

.studio-token {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.studio-token-picker {
  position: relative;
  width: 100%;
  border-radius: var(--radius-row, 10px);
  transition: box-shadow var(--dur-hover, 0.18s) ease;
}

.studio-token-picker:focus-within {
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

.studio-token-picker :deep(.cf-wrap) {
  display: flex;
  width: 100%;
}

.studio-token-picker :deep(.cf-trigger) {
  display: flex;
  align-items: center;
  width: 100%;
  height: 52px;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-row, 10px);
  background: transparent;
  box-shadow: none;
}

.studio-token-picker :deep(.cf-trigger:hover),
.studio-token-picker :deep(.cf-trigger.is-open),
.studio-token-picker :deep(.cf-trigger:focus-visible) {
  border: 0;
  background: transparent;
  box-shadow: none;
  outline: none;
}

.studio-token-picker :deep(.cf-swatch) {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: var(--radius-row, 10px);
  box-shadow: inset 0 0 0 1px var(--ui-line, #e2e5ea);
}

.studio-token-picker :deep(.cf-swatch-color) {
  border-radius: calc(var(--radius-row, 10px) - 1px);
}

.studio-token-picker :deep(.cf-value),
.studio-token-picker :deep(.cf-alpha),
.studio-token-picker :deep(.cf-clear-btn) {
  display: none;
}

.studio-token-glyph {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  color: var(--token-ink, #fff);
  opacity: 0.92;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.studio-token-glyph svg {
  width: 16px;
  height: 16px;
  stroke-width: 2.1;
}

.studio-token > strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-token > small {
  overflow: hidden;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-color-foot {
  margin: 0 -12px;
  padding: 8px 12px;
  border-top: 1px solid var(--ui-line-soft, #eef0f4);
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
  line-height: 1.5;
}

.studio-color-foot code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--ui-code-bg, rgb(0 0 0 / 0.05));
  font-family: ui-monospace, monospace;
}

.studio-empty {
  padding: 22px 8px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 11px;
  text-align: center;
}

.studio-preview {
  position: sticky;
  top: 0;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-panel, 16px);
  background: var(--ui-panel, #fff);
  box-shadow: var(--ui-shadow-e1, 0 2px 10px rgb(0 0 0 / 0.04));
}

.studio-preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.studio-preview-head > div:first-child {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 1px 5px;
}

.studio-preview-head strong {
  font-size: 12px;
  font-weight: 700;
}

.studio-preview-head small {
  grid-column: 2;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 10px;
}

.studio-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
  box-shadow: 0 0 0 3px var(--ui-accent-soft, rgb(8 145 178 / 0.12));
}

.studio-preview-canvas {
  position: relative;
  height: 296px;
  overflow: hidden;
  border: 1px solid var(--pv-line);
  border-radius: var(--radius-open, 12px);
  background-color: var(--pv-canvas);
  background-image: radial-gradient(var(--pv-dot) 0.7px, transparent 0.7px);
  background-size: 12px 12px;
  color: var(--pv-text);
}

.studio-preview-canvas.is-light {
  --pv-canvas: var(--ui-canvas-bg, #f5f6f8);
  --pv-surface: var(--ui-panel, #fff);
  --pv-surface-soft: var(--ui-panel-soft, #fff);
  --pv-line: var(--ui-line, #e2e5ea);
  --pv-dot: var(--ui-line, #e2e5ea);
  --pv-text: var(--ui-ink, #18202b);
  --pv-text-dim: var(--ui-ink-dim, #6b7280);
  --pv-text-mute: var(--ui-ink-mute, #8c95a3);
}

.studio-preview-canvas.is-dark {
  --pv-canvas: #171717;
  --pv-surface: #252525;
  --pv-surface-soft: #1e1e1e;
  --pv-line: #3a3a3a;
  --pv-dot: #2c2c2c;
  --pv-text: #f2f2f2;
  --pv-text-dim: #c4c4c4;
  --pv-text-mute: #9a9a9a;
  --canvas-node-surface: #252525;
  --canvas-node-panel-surface: #2c2c2c;
  --canvas-node-border: #3a3a3a;
  --canvas-node-border-subtle: #3a3a3a;
  --canvas-node-text-body: #d4d4d4;
  --canvas-node-text-strong: #f2f2f2;
  --canvas-node-text-muted: #9c9c9c;
  --canvas-node-text-faint: #7a7a7a;
}

.studio-preview-toolbar {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--pv-line);
  border-radius: var(--radius-control, 8px);
  background: var(--pv-surface);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

/* 画布卡片的一层极淡光晕：让预览看起来像一块正在被讲述的画布，而不是白底表格。 */
.studio-preview-glint {
  position: absolute;
  top: -40%;
  right: -20%;
  width: 80%;
  height: 90%;
  background: radial-gradient(circle, color-mix(in srgb, var(--ui-accent) 15%, transparent) 0%, transparent 68%);
  pointer-events: none;
}

.studio-tool-divider {
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--pv-line);
}

.studio-preview-toolbar :deep(.mck-toolbar-btn) {
  width: 24px;
  min-width: 24px;
  height: 24px;
  border-radius: 5px;
  color: var(--pv-text-dim);
}

.studio-preview-toolbar :deep(.mck-toolbar-btn svg) {
  width: 12px;
  height: 12px;
}

.studio-wire {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.studio-wire-base,
.studio-wire-flow {
  fill: none;
  vector-effect: non-scaling-stroke;
}

.studio-wire-base {
  stroke: var(--ui-edge-rail);
  stroke-width: 1.4;
  opacity: 0.75;
}

.studio-wire-flow {
  stroke: var(--ui-edge-flow);
  stroke-width: 1.8;
  stroke-dasharray: 2 6;
  opacity: 0.95;
}

.studio-guide {
  stroke: var(--pv-guide);
  stroke-width: 1;
  stroke-dasharray: 2 2;
  opacity: 0.8;
  vector-effect: non-scaling-stroke;
}

.studio-cut {
  fill: none;
  stroke: var(--pv-cut);
  stroke-width: 1.6;
  stroke-linecap: round;
  opacity: 0.95;
  vector-effect: non-scaling-stroke;
}

.studio-blade {
  fill: var(--pv-blade);
}

.studio-blade-glow {
  fill: var(--pv-blade);
  opacity: 0.26;
}

.studio-node {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 8px;
  border: 1px solid var(--pv-line);
  border-radius: 6px;
  background: var(--pv-surface);
  box-shadow: var(--ui-shadow-sm, 0 1px 4px rgb(15 23 42 / 0.12));
}

.studio-node-a {
  top: 8%;
  left: 7%;
  width: 35%;
  height: 31%;
}

.studio-node-b {
  top: 35%;
  right: 8%;
  width: 33%;
  height: 31%;
}

.studio-node-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--pv-text);
  font-size: 10px;
  font-weight: 700;
}

.studio-node-title i {
  width: 4px;
  height: 4px;
  border-radius: 99px;
  background: var(--ui-accent);
}

.studio-node-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-node-title em {
  margin-left: auto;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--ui-accent-soft);
  color: var(--ui-accent);
  font-size: 8px;
  font-style: normal;
}

.studio-node-a p {
  margin: 0;
  color: var(--pv-text-dim);
  font-size: 9px;
  line-height: 1.35;
}

.studio-node-a :deep(.studio-confirm) {
  align-self: flex-start;
  height: 22px;
  padding: 0 8px;
  font-size: 9px;
}

.studio-thumb {
  flex: 1;
  min-height: 0;
  border-radius: 4px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ui-accent) 88%, transparent), color-mix(in srgb, var(--ui-edge-flow) 60%, transparent));
}

.studio-port {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  border: 1px solid var(--ui-accent);
  border-radius: 99px;
  background: var(--pv-surface);
  transform: translateY(-50%);
}

.studio-port.is-left {
  left: -3px;
}

.studio-port.is-right {
  right: -3px;
}

.studio-selection {
  position: absolute;
  top: calc(35% - 5px);
  right: calc(8% - 5px);
  z-index: 3;
  width: calc(33% + 10px);
  height: calc(31% + 10px);
  pointer-events: none;
}

.studio-selection-outer,
.studio-selection-inner {
  position: absolute;
  inset: 0;
  border-radius: 7px;
}

.studio-selection-outer {
  border: 1px dashed var(--ui-select-outer);
  opacity: 0.75;
}

.studio-selection-inner {
  inset: 4px;
  border: 1px solid var(--ui-select-inner);
  border-radius: 4px;
}

.studio-states {
  position: absolute;
  right: 7%;
  bottom: 5%;
  left: 7%;
  z-index: 2;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  height: 14%;
}

.studio-state {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--pv-line);
  border-radius: 5px;
  background: var(--pv-surface-soft);
}

.studio-state :deep(.nes-root) {
  gap: 3px;
  padding: 4px 5px;
  text-align: left;
}

.studio-state :deep(.nes-icon) {
  width: 13px;
  height: 13px;
}

.studio-state :deep(.nes-text) {
  font-size: 8px;
}

.studio-state :deep(.nes-description) {
  font-size: 7px;
}

.studio-preview-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
}

.studio-preview-meta span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.studio-preview-meta i {
  width: 4px;
  height: 4px;
  border-radius: 99px;
  background: var(--ui-accent, #0891b2);
}

.studio-current {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--ui-line-soft, #eef0f4);
  border-radius: var(--radius-row, 10px);
  background: var(--ui-panel-soft, #fff);
}

.studio-current-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.10));
  color: var(--ui-accent, #0e7490);
}

.studio-current-icon svg {
  width: 13px;
  height: 13px;
}

.studio-current-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.studio-current-copy strong {
  overflow: hidden;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-current-copy small {
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
}

.studio-current-dots {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.studio-current-dots i {
  width: 7px;
  height: 7px;
  border-radius: 99px;
}

.studio-preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.studio-preview-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 28px;
  padding: 0 5px;
  border: 1px solid var(--ui-line, #e2e5ea);
  border-radius: var(--radius-control, 8px);
  background: var(--ui-panel, #fff);
  color: var(--ui-ink-dim, #6b7280);
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.studio-preview-actions button:hover {
  background: var(--ui-hover-soft, rgb(0 0 0 / 0.035));
  color: var(--ui-ink, #18202b);
}

.studio-preview-actions svg {
  width: 11px;
  height: 11px;
}

.studio-preview-note {
  margin: 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 9px;
  line-height: 1.4;
  text-align: center;
}

.studio-toast {
  position: fixed;
  bottom: 22px;
  left: 50%;
  z-index: 50;
  padding: 7px 12px;
  border-radius: 7px;
  background: var(--ui-ink, #18202b);
  color: var(--ui-panel, #fff);
  font-size: 10px;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 6px);
  transition: opacity var(--dur-hover, 0.18s) ease, transform var(--dur-hover, 0.18s) ease;
}

.studio-toast.is-show {
  opacity: 1;
  transform: translate(-50%, 0);
}

@container (max-width: 700px) {
  .studio-grid {
    grid-template-columns: 1fr;
  }

  .studio-preview {
    position: static;
    order: -1;
  }

  .studio-preview-canvas {
    height: 260px;
  }
}

@container (max-width: 560px) {
  .studio-intro {
    flex-direction: column;
  }

  .studio-group {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .studio-token-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .studio-template,
  .studio-toast {
    transition: none;
  }
}
</style>

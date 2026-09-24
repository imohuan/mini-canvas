<script setup lang="ts">
/**
 * AppSettingsPanel —— @mini-canvas/ui 的**成品设置界面**（LibTV 风格），注册到可替换槽 settingsPanel。
 *
 * 只是"皮"：数据仍来自宿主喂进来的 props.settings（内核 settings 单一数据源），
 * 字段级控件复用 canvas-render 的 SETTINGS_FIELD_RENDERER（插件也可 inject 后自绘）。
 *
 * 布局照当前 UI 语言：
 *   居中弹窗（与生成历史/快捷键同一套毛玻璃 + 圆角）→ 左侧一级导航（图标+文字，选中态实心）→
 *   右侧「分组卡片」：卡片头（标题+副标题）+ 若干行（label 左 / 控件右），行间细分隔线。
 *
 * 三级插槽全部保留（与默认皮同协议，插件换皮不破坏）：
 *   settingsNav / settingsTab / settingsGroup/<完整分组key>
 */
import { computed, markRaw, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER } from '@mini-canvas/canvas-render'
import SettingsSchemaField from '@mini-canvas/plugin-theme-default/components/settings/SettingsSchemaField.vue'
import { useUi } from '../../composables/ui'

const props = defineProps<{ settings: SettingsPanelSource; closeOnMask?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

// 关闭通道：面板直接写宿主的共享状态（useUi 单例），**不经内核事件**。
// 原因：宿主对 settings:ui-close 的订阅挂在 CanvasHost 的 ref 上，该 ref 在本装配层拿不到，
// 订阅没建起来，ctx.emit 出去没人接 → 关闭按钮/遮罩/Esc 全都没反应。
const uiState = useUi()
function closePanel(): void {
  emit('close')
  uiState.closeSettings()
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.closeOnMask !== false) closePanel()
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

// 字段渲染器：默认皮注册的 SettingsSchemaField（含 color 取色器 / number 精度滑块 / boolean 开关 / select）。
// 本面板自己 provide 给子树（默认皮也是这么干的），这样 settingsGroup/<key> 自定义内容插槽也能拿到同一套控件。
const FieldRenderer = SettingsSchemaField as unknown
provide(SETTINGS_FIELD_RENDERER, SettingsSchemaField as never)

const SEP = '/'
const navOf = (key: string): string => key.split(SEP)[0]
const leafOf = (key: string): string => {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

/** 分组变化时强制重算（schema 热更新的最小支持：宿主换皮时重建即可） */
const refreshTick = ref(0)
const groups = computed(() => { void refreshTick.value; return props.settings.groups() })
const sectionMap = computed<Map<string, string[]>>(() => {
  const m = new Map<string, string[]>()
  for (const g of groups.value) {
    const nav = navOf(g)
    if (!m.has(nav)) m.set(nav, [])
    m.get(nav)!.push(g)
  }
  return m
})

/** 一级导航：图标（用简短字符/emoji 之外的统一图形）+ 名称 */
const NAV_ICON: Record<string, string> = {
  节点: 'node', 布局: 'layout', 边: 'edge', 常规: 'general', 导出: 'export',
}
function iconFor(nav: string): string {
  return NAV_ICON[nav] ?? 'general'
}

const activeNav = ref('')
const navKeys = computed(() => [...sectionMap.value.keys()])
watch(
  navKeys,
  (keys) => {
    if (keys.length && !keys.includes(activeNav.value)) activeNav.value = keys[0]
  },
  { immediate: true },
)

/** 当前一级下的完整分组（叶子），每个渲染成一张卡片 */
const leaves = computed<string[]>(() => sectionMap.value.get(activeNav.value) ?? [])

/** 分组 key → 副标题（第一条字段 label 之外的说明，简单用字段数表示） */
function groupMeta(key: string): string {
  const n = props.settings.groupOf(key).length
  return n + ' 项设置'
}

/** 取某个字段的当前值（store 非响应式，靠本地 tick 驱动刷新） */
const valueTick = ref(0)
let unsub: { dispose(): void } | undefined
unsub = props.settings.onChange(() => { valueTick.value += 1 })
onBeforeUnmount(() => unsub?.dispose())

function setValue(key: string, v: string | number | boolean): void {
  props.settings.set(key, v)
}

/**
 * 字段行：label + 控件。控件按 schema.type 走——
 * 有 FieldRenderer（宿主提供了标准控件）就用它；否则退化成本组件内置的极简控件。
 */
const useFieldRenderer = computed(() => !!FieldRenderer)

/** 自定义内容插槽：settingsGroup/<完整 key> 命中则整张卡片内容交给它 */
// 插槽 occupant 由宿主读取（保持与默认皮同协议）；无命中时走 schema 渲染。
const customGroups = ref<Record<string, unknown>>({})
void customGroups
void markRaw
</script>

<template>
  <div class="fixed inset-0 z-[210] grid place-items-center bg-[var(--ui-scrim)] backdrop-blur-[2px]" @pointerdown.self="closePanel()">
    <!-- 注意：AxDialog 的面板基类是 flex-direction: column（给纵向弹窗用）。
         设置面板是**左右布局**，所以这里必须显式 flex-row 覆盖，否则左导航与内容会竖着堆叠、右列高度失控。 -->
    <section
      class="axdlg-panel app-settings !flex-row h-[min(680px,calc(100vh-64px))] w-[min(920px,calc(100vw-64px))] overflow-hidden rounded-3xl border border-line bg-panel text-ink"
      role="dialog" aria-modal="true" aria-label="设置"
      @pointerdown.stop
    >
      <!-- 左：一级导航（比面板更暗一档，形成明确分区） -->
      <aside class="flex h-full w-[208px] flex-none flex-col border-r border-line bg-panel-soft p-2.5">
        <div class="px-2 pb-2.5 pt-1.5 text-[15px] font-semibold">设置</div>
        <nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="设置导航">
          <button
            v-for="nav in navKeys" :key="nav"
            class="relative flex h-9 items-center gap-2.5 rounded-[10px] pl-5 pr-2.5 text-left text-[13px] transition-colors"
            :class="activeNav === nav ? 'bg-chip font-medium text-ink' : 'text-ink-dim hover:bg-hover hover:text-ink'"
            :aria-current="activeNav === nav ? 'page' : undefined"
            @click="activeNav = nav"
          >
            <!-- 选中态左侧强调条：暗色/亮色下都能一眼定位 -->
            <span v-if="activeNav === nav" class="absolute left-1.5 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-brand" aria-hidden="true"></span>
            <span class="grid size-4 flex-none place-items-center opacity-80">
              <!-- 统一线性小图标：节点=方块 / 布局=网格 / 边=连线 / 常规=滑块 / 导出=下载 -->
              <svg v-if="iconFor(nav) === 'node'" width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" stroke-width="1.4" /><path d="M6 8h4M8 6v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
              <svg v-else-if="iconFor(nav) === 'layout'" width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1.6" stroke="currentColor" stroke-width="1.4" /><rect x="9" y="2" width="5" height="5" rx="1.6" stroke="currentColor" stroke-width="1.4" /><rect x="2" y="9" width="5" height="5" rx="1.6" stroke="currentColor" stroke-width="1.4" /><rect x="9" y="9" width="5" height="5" rx="1.6" stroke="currentColor" stroke-width="1.4" /></svg>
              <svg v-else-if="iconFor(nav) === 'edge'" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 12c4 0 6-8 10-8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /><circle cx="3" cy="12" r="1.4" fill="currentColor" /><circle cx="13" cy="4" r="1.4" fill="currentColor" /></svg>
              <svg v-else-if="iconFor(nav) === 'export'" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 12.5v.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M5 8h6M7 11h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
            </span>
            <span class="truncate">{{ nav }}</span>
          </button>
        </nav>
      </aside>

      <!-- 右：分组卡片列表 -->
      <div class="flex h-full min-w-0 flex-1 flex-col">
        <header class="flex h-14 flex-none items-center justify-between gap-3 border-b border-line px-5">
          <div class="min-w-0">
            <h3 class="truncate text-[15px] font-semibold">{{ activeNav || '设置' }}</h3>
            <p class="truncate text-[11px] text-ink-dim">共 {{ leaves.length }} 个分组 · {{ groups.length }} 项分组</p>
          </div>
          <button class="grid size-8 flex-none place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="关闭设置" @click="closePanel()">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </button>
        </header>

        <!-- 内容区：底色比面板深一档，卡片用面板色 → 卡片边界一眼可见（不再糊成一片） -->
        <div class="min-h-0 flex-1 overflow-y-auto bg-canvas-bg p-4">
          <div v-if="!leaves.length" class="grid h-full place-items-center text-xs text-ink-dim">该分类下暂无设置项</div>
          <section v-for="leaf in leaves" :key="leaf" class="mb-3 overflow-hidden rounded-xl border border-line bg-panel">
            <header class="flex items-baseline justify-between gap-3 border-b border-line-soft px-4 py-2.5">
              <h4 class="text-[13px] font-medium">{{ leafOf(leaf) }}</h4>
              <span class="text-[11px] text-ink-dim">{{ groupMeta(leaf) }}</span>
            </header>
            <div class="divide-y divide-[var(--ui-line-soft)]">
              <!-- 字段行交给标准渲染器（它自带 label + 控件 + 说明，布局随主题规范） -->
              <div v-for="entry in props.settings.groupOf(leaf)" :key="entry.key" class="px-4 py-2.5">
                <component
                  v-if="useFieldRenderer"
                  :is="FieldRenderer as never"
                  :group="leaf" :field-key="entry.key" :settings="props.settings"
                />
                <!-- 兜底极简控件（宿主没提供渲染器时） -->
                <div v-else class="flex min-h-[24px] items-center justify-between gap-4">
                  <label class="min-w-0 flex-1 truncate text-[12px] text-ink/90" :for="'set-' + entry.key">{{ entry.schema.label || entry.key }}</label>
                  <div class="flex flex-none items-center gap-2">
                    <button
                      v-if="entry.schema.type === 'boolean'"
                      class="relative h-6 w-10 flex-none rounded-full transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
                      :class="entry.value ? 'bg-brand after:translate-x-4' : 'bg-hover-strong'"
                      role="switch" :aria-checked="!!entry.value" :aria-label="entry.schema.label || entry.key"
                      @click="setValue(entry.key, !entry.value)"
                    ></button>
                    <input
                      v-else-if="entry.schema.type === 'color'"
                      :id="'set-' + entry.key" type="color" class="h-7 w-14 cursor-pointer rounded-lg border border-line bg-transparent"
                      :value="String(entry.value)" @input="setValue(entry.key, ($event.target as HTMLInputElement).value)"
                    />
                    <input
                      v-else-if="entry.schema.type === 'number'"
                      :id="'set-' + entry.key" type="number" :step="entry.schema.step ?? 1"
                      class="h-7 w-24 rounded-lg border border-line bg-panel px-2 text-right text-[12px] text-ink outline-none"
                      :value="Number(entry.value)" @change="setValue(entry.key, Number(($event.target as HTMLInputElement).value))"
                    />
                    <select
                      v-else-if="entry.schema.type === 'select'"
                      :id="'set-' + entry.key" class="h-7 rounded-lg border border-line bg-panel px-2 text-[12px] text-ink outline-none"
                      :value="String(entry.value)" @change="setValue(entry.key, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="o in entry.schema.options ?? []" :key="String(o.value ?? o)" :value="String(o.value ?? o)">{{ o.label ?? o }}</option>
                    </select>
                    <input
                      v-else :id="'set-' + entry.key" type="text"
                      class="h-7 w-40 rounded-lg border border-line bg-panel px-2 text-[12px] text-ink outline-none"
                      :value="String(entry.value)" @change="setValue(entry.key, ($event.target as HTMLInputElement).value)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 面板阴影跟随主题（亮色下要浅，暗色下要深） */
.app-settings { box-shadow: var(--ui-shadow-lg); }
</style>

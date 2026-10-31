<script setup lang="ts">
/**
 * 组件库展示页。三栏：
 *   左  —— 组件列表（按分组，可搜索）
 *   中  —— 上：预览 / 下：Markdown 文档（可上下拖）
 *   右  —— 当前组件的配置面板，改动实时反映到预览
 *
 * 页面本身不认识任何具体组件：试玩配置全在 playgrounds/ 里，
 * 按 catalog 注册表取；预览渲染在 PlaygroundPreview.vue 里按 id 分支。
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { ChevronLeft, Moon, Plus, RotateCcw, Search, SlidersHorizontal, Sun } from 'lucide-vue-next'
import {
  Button, Input, MessagesHost, NotifyHost, NumberInput, Select, Slider, Switch, Tabs, Tooltip, UiKitProvider,
  type SelectOption, type TabItem, type UiKitDensity, type UiKitSize,
} from '../index'
import SplitPane from '../components/split-pane/SplitPane.vue'
import UiKitDocView from './UiKitDocView.vue'
import PlaygroundPreview from './PlaygroundPreview.vue'
import { CATALOG, CATALOG_TOTAL, findCatalogItem } from './catalog'
import { loadDocs, type UiKitDoc } from './docModules'
import { findPlayground } from './playgrounds/catalog'
import { numberValue, type PlaygroundField, type PlaygroundValue } from './playground'
import './preview.css'

withDefaults(defineProps<{ showHome?: boolean }>(), { showHome: false })
const emit = defineEmits<{ home: [] }>()

const activeId = ref('button')
const query = ref('')
const size = ref<UiKitSize>('md')
const density = ref<UiKitDensity>('comfortable')
const radius = ref(10)
const dark = ref(true)
const accent = ref('#22b8d8')

/** 顶部全局参数用的选项；用组件库的 Select，不再用原生下拉。 */
const sizeOptions: SelectOption[] = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]
const densityOptions: SelectOption[] = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '标准' },
  { value: 'spacious', label: '宽松' },
]

const active = computed(() => findCatalogItem(activeId.value))
/** 文档里有编译好的组件对象，用 shallowRef 避免被深度代理。 */
const docs = shallowRef<Record<string, UiKitDoc>>({})
const doc = computed(() => docs.value[activeId.value])

onMounted(async () => {
  docs.value = await loadDocs()
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return CATALOG
  return CATALOG.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      (item.name + item.label + item.description).toLowerCase().includes(q),
    ),
  })).filter((group) => group.items.length > 0)
})

/* ---- 当前组件的试玩配置 ---- */

/** 从 catalog 取当前组件的配置；没有配置的组件右侧只显示说明。 */
const playground = computed(() => findPlayground(activeId.value))

/** 当前参数。切换组件时整份重置成该组件的默认值。 */
const state = ref<Record<string, PlaygroundValue>>({ ...(playground.value?.defaults ?? {}) })

watch(
  activeId,
  () => {
    state.value = { ...(playground.value?.defaults ?? {}) }
    query.value = query.value.trim()
  },
  { immediate: true },
)

const fields = computed<PlaygroundField[]>(() => playground.value?.fields ?? [])
const presets = computed(() => playground.value?.presets ?? [])
const summary = computed(() => {
  const config = playground.value
  if (!config?.summary) return ''
  return config.summary(state.value)
})

/* ---- 参数写入 ---- */

function setValue(key: string, value: PlaygroundValue): void {
  state.value = { ...state.value, [key]: value }
}

/** 输入框的 input 事件需要把字符串写回 state。 */
function onTextInput(key: string, event: Event): void {
  const target = event.target as HTMLInputElement | null
  setValue(key, target?.value ?? '')
}

function onNumberInput(key: string, event: Event): void {
  const target = event.target as HTMLInputElement | null
  const raw = target?.value ?? ''
  setValue(key, raw === '' ? null : Number(raw))
}

/** 库内数字控件清空时给 null，面板统一回落成 0，避免出现空值。 */
function toNumber(value: number | null): number {
  return typeof value === 'number' ? value : 0
}

/** 分段控件把 playground 的选项转成库内 Tabs 需要的形状。 */
function segmentItems(field: Extract<PlaygroundField, { kind: 'segment' }>): TabItem[] {
  return field.options.map((option) => ({ value: option.value, label: option.label }))
}

/** 只显示图标时必须有图标；关掉显示图标就把 iconOnly 一起关掉。 */
function onToggle(key: string, event: Event): void {
  const target = event.target as HTMLInputElement | null
  const checked = target?.checked === true
  if (key === 'showIcon' && !checked) {
    state.value = { ...state.value, showIcon: false, iconOnly: false }
    return
  }
  if (key === 'iconOnly' && checked) {
    state.value = { ...state.value, iconOnly: true, showIcon: true }
    return
  }
  setValue(key, checked)
}

function applyPreset(patch: Record<string, PlaygroundValue>): void {
  state.value = { ...(playground.value?.defaults ?? {}), ...patch }
}

function resetPlayground(): void {
  state.value = { ...(playground.value?.defaults ?? {}) }
}

/** range 的值可能是小数，按单位显示；百分比按 0-1 换算。 */
function rangeLabel(field: Extract<PlaygroundField, { kind: 'range' }>): string {
  const raw = state.value[field.key]
  const value = typeof raw === 'number' ? raw : field.min
  if (field.unit === '%') return Math.round(value * 100) + '%'
  return value + (field.unit ?? '')
}

function resetGlobal(): void {
  size.value = 'md'
  density.value = 'comfortable'
  radius.value = 10
  dark.value = true
  accent.value = '#22b8d8'
}
</script>

<template>
  <UiKitProvider
    :size="size"
    :density="density"
    :radius="radius"
    :dark="dark"
    :accent="accent"
    class="uk-shell"
  >
    <!-- 通知与轻提示的宿主：整个预览页只挂一次。
         每个示例再挂一份会得到互相独立的队列，一条通知只出现在某个示例框附近。 -->
    <NotifyHost />
    <MessagesHost />
    <header class="uk-topbar">
      <div class="uk-brand">
        <button v-if="showHome" type="button" class="uk-icon-button" title="返回首页" aria-label="返回首页" @click="emit('home')">
          <ChevronLeft :size="16" />
        </button>
        <span class="uk-brand-mark">M</span>
        <div>
          <strong>MiniCanvas UI Kit</strong>
          <span>{{ CATALOG_TOTAL }} 个组件 · Provider 全局参数</span>
        </div>
      </div>

      <div class="uk-global-controls">
        <div class="uk-control">
          <span>尺寸</span>
          <Select v-model="size" :options="sizeOptions" aria-label="默认尺寸" class="uk-control-select" />
        </div>
        <div class="uk-control">
          <span>密度</span>
          <Select v-model="density" :options="densityOptions" aria-label="密度" class="uk-control-select" />
        </div>
        <div class="uk-control uk-control--range">
          <span>圆角 {{ radius }}px</span>
          <Slider v-model="radius" :min="0" :max="24" :step="1" :show-value="false" aria-label="圆角" class="uk-control-slider" />
        </div>
        <label class="uk-control uk-control--color">
          <span>主题色</span>
          <input v-model="accent" type="color" />
        </label>
        <Tooltip :content="dark ? '切到亮色' : '切到暗色'">
          <Button icon-only :aria-label="dark ? '切到亮色' : '切到暗色'" @click="dark = !dark">
            <template #icon><Sun v-if="dark" :size="15" /><Moon v-else :size="15" /></template>
          </Button>
        </Tooltip>
        <Tooltip content="恢复全局参数">
          <Button icon-only aria-label="恢复全局参数" @click="resetGlobal">
            <template #icon><RotateCcw :size="15" /></template>
          </Button>
        </Tooltip>
      </div>
    </header>

    <!-- 外层：左列表 / 右工作区 -->
    <SplitPane class="uk-body" :initial="0.18" :min-left="200" :min-right="560" :snap="48">
      <template #left>
        <aside class="uk-sidebar">
          <label class="uk-search">
            <Search :size="14" />
            <input v-model="query" placeholder="搜索组件" aria-label="搜索组件" />
          </label>
          <nav class="uk-nav" aria-label="组件目录">
            <section v-for="group in filtered" :key="group.id" class="uk-nav-group">
              <h2>{{ group.title }}</h2>
              <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="uk-nav-item"
                :class="{ 'is-active': activeId === item.id }"
                @click="activeId = item.id"
              >
                <span>
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.description }}</small>
                </span>
                <em>{{ item.label }}</em>
              </button>
            </section>
            <p v-if="filtered.length === 0" class="uk-nav-empty">没有匹配的组件。</p>
          </nav>
          <div class="uk-sidebar-foot">@mini-canvas/ui-kit</div>
        </aside>
      </template>

      <template #right>
        <!-- 内层：中间（上预览 + 下文档）/ 右配置 -->
        <SplitPane class="uk-workspace" :initial="playground ? 0.7 : 1" :min-left="360" :min-right="248" :snap="42">
          <template #left>
            <SplitPane class="uk-center" direction="vertical" :initial="0.58" :min-left="180" :min-right="140" :snap="38">
              <template #left>
                <section class="uk-preview-panel">
                  <div class="uk-panel-head">
                    <div class="uk-panel-title">
                      <span class="uk-eyebrow">{{ active?.name }}</span>
                      <strong>{{ active?.label }}</strong>
                    </div>
                    <code>@mini-canvas/ui-kit</code>
                  </div>

                  <div class="uk-preview-stage">
                    <div class="uk-preview-canvas" :class="{ 'is-stretch': playground?.stretch }">
                      <PlaygroundPreview
                        :id="activeId"
                        :state="state"
                        :dropdown-config-target="activeId === 'dropdown' ? '#uk-dropdown-config' : null"
                      />
                      <p v-if="summary" class="uk-canvas-caption">{{ summary }}</p>
                    </div>
                  </div>
                </section>
              </template>

              <template #right>
                <section class="uk-doc-panel">
                  <div class="uk-doc-heading">
                    <div>
                      <span class="uk-eyebrow">文档介绍</span>
                      <h2>什么时候用它</h2>
                    </div>
                    <Button v-if="playground" variant="ghost" size="sm" @click="resetPlayground">
                      <template #icon><RotateCcw :size="14" /></template>
                      恢复默认
                    </Button>
                  </div>
                  <div class="uk-doc-scroll">
                    <UiKitDocView
                      :key="activeId"
                      :source="doc.markdown"
                      :examples="doc.examples"
                      :code-html="doc.codeHtml"
                      v-if="doc"
                    />
                    <p v-else class="uk-doc-loading">正在载入组件文档…</p>
                  </div>
                </section>
              </template>
            </SplitPane>
          </template>

          <template #right>
            <aside v-if="activeId === 'dropdown'" class="uk-config uk-config--hosted">
              <!-- 内容由 DropdownPlayground.vue 通过 Teleport 渲染；这里只提供位置。 -->
              <div id="uk-dropdown-config" class="uk-config-host" />
            </aside>
            <aside v-else class="uk-config">
              <div class="uk-config-head">
                <div>
                  <span class="uk-eyebrow">组件配置</span>
                  <h2>调一调看看</h2>
                </div>
                <span class="uk-config-icon"><SlidersHorizontal :size="16" /></span>
              </div>

              <template v-if="playground">
                <!-- 控件由 playgrounds/<id>.ts 的 fields 决定，页面不认识具体组件 -->
                <template v-for="field in fields" :key="field.key">
                  <div v-if="field.kind === 'text'" class="uk-field">
                    <label :for="'uk-field-' + field.key">{{ field.label }}</label>
                    <Input
                      :id="'uk-field-' + field.key"
                      :model-value="String(state[field.key] ?? '')"
                      :placeholder="field.placeholder"
                      :maxlength="field.maxlength"
                      :aria-label="field.label"
                      @update:model-value="setValue(field.key, $event)"
                    />
                  </div>

                  <div v-else-if="field.kind === 'number'" class="uk-field">
                    <label :for="'uk-field-' + field.key">{{ field.label }}</label>
                    <NumberInput
                      :id="'uk-field-' + field.key"
                      :model-value="numberValue(state, field.key)"
                      :min="field.min"
                      :max="field.max"
                      :step="field.step"
                      :aria-label="field.label"
                      @update:model-value="setValue(field.key, toNumber($event))"
                    />
                  </div>

                  <fieldset v-else-if="field.kind === 'segment'" class="uk-fieldset">
                    <legend>{{ field.label }}</legend>
                    <Tabs
                      :model-value="String(state[field.key] ?? '')"
                      :items="segmentItems(field)"
                      :aria-label="field.label"
                      block
                      @update:model-value="setValue(field.key, $event)"
                    />
                  </fieldset>

                  <div v-else-if="field.kind === 'toggle'" class="uk-field">
                    <Switch
                      :model-value="state[field.key] === true"
                      :label="field.label"
                      @update:model-value="setValue(field.key, $event)"
                    />
                  </div>

                  <div v-else-if="field.kind === 'range'" class="uk-field">
                    <span class="uk-field-label">{{ field.label }} <b>{{ rangeLabel(field) }}</b></span>
                    <Slider
                      :model-value="numberValue(state, field.key) ?? field.min"
                      :min="field.min"
                      :max="field.max"
                      :step="field.step"
                      :show-value="false"
                      :aria-label="field.label"
                      @update:model-value="setValue(field.key, toNumber($event))"
                    />
                  </div>
                </template>

                <div v-if="presets.length" class="uk-presets">
                  <div class="uk-presets-head">
                    <span class="uk-eyebrow">配置好的预设</span>
                    <span>一键套用</span>
                  </div>
                  <button
                    v-for="preset in presets"
                    :key="preset.id"
                    type="button"
                    class="uk-preset"
                    @click="applyPreset(preset.patch)"
                  >
                    <span class="uk-preset-swatch" :class="'is-' + (preset.patch.variant ?? 'primary')"></span>
                    <span class="uk-preset-copy">
                      <strong>{{ preset.name }}</strong>
                      <small>{{ preset.description }}</small>
                    </span>
                    <Button icon-only aria-label="套用这个预设" :title="'套用 ' + preset.name" @click.stop="applyPreset(preset.patch)">
                      <template #icon><Plus :size="14" /></template>
                    </Button>
                  </button>
                </div>
              </template>

              <p v-if="!playground" class="uk-config-empty">
                这个组件暂时没有可调参数，直接到下方文档里试。
              </p>
            </aside>
          </template>
        </SplitPane>
      </template>
    </SplitPane>
  </UiKitProvider>
</template>



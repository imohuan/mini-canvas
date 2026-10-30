<script setup lang="ts">
/**
 * 组件库展示页。三栏：
 *   左  —— 组件列表（按分组，可搜索）
 *   中  —— 上：预览画布 / 下：Markdown 文档（可上下拖）
 *   右  —— 当前组件的配置面板，改动实时反映到预览
 *
 * 顶部还有一层全局参数（尺寸/密度/圆角/主题色/深浅色），它驱动 UiKitProvider，
 * 作用到页面里所有 ui-kit 组件。
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { ChevronLeft, Moon, RotateCcw, Search, SlidersHorizontal, Sun } from 'lucide-vue-next'
import { Button, UiKitProvider, type UiKitDensity, type UiKitSize } from '../index'
import SplitPane from '../components/split-pane/SplitPane.vue'
import UiKitDocView from './UiKitDocView.vue'
import { CATALOG, CATALOG_TOTAL, findCatalogItem } from './catalog'
import { loadDocs, type UiKitDoc } from './docModules'
import {
  DEFAULT_PLAYGROUND,
  PLAYGROUND_PRESETS,
  SIZE_LABELS,
  SIZE_ORDER,
  VARIANT_LABELS,
  VARIANT_ORDER,
  summarize,
  type PlaygroundState,
  type PlaygroundVariant,
} from './playground'
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

/* ---- 右侧配置面板 ---- */

const playground = ref<PlaygroundState>({ ...DEFAULT_PLAYGROUND })
/** 只有能调参数的组件才显示右侧面板。 */
const configurable = computed(() => activeId.value === 'button')
const summary = computed(() => summarize(playground.value))

function resetPlayground(): void {
  playground.value = { ...DEFAULT_PLAYGROUND }
}

function applyPreset(patch: Partial<PlaygroundState>): void {
  playground.value = { ...DEFAULT_PLAYGROUND, ...patch }
}

function selectVariant(variant: PlaygroundVariant): void {
  playground.value = { ...playground.value, variant }
}

function selectSize(next: UiKitSize): void {
  playground.value = { ...playground.value, size: next }
}

function toggle(key: 'block' | 'disabled' | 'loading' | 'round', value: boolean): void {
  playground.value = { ...playground.value, [key]: value }
}

/** 只显示图标时必须有图标；关掉时把 iconOnly 一起关掉，避免出现空方按钮。 */
function toggleShowIcon(value: boolean): void {
  playground.value = {
    ...playground.value,
    showIcon: value,
    iconOnly: value ? playground.value.iconOnly : false,
  }
}

function toggleIconOnly(value: boolean): void {
  playground.value = { ...playground.value, iconOnly: value, showIcon: value ? true : playground.value.showIcon }
}

/** 切到别的组件时收起搜索框里多余的空格。 */
watch(activeId, () => {
  query.value = query.value.trim();
})

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
        <label class="uk-control">
          <span>尺寸</span>
          <select v-model="size">
            <option value="sm">小</option>
            <option value="md">中</option>
            <option value="lg">大</option>
          </select>
        </label>
        <label class="uk-control">
          <span>密度</span>
          <select v-model="density">
            <option value="compact">紧凑</option>
            <option value="comfortable">标准</option>
            <option value="spacious">宽松</option>
          </select>
        </label>
        <label class="uk-control uk-control--range">
          <span>圆角 {{ radius }}px</span>
          <input v-model.number="radius" type="range" min="0" max="24" step="1" />
        </label>
        <label class="uk-control uk-control--color">
          <span>主题色</span>
          <input v-model="accent" type="color" />
        </label>
        <button type="button" class="uk-icon-button" :title="dark ? '切到亮色' : '切到暗色'" :aria-label="dark ? '切到亮色' : '切到暗色'" @click="dark = !dark">
          <Sun v-if="dark" :size="15" />
          <Moon v-else :size="15" />
        </button>
        <button type="button" class="uk-icon-button" title="恢复全局参数" aria-label="恢复全局参数" @click="resetGlobal">
          <RotateCcw :size="15" />
        </button>
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
        <SplitPane class="uk-workspace" :initial="configurable ? 0.7 : 1" :min-left="360" :min-right="248" :snap="42">
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
                    <div class="uk-preview-canvas">
                      <div class="uk-canvas-grid" aria-hidden="true"></div>
                      <div v-if="activeId === 'button'" class="uk-demo-button" :class="{ 'is-block': playground.block }">
                        <Button
                          :variant="playground.variant"
                          :size="playground.size"
                          :block="playground.block"
                          :disabled="playground.disabled"
                          :loading="playground.loading"
                          :round="playground.round"
                          :aria-label="playground.iconOnly ? (playground.label || '按钮') : undefined"
                        >
                          <template v-if="playground.showIcon || playground.iconOnly" #icon>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z" />
                            </svg>
                          </template>
                          <template v-if="!playground.iconOnly">{{ playground.label || '按钮' }}</template>
                        </Button>
                      </div>
                      <p v-else class="uk-empty-hint">这个组件的交互直接在下方文档里试。</p>
                      <p class="uk-canvas-caption">{{ summary }}</p>
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
                    <Button v-if="configurable" variant="ghost" size="sm" @click="resetPlayground">
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
            <aside class="uk-config">
              <div class="uk-config-head">
                <div>
                  <span class="uk-eyebrow">组件配置</span>
                  <h2>调一调看看</h2>
                </div>
                <span class="uk-config-icon"><SlidersHorizontal :size="16" /></span>
              </div>

              <template v-if="configurable">
                <div class="uk-field">
                  <label for="uk-button-label">按钮文字</label>
                  <input id="uk-button-label" v-model="playground.label" maxlength="24" placeholder="例如：保存草稿" />
                </div>

                <fieldset class="uk-fieldset">
                  <legend>外观</legend>
                  <div class="uk-segment">
                    <button
                      v-for="variant in VARIANT_ORDER"
                      :key="variant"
                      type="button"
                      :class="{ 'is-active': playground.variant === variant }"
                      @click="selectVariant(variant)"
                    >{{ VARIANT_LABELS[variant] }}</button>
                  </div>
                </fieldset>

                <fieldset class="uk-fieldset">
                  <legend>尺寸</legend>
                  <div class="uk-segment">
                    <button
                      v-for="item in SIZE_ORDER"
                      :key="item"
                      type="button"
                      :class="{ 'is-active': playground.size === item }"
                      @click="selectSize(item)"
                    >{{ SIZE_LABELS[item] }}</button>
                  </div>
                </fieldset>

                <div class="uk-switch-list">
                  <label class="uk-switch">
                    <span>显示图标</span>
                    <input type="checkbox" :checked="playground.showIcon" @change="toggleShowIcon(($event.target as HTMLInputElement).checked)" />
                    <i aria-hidden="true"></i>
                  </label>
                  <label class="uk-switch">
                    <span>只显示图标</span>
                    <input type="checkbox" :checked="playground.iconOnly" @change="toggleIconOnly(($event.target as HTMLInputElement).checked)" />
                    <i aria-hidden="true"></i>
                  </label>
                  <label class="uk-switch">
                    <span>占满宽度</span>
                    <input type="checkbox" :checked="playground.block" @change="toggle('block', ($event.target as HTMLInputElement).checked)" />
                    <i aria-hidden="true"></i>
                  </label>
                  <label class="uk-switch">
                    <span>圆角胶囊</span>
                    <input type="checkbox" :checked="playground.round" @change="toggle('round', ($event.target as HTMLInputElement).checked)" />
                    <i aria-hidden="true"></i>
                  </label>
                  <label class="uk-switch">
                    <span>禁用</span>
                    <input type="checkbox" :checked="playground.disabled" @change="toggle('disabled', ($event.target as HTMLInputElement).checked)" />
                    <i aria-hidden="true"></i>
                  </label>
                  <label class="uk-switch">
                    <span>加载中</span>
                    <input type="checkbox" :checked="playground.loading" @change="toggle('loading', ($event.target as HTMLInputElement).checked)" />
                    <i aria-hidden="true"></i>
                  </label>
                </div>

                <div class="uk-presets">
                  <div class="uk-presets-head">
                    <span class="uk-eyebrow">配置好的预设</span>
                    <span>一键套用</span>
                  </div>
                  <button
                    v-for="preset in PLAYGROUND_PRESETS"
                    :key="preset.id"
                    type="button"
                    class="uk-preset"
                    @click="applyPreset(preset.patch)"
                  >
                    <span class="uk-preset-swatch" :class="'is-' + (preset.patch.variant ?? 'primary')"></span>
                    <span>
                      <strong>{{ preset.name }}</strong>
                      <small>{{ preset.description }}</small>
                    </span>
                    <em>+</em>
                  </button>
                </div>
              </template>

              <p v-else class="uk-config-empty">
                这个组件暂时没有可调参数，直接到下方文档里试。
              </p>
            </aside>
          </template>
        </SplitPane>
      </template>
    </SplitPane>
  </UiKitProvider>
</template>

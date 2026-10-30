<script setup lang="ts">
/**
 * 组件库展示页：左侧目录、右侧文档。
 *
 * 顶部全局参数直接驱动 UiKitProvider，改尺寸/主题色/密度会作用到当前页所有示例。
 * 页面只负责壳，组件案例与说明都在 docs/<id>.md，由 Vite 插件在构建期编译。
 */
import { computed, onMounted, ref, shallowRef } from 'vue'
import { ChevronLeft, Moon, RotateCcw, Search, Sun } from 'lucide-vue-next'
import { UiKitProvider, type UiKitDensity, type UiKitSize } from '../index'
import SplitPane from '../components/split-pane/SplitPane.vue'
import UiKitDocView from './UiKitDocView.vue'
import { CATALOG, CATALOG_TOTAL, findCatalogItem } from './catalog'
import { loadDocs, type UiKitDoc } from './docModules'
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

    <SplitPane class="uk-body" :initial="0.2" :min-left="200" :min-right="420" :snap="48">
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
        <main class="uk-main">
          <div class="uk-page-head">
            <div>
              <span class="uk-eyebrow">{{ active?.name }}</span>
              <h1>{{ active?.label }}</h1>
              <p>{{ active?.description }}</p>
            </div>
            <code>@mini-canvas/ui-kit</code>
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
        </main>
      </template>
    </SplitPane>
  </UiKitProvider>
</template>

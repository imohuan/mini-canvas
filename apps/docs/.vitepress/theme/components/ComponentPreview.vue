<script setup lang="ts">
import { computed, ref } from 'vue'
import { resolvePreview, type PreviewEntry } from '../preview-registry'

/**
 * 组件预览台：在文档页面里直接跑一个真实 Vue 组件。
 *
 * 两种用法：
 *   1. 直接塞组件（MD 里用 <script setup> 定义好就能传进来）：
 *        <ComponentPreview title="我的组件"><MyComp/></ComponentPreview>
 *   2. 按注册表名字取（适合「插件页 → 点开看这个插件注册的 UI」）：
 *        <ComponentPreview name="DemoCounter" />
 *      名字与组件的对应关系写在 .vitepress/theme/preview-registry.ts，那里统一维护。
 */
const props = withDefaults(
  defineProps<{
    /** 注册表里的名字；给了就用它，否则用默认插槽 */
    name?: string
    title?: string
    description?: string
    /** 预览区高度（px），默认 320 */
    height?: number
  }>(),
  { height: 320 },
)

const reg = computed<PreviewEntry | undefined>(() => (props.name ? resolvePreview(props.name) : undefined))
const Comp = computed(() => reg.value?.component)
const missing = computed(() => Boolean(props.name) && !reg.value)

const showCode = ref(false)
const expanded = ref(false)
const nonce = ref(0)

const code = computed(() => reg.value?.code ?? '')
</script>

<template>
  <div class="plume-preview">
    <div class="plume-preview__bar">
      <span class="plume-preview__title">{{ title ?? reg?.title ?? '组件预览' }}</span>
      <span v-if="description ?? reg?.description" class="plume-preview__desc">
        {{ description ?? reg?.description }}
      </span>
      <span class="plume-preview__spacer" />
      <button class="plume-preview__btn" @click="nonce++">刷新</button>
      <button v-if="code" class="plume-preview__btn" @click="showCode = !showCode">
        {{ showCode ? '隐藏代码' : '显示代码' }}
      </button>
      <button class="plume-preview__btn" @click="expanded = !expanded">
        {{ expanded ? '退出全屏' : '全屏' }}
      </button>
    </div>

    <div v-if="missing" class="plume-preview__stage">
      <div class="plume-empty">
        注册表里没有名字为 “{{ name }}” 的组件。请到
        <span class="plume-code">.vitepress/theme/preview-registry.ts</span> 里登记。
      </div>
    </div>

    <template v-else>
      <ClientOnly>
        <div :class="['plume-preview__stage', { 'plume-preview__stage--fullscreen': expanded }]">
          <component :is="Comp" v-if="Comp" :key="nonce" />
          <div v-else :key="nonce" :style="{ minHeight: (height ?? 320) + 'px' }">
            <slot />
          </div>
        </div>
      </ClientOnly>

      <pre v-if="showCode && code" class="plume-preview__code"><code>{{ code }}</code></pre>
    </template>
  </div>
</template>

<style scoped>
.plume-preview__desc {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
</style>

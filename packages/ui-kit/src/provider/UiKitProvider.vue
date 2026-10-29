<script setup lang="ts">
/**
 * UiKitProvider —— 组件库的全局参数入口。
 *
 * 包一层就能统一改尺寸、密度、圆角和主题色；所有 ui-kit 组件通过 useUiKit() 取值，
 * 不依赖 Tailwind，也不读宿主应用的 CSS 框架。
 */
import { computed, onMounted, onBeforeUnmount, watchEffect } from 'vue'
import { provideUiKitContext } from './context'
import { resolveConfig } from './config'
import type { UiKitProviderProps } from './types'

const props = withDefaults(defineProps<UiKitProviderProps>(), {
  size: 'md',
  density: 'comfortable',
  radius: 8,
  themeName: 'default',
  dark: false,
  accent: '',
  accentHover: '',
  danger: '',
  success: '',
  warning: '',
  info: '',
  sizes: undefined,
  zIndexBase: 90000,
})

/** 每次父级参数变化都重新算一份，子组件立刻跟着更新。 */
const context = computed(() => resolveConfig(props))
provideUiKitContext(context)

/** 浮层 Teleport 到 body 后拿不到 Provider 的 CSS 变量；同步一份到 documentElement 兜底。 */
let styleEl: HTMLStyleElement | undefined
onMounted(() => {
  watchEffect(() => {
    const vars = context.value.cssVars
    const text = Object.entries(vars).map(([k, v]) => k + ': ' + v + ' !important').join('; ')
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.setAttribute('data-ui-kit-vars', '')
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = ':root {' + text + '}'
  })
})
onBeforeUnmount(() => { styleEl?.remove(); styleEl = undefined })
</script>

<template>
  <div
    class="mck-provider"
    :data-ui-kit-theme="themeName"
    :data-ui-kit-dark="dark ? 'true' : 'false'"
    :style="context.cssVars"
  >
    <slot />
  </div>
</template>

<style scoped>
.mck-provider {
  color: var(--mck-ink);
  font-family: inherit;
}
</style>
